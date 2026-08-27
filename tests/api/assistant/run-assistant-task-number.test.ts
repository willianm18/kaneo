import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCall = vi.fn();
const mockComment = vi.fn();
const mockResolve = vi.fn();

vi.mock("../../../apps/api/src/assistant/openrouter", () => ({
  callOpenRouter: (...args: unknown[]) => mockCall(...args),
}));

vi.mock("../../../apps/api/src/assistant/similar-tasks", async () => {
  const actual = await vi.importActual<
    typeof import("../../../apps/api/src/assistant/similar-tasks")
  >("../../../apps/api/src/assistant/similar-tasks");
  return { ...actual, findSimilarTasks: async () => [] };
});

vi.mock("../../../apps/api/src/assistant/task-reference", async () => {
  const actual = await vi.importActual<
    typeof import("../../../apps/api/src/assistant/task-reference")
  >("../../../apps/api/src/assistant/task-reference");
  return {
    ...actual,
    resolveTaskIdByNumber: (...a: unknown[]) => mockResolve(...a),
  };
});

vi.mock("../../../apps/api/src/assistant/collect-tools", () => ({
  collectTools: () => [
    {
      name: "create_task_comment",
      description: "",
      inputSchema: {},
      execute: mockComment,
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
  messages: [
    {
      role: "user" as const,
      content: "comenta na tarefa 29 que o Aldir nao enviou",
    },
  ],
};

function commentCall(taskId: string) {
  return {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id: "c1",
        type: "function",
        function: {
          name: "create_task_comment",
          arguments: JSON.stringify({ taskId, content: "nada enviado" }),
        },
      },
    ],
  };
}

describe("runAssistant: numero do chamado no lugar do id", () => {
  beforeEach(() => {
    mockCall.mockReset();
    mockComment.mockReset();
    mockResolve.mockReset();
    mockComment.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
    mockResolve.mockResolvedValue("nqvxy76c7ifcx1za1h9jpat1");
    mockCall.mockResolvedValueOnce(commentCall("29")).mockResolvedValueOnce({
      role: "assistant",
      content: "ok",
    });
  });

  it("traduz o numero para o id antes de executar a ferramenta", async () => {
    await runAssistant(base);

    expect(mockResolve).toHaveBeenCalledWith("proj-1", 29);
    expect(mockComment).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "nqvxy76c7ifcx1za1h9jpat1" }),
    );
  });

  it("nao traduz quando ja veio um id de verdade", async () => {
    mockCall.mockReset();
    mockCall
      .mockResolvedValueOnce(commentCall("nqvxy76c7ifcx1za1h9jpat1"))
      .mockResolvedValueOnce({ role: "assistant", content: "ok" });

    await runAssistant(base);

    // O id chega pronto: a ferramenta recebe exatamente o que o modelo passou.
    expect(mockComment).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "nqvxy76c7ifcx1za1h9jpat1" }),
    );
  });

  it("nao mexe em chamado nenhum quando o numero citado nao existe no projeto", async () => {
    mockResolve.mockResolvedValue(null);

    const result = await runAssistant(base);

    expect(mockComment).not.toHaveBeenCalled();
    expect(result.reply.toLowerCase()).toContain("nao foi aplicad");
  });
});

describe("limite de passos", () => {
  it("aguenta um relato de turno com quatro itens sem estourar", async () => {
    mockCall.mockReset();
    mockComment.mockReset();
    mockComment.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });

    // Um item do relato costuma custar dois passos: procurar e agir. Quatro
    // itens, mais a resposta final, nao podem esbarrar no limite.
    for (let i = 0; i < 10; i++) {
      mockCall.mockResolvedValueOnce({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: `c${i}`,
            type: "function",
            function: {
              name: "create_task_comment",
              arguments: JSON.stringify({
                taskId: "nqvxy76c7ifcx1za1h9jpat1",
                content: `item ${i} do relato`,
              }),
            },
          },
        ],
      });
    }
    mockCall.mockResolvedValue({ role: "assistant", content: "pronto" });

    const result = await runAssistant({
      ...base,
      messages: [
        {
          role: "user",
          content:
            "no chamado 29 registra os quatro pontos que combinamos, um a um",
        },
      ],
    });

    // A resposta pode trazer o aviso do que ficou de fora; o que importa aqui
    // e ter chegado ao fim em vez de esbarrar no limite de passos.
    expect(result.reply).toContain("pronto");
    expect(result.reply).not.toContain("limite de passos");
  });
});
