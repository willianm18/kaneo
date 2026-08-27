import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCall = vi.fn();
const mockCreate = vi.fn();
const mockComment = vi.fn();
const mockStatus = vi.fn();

vi.mock("../../../apps/api/src/assistant/openrouter", () => ({
  callOpenRouter: (...args: unknown[]) => mockCall(...args),
}));

vi.mock("../../../apps/api/src/assistant/task-reference", async () => {
  const actual = await vi.importActual<
    typeof import("../../../apps/api/src/assistant/task-reference")
  >("../../../apps/api/src/assistant/task-reference");
  return {
    ...actual,
    resolveTaskIdByNumber: async (_p: string, number: number) =>
      number === 35 ? "task-35" : null,
  };
});

vi.mock("../../../apps/api/src/assistant/collect-tools", () => ({
  collectTools: () => [
    {
      name: "create_task",
      description: "",
      inputSchema: {},
      execute: mockCreate,
    },
    {
      name: "create_task_comment",
      description: "",
      inputSchema: {},
      execute: mockComment,
    },
    {
      name: "update_task_status",
      description: "",
      inputSchema: {},
      execute: mockStatus,
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
  projectId: "proj-1",
};

const commentCall = (taskId: string) => ({
  role: "assistant",
  content: null,
  tool_calls: [
    {
      id: "c1",
      type: "function",
      function: {
        name: "create_task_comment",
        arguments: JSON.stringify({ taskId, content: "texto" }),
      },
    },
  ],
});

function conversationSent() {
  const payload = mockCall.mock.calls[0]?.[0] as {
    messages: { content: string }[];
  };
  return payload.messages.map((m) => m.content).join("\n");
}

describe("runAssistant: nada de adivinhar chamado", () => {
  beforeEach(() => {
    mockCall.mockReset();
    mockCreate.mockReset();
    mockComment.mockReset();
    mockStatus.mockReset();
    mockCreate.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
    mockComment.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
    mockStatus.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
  });

  it("nao oferece lista de chamados parecidos no contexto", async () => {
    mockCall.mockResolvedValue({ role: "assistant", content: "ok" });

    await runAssistant({
      ...base,
      messages: [
        {
          role: "user",
          content: "quero um card novo replicando o 1910 para o Embraer",
        },
      ],
    });

    expect(conversationSent()).not.toContain(
      "Possibly related existing tickets",
    );
  });

  it("recusa comentar em chamado que a pessoa nao citou", async () => {
    mockCall
      .mockResolvedValueOnce(commentCall("qualquer-id"))
      .mockResolvedValueOnce({ role: "assistant", content: "ok" });

    const result = await runAssistant({
      ...base,
      messages: [
        {
          role: "user",
          content:
            "Eu queria um novos card em ToDo, replicar o chamado 1910 para o ambiente Embraer",
        },
      ],
    });

    expect(mockComment).not.toHaveBeenCalled();
    expect(result.reply.toLowerCase()).toContain("nao foi aplicad");
  });

  it("deixa agir no chamado que a pessoa citou", async () => {
    mockCall
      .mockResolvedValueOnce(commentCall("task-35"))
      .mockResolvedValueOnce({ role: "assistant", content: "ok" });

    await runAssistant({
      ...base,
      messages: [
        { role: "user", content: "no chamado 35 registra que finalizou" },
      ],
    });

    expect(mockComment).toHaveBeenCalledTimes(1);
  });

  it("deixa agir na tarefa que acabou de ser criada na mesma conversa", async () => {
    mockCall
      .mockResolvedValueOnce(commentCall("nqvxy76c7ifcx1za1h9jpat1"))
      .mockResolvedValueOnce({ role: "assistant", content: "ok" });

    await runAssistant({
      ...base,
      messages: [
        { role: "user", content: "abre um chamado sobre o vazamento" },
        {
          role: "assistant",
          content:
            "Criei o chamado. [sistema: nesta conversa voce ja agiu na tarefa nqvxy76c7ifcx1za1h9jpat1]",
        },
        { role: "user", content: "coloca também que o operador escorregou" },
      ],
    });

    expect(mockComment).toHaveBeenCalledTimes(1);
  });
});
