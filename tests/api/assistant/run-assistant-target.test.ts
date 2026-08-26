import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCall = vi.fn();
const mockFindSimilar = vi.fn();
const mockComment = vi.fn();
const mockStatus = vi.fn();
const mockCreate = vi.fn();

vi.mock("../../../apps/api/src/assistant/openrouter", () => ({
  callOpenRouter: (...args: unknown[]) => mockCall(...args),
}));

vi.mock("../../../apps/api/src/assistant/similar-tasks", async () => {
  const actual = await vi.importActual<
    typeof import("../../../apps/api/src/assistant/similar-tasks")
  >("../../../apps/api/src/assistant/similar-tasks");
  return {
    ...actual,
    findSimilarTasks: (...a: unknown[]) => mockFindSimilar(...a),
  };
});

vi.mock("../../../apps/api/src/assistant/task-reference", async () => {
  const actual = await vi.importActual<
    typeof import("../../../apps/api/src/assistant/task-reference")
  >("../../../apps/api/src/assistant/task-reference");
  return {
    ...actual,
    // "35" e o chamado que a pessoa cita nos testes; ele existe no projeto.
    resolveTaskIdByNumber: async (_projectId: string, number: number) =>
      number === 35 ? "task-35" : null,
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
    {
      name: "update_task_status",
      description: "",
      inputSchema: {},
      execute: mockStatus,
    },
    {
      name: "create_task",
      description: "",
      inputSchema: {},
      execute: mockCreate,
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

const metaxA = {
  id: "a",
  number: 28,
  title: "Separação dos portais MetaX Acesso",
  description: "Separar o portal MetaX do MetaX Acesso.",
  status: "to-do",
  score: 4,
};
const metaxB = {
  id: "b",
  number: 29,
  title: "Verificar itens duplicados no MetaX Acesso",
  description: "Documentos duplicados no pedido de compra.",
  status: "to-do",
  score: 4,
};

function toolCall(id: string, name: string, args: Record<string, unknown>) {
  return {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id,
        type: "function",
        function: { name, arguments: JSON.stringify(args) },
      },
    ],
  };
}

function toolResults() {
  const payload = mockCall.mock.calls.at(-1)?.[0] as {
    messages: { role: string; content: string }[];
  };
  return payload.messages
    .filter((message) => message.role === "tool")
    .map((message) => message.content);
}

describe("runAssistant: alvo ambiguo", () => {
  beforeEach(() => {
    mockCall.mockReset();
    mockFindSimilar.mockReset();
    mockComment.mockReset();
    mockStatus.mockReset();
    mockCreate.mockReset();
    mockFindSimilar.mockResolvedValue([metaxA, metaxB]);
    mockComment.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
    mockStatus.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
  });

  it("nao deixa comentar quando dois chamados disputam o pedido", async () => {
    mockCall
      .mockResolvedValueOnce(
        toolCall("c1", "create_task_comment", {
          taskId: "a",
          content: "avisamos o Aldir",
        }),
      )
      .mockResolvedValueOnce({ role: "assistant", content: "qual delas?" });

    await runAssistant({
      ...base,
      messages: [
        {
          role: "user",
          content: "atualize o metax informando que avisamos o Aldir",
        },
      ],
    });

    expect(mockComment).not.toHaveBeenCalled();
    const [texto] = toolResults();
    expect(texto).toContain("#28");
    expect(texto).toContain("#29");
    expect(texto.toLowerCase()).toContain("ask the user");
    // A pergunta precisa oferecer a saida de criar tarefa nova: as vezes o
    // assunto simplesmente nao e nenhum dos chamados listados.
    expect(texto.toLowerCase()).toContain("whether they want a new task");
  });

  it("cria sem interromper com pergunta quando a pessoa pediu uma tarefa nova", async () => {
    mockCreate.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
    mockCall
      .mockResolvedValueOnce(
        toolCall("c1", "create_task", {
          title: "Carga Bracell Bahia Industrial",
          description: "script de carga",
        }),
      )
      .mockResolvedValueOnce({ role: "assistant", content: "feito" });

    await runAssistant({
      ...base,
      messages: [
        {
          role: "user",
          content:
            "Criei uma tarefa em progresso, carga Bracell Bahia Industrial. Foi feito um script de carga dos colaboradores ativos para o Rainbow",
        },
      ],
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("nao cria tarefa por conta propria enquanto pergunta qual e o alvo", async () => {
    mockCreate.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
    mockCall
      .mockResolvedValueOnce(
        toolCall("c1", "create_task", {
          title: "Acompanhar envio de informações do MetaX",
          description: "avisamos o Aldir",
        }),
      )
      .mockResolvedValueOnce({ role: "assistant", content: "qual delas?" });

    await runAssistant({
      ...base,
      messages: [
        {
          role: "user",
          content: "atualize o metax informando que avisamos o Aldir",
        },
      ],
    });

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("deixa agir quando a pessoa disse o numero do chamado", async () => {
    mockCall
      .mockResolvedValueOnce(
        toolCall("c1", "create_task_comment", {
          taskId: "b",
          content: "avisamos o Aldir",
        }),
      )
      .mockResolvedValueOnce({ role: "assistant", content: "feito" });

    await runAssistant({
      ...base,
      messages: [
        {
          role: "user",
          content: "atualize a tarefa 29 informando que avisamos o Aldir",
        },
      ],
    });

    expect(mockComment).toHaveBeenCalledTimes(1);
  });
});

describe("runAssistant: mudanca de status sem pedido", () => {
  beforeEach(() => {
    mockCall.mockReset();
    mockFindSimilar.mockReset();
    mockComment.mockReset();
    mockStatus.mockReset();
    mockCreate.mockReset();
    mockFindSimilar.mockResolvedValue([]);
    mockComment.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
    mockStatus.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
  });

  it("nao move o chamado de coluna quando a fala so pede para registrar algo", async () => {
    mockCall
      .mockResolvedValueOnce(
        toolCall("c1", "update_task_status", {
          taskId: "b",
          status: "in-review",
        }),
      )
      .mockResolvedValueOnce({ role: "assistant", content: "ok" });

    await runAssistant({
      ...base,
      messages: [
        {
          role: "user",
          content:
            "atualize a tarefa 29 informando que avisamos o Aldir e nada chegou",
        },
      ],
    });

    expect(mockStatus).not.toHaveBeenCalled();
    expect(toolResults()[0]?.toLowerCase()).toContain("did not ask");
  });

  it("move quando a pessoa pede", async () => {
    mockCall
      .mockResolvedValueOnce(
        toolCall("c1", "update_task_status", { taskId: "b", status: "done" }),
      )
      .mockResolvedValueOnce({ role: "assistant", content: "ok" });

    await runAssistant({
      ...base,
      messages: [
        { role: "user", content: "pode fechar a tarefa 29, já terminamos" },
      ],
    });

    expect(mockStatus).toHaveBeenCalledTimes(1);
  });
});

describe("runAssistant: alvo declarado pela pessoa", () => {
  beforeEach(() => {
    mockCall.mockReset();
    mockFindSimilar.mockReset();
    mockComment.mockReset();
    mockStatus.mockReset();
    mockCreate.mockReset();
    mockFindSimilar.mockResolvedValue([]);
    mockComment.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
    mockStatus.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
  });

  it("recusa comentar em outro chamado quando a pessoa disse o numero", async () => {
    mockCall
      .mockResolvedValueOnce(
        toolCall("c1", "create_task_comment", {
          taskId: "outro-id",
          content: "replicado para o ambiente Embraer",
        }),
      )
      .mockResolvedValueOnce({ role: "assistant", content: "ok" });

    await runAssistant({
      ...base,
      messages: [
        { role: "user", content: "é o chamado MET-35, inclui como finalizado" },
      ],
    });

    expect(mockComment).not.toHaveBeenCalled();
    const [texto] = toolResults();
    expect(texto).toContain("#35");
  });

  it("deixa agir quando o chamado e o que a pessoa declarou", async () => {
    mockCall
      .mockResolvedValueOnce(
        toolCall("c1", "create_task_comment", {
          taskId: "35",
          content: "finalizado",
        }),
      )
      .mockResolvedValueOnce({ role: "assistant", content: "ok" });

    await runAssistant({
      ...base,
      messages: [
        { role: "user", content: "no chamado 35 registra que finalizou" },
      ],
    });

    expect(mockComment).toHaveBeenCalledTimes(1);
  });
});

describe("runAssistant: consulta nao escreve", () => {
  beforeEach(() => {
    mockCall.mockReset();
    mockFindSimilar.mockReset();
    mockComment.mockReset();
    mockStatus.mockReset();
    mockCreate.mockReset();
    mockFindSimilar.mockResolvedValue([]);
    mockComment.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
    mockCreate.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
  });

  it("nao registra nada quando a fala e uma pergunta", async () => {
    mockCall
      .mockResolvedValueOnce(
        toolCall("c1", "create_task_comment", {
          taskId: "a",
          content: "pedido de lista",
        }),
      )
      .mockResolvedValueOnce({
        role: "assistant",
        content: "seguem os chamados",
      });

    await runAssistant({
      ...base,
      messages: [
        { role: "user", content: "quais chamados estão em aberto no projeto?" },
      ],
    });

    expect(mockComment).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("runAssistant: o que foi barrado aparece na resposta", () => {
  beforeEach(() => {
    mockCall.mockReset();
    mockFindSimilar.mockReset();
    mockComment.mockReset();
    mockStatus.mockReset();
    mockCreate.mockReset();
    mockFindSimilar.mockResolvedValue([]);
    mockComment.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
  });

  it("avisa quando uma acao foi barrada, para o assistente nao dizer que fez", async () => {
    mockCall
      .mockResolvedValueOnce(
        toolCall("c1", "create_task_comment", {
          taskId: "outro-id",
          content: "aplicado no ambiente Embraer",
        }),
      )
      .mockResolvedValueOnce({
        role: "assistant",
        content: "Comentario adicionado no chamado 19.",
      });

    const result = await runAssistant({
      ...base,
      messages: [
        {
          role: "user",
          content:
            "Transfira o chamado 35 para finalizado e inclua o comentario que foi aplicado no ambiente da Embraer",
        },
      ],
    });

    expect(mockComment).not.toHaveBeenCalled();
    expect(result.reply).toContain("#35");
    expect(result.reply.toLowerCase()).toContain("nao foi aplicad");
  });
});
