import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCall = vi.fn();
vi.mock("../../../apps/api/src/assistant/openrouter", () => ({
  callOpenRouter: (...args: unknown[]) => mockCall(...args),
}));

const mockExecute = vi.fn();
vi.mock("../../../apps/api/src/assistant/collect-tools", () => ({
  collectTools: () => [
    {
      name: "create_task",
      description: "Create a task",
      inputSchema: {},
      execute: mockExecute,
    },
    {
      name: "delete_task",
      description: "Delete a task",
      inputSchema: {},
      execute: mockExecute,
    },
  ],
  toOpenRouterTools: () => [],
}));

// Imported after the mocks above so runAssistant picks them up.
const assistant = (await import("../../../apps/api/src/assistant")).default;

function assistantText(content: string) {
  return { role: "assistant", content };
}

function assistantToolCall(id: string, name: string, args = "{}") {
  return {
    role: "assistant",
    content: null,
    tool_calls: [{ id, type: "function", function: { name, arguments: args } }],
  };
}

// Mounts the real assistant route behind the session middleware the same
// way the real app does (see apps/api/src/utils/authenticate-api-request.ts),
// so `c.get("session")` is populated before the route handler runs.
const app = new Hono();
app.use("*", async (c, next) => {
  c.set("session", { token: "test-token" });
  await next();
});
app.route("/assistant", assistant);

async function postChat(body: Record<string, unknown>) {
  return app.request("/assistant/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

// The route now streams SSE (event: "progress" | "result" | "error") instead
// of returning a single JSON body. These helpers parse the wire format and
// pull out the events tests care about, mirroring the parsing done by
// apps/web/src/fetchers/assistant/send-message.ts.
type SSEEvent = { event: string; data: string };

async function readSSEEvents(res: Response): Promise<SSEEvent[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((block) => block.trim().length > 0)
    .map((block) => {
      let event = "message";
      const dataLines: string[] = [];
      for (const line of block.split("\n")) {
        if (line.startsWith("event:"))
          event = line.slice("event:".length).trim();
        else if (line.startsWith("data:"))
          dataLines.push(line.slice("data:".length).trim());
      }
      return { event, data: dataLines.join("\n") };
    });
}

async function readResultEvent(res: Response) {
  const events = await readSSEEvents(res);
  const result = events.find((event) => event.event === "result");
  if (!result) throw new Error("no result event in stream");
  return JSON.parse(result.data) as {
    reply: string;
    actions: { tool: string; summary: string }[];
    pendingConfirmation?: { toolCallId: string; tool: string };
    conversationState?: unknown[];
    conversationSignature?: string;
  };
}

async function requestPendingConfirmation() {
  mockCall.mockResolvedValueOnce(assistantToolCall("c9", "delete_task"));
  const res = await postChat({
    messages: [{ role: "user", content: "apague a tarefa X" }],
  });
  expect(res.status).toBe(200);
  return readResultEvent(res);
}

describe("POST /assistant/chat — conversation state signature", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockExecute.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  });

  it("returns a conversationSignature alongside a pendingConfirmation", async () => {
    const first = await requestPendingConfirmation();

    expect(first.pendingConfirmation).toMatchObject({
      toolCallId: "c9",
      tool: "delete_task",
    });
    expect(first.conversationState).toBeDefined();
    expect(typeof first.conversationSignature).toBe("string");
    expect(first.conversationSignature?.length).toBeGreaterThan(0);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("resumes and completes the confirmed deletion with a valid signature", async () => {
    const first = await requestPendingConfirmation();

    mockCall.mockResolvedValueOnce(assistantText("apaguei"));

    const res = await postChat({
      messages: [],
      resumeFrom: first.conversationState,
      conversationSignature: first.conversationSignature,
      confirmations: ["c9"],
    });

    expect(res.status).toBe(200);
    const body = await readResultEvent(res);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(body.pendingConfirmation).toBeUndefined();
    expect(body.reply).toBe("apaguei");
  });

  it("rejects a forged resumeFrom paired with a stolen/valid-looking signature", async () => {
    const first = await requestPendingConfirmation();

    // Attacker fabricates a resumeFrom whose tool call id matches a
    // confirmation they also control, without ever going through the model.
    const forged = JSON.parse(JSON.stringify(first.conversationState));
    forged[forged.length - 1].tool_calls[0].id = "forged-call-id";

    const res = await postChat({
      messages: [],
      resumeFrom: forged,
      conversationSignature: first.conversationSignature,
      confirmations: ["forged-call-id"],
    });

    expect(res.status).toBe(400);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("rejects resumeFrom sent without any conversationSignature", async () => {
    const first = await requestPendingConfirmation();

    const res = await postChat({
      messages: [],
      resumeFrom: first.conversationState,
      confirmations: ["c9"],
    });

    expect(res.status).toBe(400);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("rejects resumeFrom signed under a different AUTH_SECRET", async () => {
    const first = await requestPendingConfirmation();

    process.env.AUTH_SECRET = "a-completely-different-secret-value";

    const res = await postChat({
      messages: [],
      resumeFrom: first.conversationState,
      conversationSignature: first.conversationSignature,
      confirmations: ["c9"],
    });

    expect(res.status).toBe(400);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe("POST /assistant/chat — streaming", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockExecute.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.AUTH_SECRET = "test-secret-at-least-32-characters-long";
  });

  it("emits a progress event for each tool call before the terminal result", async () => {
    mockCall
      .mockResolvedValueOnce(assistantToolCall("c1", "create_task"))
      .mockResolvedValueOnce(assistantText("feito"));

    const res = await postChat({
      messages: [{ role: "user", content: "crie uma tarefa" }],
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const events = await readSSEEvents(res);
    const progressNames = events
      .filter((event) => event.event === "progress")
      .map((event) => (JSON.parse(event.data) as { tool: string }).tool);
    expect(progressNames).toEqual(["create_task"]);

    const resultEvent = events.find((event) => event.event === "result");
    expect(resultEvent).toBeDefined();
    const result = JSON.parse(resultEvent?.data ?? "{}");
    expect(result.reply).toBe("feito");
    expect(result.actions).toEqual([{ tool: "create_task", summary: "ok" }]);
  });

  it("terminal result event carries the same fields as the old JSON response", async () => {
    mockCall.mockResolvedValueOnce(assistantText("ola"));

    const res = await postChat({
      messages: [{ role: "user", content: "oi" }],
    });

    const result = await readResultEvent(res);
    expect(result).toEqual({ reply: "ola", actions: [] });
  });

  it("logs and reports a stage-tagged error instead of swallowing a tool failure", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    mockCall.mockResolvedValueOnce(assistantToolCall("c1", "create_task"));
    mockExecute.mockRejectedValueOnce(new Error("db unreachable"));

    const res = await postChat({
      messages: [{ role: "user", content: "crie uma tarefa" }],
    });

    expect(res.status).toBe(200);
    const events = await readSSEEvents(res);
    const errorEvent = events.find((event) => event.event === "error");
    expect(errorEvent).toBeDefined();
    const parsed = JSON.parse(errorEvent?.data ?? "{}");
    expect(parsed.stage).toBe("tool:create_task");
    expect(typeof parsed.message).toBe("string");

    expect(consoleErrorSpy).toHaveBeenCalled();
    const loggedCall = consoleErrorSpy.mock.calls.find((call) =>
      String(call[0]).includes("tool:create_task"),
    );
    expect(loggedCall).toBeDefined();

    consoleErrorSpy.mockRestore();
  });
});
