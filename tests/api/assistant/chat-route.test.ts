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

async function requestPendingConfirmation() {
  mockCall.mockResolvedValueOnce(assistantToolCall("c9", "delete_task"));
  const res = await postChat({
    messages: [{ role: "user", content: "apague a tarefa X" }],
  });
  expect(res.status).toBe(200);
  return res.json() as Promise<{
    pendingConfirmation?: { toolCallId: string; tool: string };
    conversationState?: unknown[];
    conversationSignature?: string;
  }>;
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
    const body = await res.json();
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
