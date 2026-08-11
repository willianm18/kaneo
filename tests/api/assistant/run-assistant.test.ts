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

import runAssistant from "../../../apps/api/src/assistant/controllers/run-assistant";

const base = {
  token: "t",
  baseUrl: "http://localhost:1337",
  apiKey: "k",
  model: "m",
  messages: [{ role: "user" as const, content: "oi" }],
};

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

describe("runAssistant", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockExecute.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
  });

  it("responde direto quando o modelo nao pede ferramenta", async () => {
    mockCall.mockResolvedValueOnce(assistantText("tudo certo"));

    const result = await runAssistant(base);

    expect(result.reply).toBe("tudo certo");
    expect(result.actions).toHaveLength(0);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("executa a ferramenta e devolve a resposta final", async () => {
    mockCall
      .mockResolvedValueOnce(assistantToolCall("c1", "create_task"))
      .mockResolvedValueOnce(assistantText("criei a tarefa"));

    const result = await runAssistant(base);

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(result.reply).toBe("criei a tarefa");
    expect(result.actions).toEqual([
      expect.objectContaining({ tool: "create_task" }),
    ]);
  });

  it("NAO executa exclusao sem confirmacao e devolve pendingConfirmation", async () => {
    mockCall.mockResolvedValueOnce(assistantToolCall("c9", "delete_task"));

    const result = await runAssistant(base);

    expect(mockExecute).not.toHaveBeenCalled();
    expect(result.pendingConfirmation).toMatchObject({
      toolCallId: "c9",
      tool: "delete_task",
    });
  });

  it("executa a exclusao quando o toolCallId correto e confirmado", async () => {
    mockCall
      .mockResolvedValueOnce(assistantToolCall("c9", "delete_task"))
      .mockResolvedValueOnce(assistantText("apaguei"));

    const result = await runAssistant({ ...base, confirmations: ["c9"] });

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(result.reply).toBe("apaguei");
  });

  it("NAO executa a exclusao quando o toolCallId confirmado e outro", async () => {
    mockCall.mockResolvedValueOnce(assistantToolCall("c9", "delete_task"));

    const result = await runAssistant({ ...base, confirmations: ["outro"] });

    expect(mockExecute).not.toHaveBeenCalled();
    expect(result.pendingConfirmation?.toolCallId).toBe("c9");
  });

  it("para no limite de 8 voltas", async () => {
    mockCall.mockResolvedValue(assistantToolCall("c1", "create_task"));

    const result = await runAssistant(base);

    expect(mockCall).toHaveBeenCalledTimes(8);
    expect(result.reply.length).toBeGreaterThan(0);
  });

  it("devolve o erro da ferramenta ao modelo em vez de estourar", async () => {
    mockExecute.mockResolvedValue({
      content: [{ type: "text", text: "permission denied" }],
      isError: true,
    });
    mockCall
      .mockResolvedValueOnce(assistantToolCall("c1", "create_task"))
      .mockResolvedValueOnce(assistantText("nao consegui: sem permissao"));

    const result = await runAssistant(base);

    expect(result.reply).toContain("sem permissao");
  });
});
