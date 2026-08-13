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

import runAssistant, {
  AssistantStageError,
} from "../../../apps/api/src/assistant/controllers/run-assistant";

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

function assistantToolCalls(
  calls: { id: string; name: string; args?: string }[],
) {
  return {
    role: "assistant",
    content: null,
    tool_calls: calls.map(({ id, name, args = "{}" }) => ({
      id,
      type: "function",
      function: { name, arguments: args },
    })),
  };
}

function toolResult(id: string, content = "ok") {
  return { role: "tool", tool_call_id: id, content };
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

  it("chama onProgress com o nome da ferramenta antes de executa-la", async () => {
    mockCall
      .mockResolvedValueOnce(assistantToolCall("c1", "create_task"))
      .mockResolvedValueOnce(assistantText("criei a tarefa"));

    const onProgress = vi.fn();
    await runAssistant({ ...base, onProgress });

    expect(onProgress).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledWith("create_task");
    // onProgress must fire before the tool actually runs, so the caller can
    // stream a progress event ahead of the (possibly slow) execution.
    expect(onProgress.mock.invocationCallOrder[0]).toBeLessThan(
      mockExecute.mock.invocationCallOrder[0],
    );
  });

  it("propaga uma falha da ferramenta como AssistantStageError com o estagio da ferramenta", async () => {
    mockCall.mockResolvedValueOnce(assistantToolCall("c1", "create_task"));
    mockExecute.mockRejectedValueOnce(new Error("db unreachable"));

    await expect(runAssistant(base)).rejects.toMatchObject({
      name: "AssistantStageError",
      stage: "tool:create_task",
    });
  });

  it("propaga uma falha do modelo como AssistantStageError com o estagio da volta", async () => {
    mockCall.mockRejectedValueOnce(new Error("provider unreachable"));

    const error = await runAssistant(base).catch((caught) => caught);

    expect(error).toBeInstanceOf(AssistantStageError);
    expect((error as InstanceType<typeof AssistantStageError>).stage).toBe(
      "model-turn-0",
    );
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

  it("resume conclui a exclusao apos a confirmacao", async () => {
    mockCall
      .mockResolvedValueOnce(assistantToolCall("c9", "delete_task"))
      .mockResolvedValueOnce(assistantText("apaguei"));

    const first = await runAssistant(base);

    expect(mockExecute).not.toHaveBeenCalled();
    expect(first.pendingConfirmation).toMatchObject({
      toolCallId: "c9",
      tool: "delete_task",
    });
    expect(first.conversationState).toBeDefined();

    const second = await runAssistant({
      ...base,
      resumeFrom: first.conversationState,
      confirmations: ["c9"],
    });

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(second.pendingConfirmation).toBeUndefined();
    expect(second.reply).toBe("apaguei");
  });

  it("resume nao reexecuta uma ferramenta ja concluida", async () => {
    const resumeFrom = [
      { role: "system", content: "sys" },
      { role: "user", content: "crie a tarefa e apague a antiga" },
      assistantToolCalls([
        { id: "c1", name: "create_task" },
        { id: "c9", name: "delete_task" },
      ]),
      toolResult("c1", "tarefa criada"),
    ];

    mockCall.mockResolvedValueOnce(assistantText("feito"));

    const result = await runAssistant({
      ...base,
      resumeFrom,
      confirmations: ["c9"],
    });

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(result.pendingConfirmation).toBeUndefined();
    expect(result.reply).toBe("feito");
  });

  it("resposta vazia sem acoes: repete uma vez e usa a segunda resposta", async () => {
    mockCall
      .mockResolvedValueOnce(assistantText(""))
      .mockResolvedValueOnce(assistantText("agora respondi"));

    const result = await runAssistant(base);

    expect(mockCall).toHaveBeenCalledTimes(2);
    expect(result.reply).toBe("agora respondi");
    expect(result.actions).toHaveLength(0);
  });

  it("resposta vazia duas vezes seguidas: falha com AssistantStageError logavel", async () => {
    mockCall
      .mockResolvedValueOnce(assistantText("   "))
      .mockResolvedValueOnce(assistantText(""));

    const error = await runAssistant(base).catch((caught) => caught);

    expect(mockCall).toHaveBeenCalledTimes(2);
    expect(error).toBeInstanceOf(AssistantStageError);
    expect((error as InstanceType<typeof AssistantStageError>).stage).toBe(
      "model-turn-0-retry",
    );
  });

  it("resposta vazia apos executar uma ferramenta: NAO repete e avisa sobre aplicacao parcial", async () => {
    mockCall
      .mockResolvedValueOnce(assistantToolCall("c1", "create_task"))
      .mockResolvedValueOnce(assistantText(""));

    const result = await runAssistant(base);

    expect(mockCall).toHaveBeenCalledTimes(2);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(result.reply).toMatch(/parcial|Confira/i);
    expect(result.actions).toHaveLength(1);
  });

  it("resume ainda recusa um id de confirmacao errado", async () => {
    const resumeFrom = [
      { role: "system", content: "sys" },
      { role: "user", content: "apague a tarefa" },
      assistantToolCall("c9", "delete_task"),
    ];

    const result = await runAssistant({
      ...base,
      resumeFrom,
      confirmations: ["outro"],
    });

    expect(mockExecute).not.toHaveBeenCalled();
    expect(mockCall).not.toHaveBeenCalled();
    expect(result.pendingConfirmation?.toolCallId).toBe("c9");
    expect(result.conversationState).toBeDefined();
  });
});
