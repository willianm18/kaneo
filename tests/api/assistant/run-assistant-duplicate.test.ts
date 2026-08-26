import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCall = vi.fn();
const mockFindSimilar = vi.fn();
const mockCreate = vi.fn();
const mockComment = vi.fn();

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
      content: "o disjuntor do painel chegou, falta instalar",
    },
  ],
};

const painelAberto = {
  id: "t7",
  number: 7,
  title: "Painel elétrico",
  description: "Faltou o disjuntor que o almoxarifado não tinha.",
  status: "to-do",
  score: 3,
};

function createTaskCall(id: string, title: string) {
  return {
    role: "assistant",
    content: null,
    tool_calls: [
      {
        id,
        type: "function",
        function: {
          name: "create_task",
          arguments: JSON.stringify({ title, description: "" }),
        },
      },
    ],
  };
}

function toolResultTexts() {
  const conversation = mockCall.mock.calls.at(-1)?.[0] as {
    messages: { role: string; content: string }[];
  };
  return conversation.messages
    .filter((message) => message.role === "tool")
    .map((message) => message.content);
}

describe("runAssistant: barreira de duplicata", () => {
  beforeEach(() => {
    mockCall.mockReset();
    mockFindSimilar.mockReset();
    mockCreate.mockReset();
    mockComment.mockReset();
    mockFindSimilar.mockResolvedValue([painelAberto]);
    mockCreate.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
    mockComment.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
  });

  it("nao cria a tarefa quando ela repete um chamado aberto, e diz qual e", async () => {
    mockCall
      .mockResolvedValueOnce(
        createTaskCall("c1", "Instalação do disjuntor do painel"),
      )
      .mockResolvedValueOnce({ role: "assistant", content: "ok" });

    await runAssistant(base);

    expect(mockCreate).not.toHaveBeenCalled();
    const [texto] = toolResultTexts();
    expect(texto).toContain("#7");
    expect(texto).toContain("create_task_comment");
  });

  it("cria quando o modelo insiste com a mesma tarefa: a barreira avisa, nao impede", async () => {
    mockCall
      .mockResolvedValueOnce(
        createTaskCall("c1", "Instalação do disjuntor do painel"),
      )
      .mockResolvedValueOnce(
        createTaskCall("c2", "Instalação do disjuntor do painel"),
      )
      .mockResolvedValueOnce({ role: "assistant", content: "ok" });

    await runAssistant(base);

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("nao atrapalha a criacao de um assunto novo", async () => {
    mockCall
      .mockResolvedValueOnce(
        createTaskCall("c1", "Vazamento na linha de ar da prensa 4"),
      )
      .mockResolvedValueOnce({ role: "assistant", content: "ok" });

    await runAssistant(base);

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("nao interfere em outras ferramentas", async () => {
    mockCall
      .mockResolvedValueOnce({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: {
              name: "create_task_comment",
              arguments: JSON.stringify({ taskId: "t7", content: "chegou" }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({ role: "assistant", content: "ok" });

    await runAssistant(base);

    expect(mockComment).toHaveBeenCalledTimes(1);
  });
});

describe("runAssistant: pedido explicito de abrir chamado", () => {
  beforeEach(() => {
    mockCall.mockReset();
    mockFindSimilar.mockReset();
    mockCreate.mockReset();
    mockComment.mockReset();
    mockFindSimilar.mockResolvedValue([painelAberto]);
    mockCreate.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
    mockComment.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
  });

  it("cria assim que a pessoa pede um chamado, mesmo havendo parecido", async () => {
    mockCall
      .mockResolvedValueOnce(createTaskCall("c1", "Disjuntor do painel"))
      .mockResolvedValueOnce({ role: "assistant", content: "ok" });

    await runAssistant({
      ...base,
      messages: [
        {
          role: "user",
          content: "Abra um chamado sobre o disjuntor do painel elétrico",
        },
      ],
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("nao deixa comentar em outros chamados quando o pedido era abrir um novo", async () => {
    mockCall
      .mockResolvedValueOnce({
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: {
              name: "create_task_comment",
              arguments: JSON.stringify({
                taskId: "t7",
                content: "novo chamado aberto sobre o disjuntor",
              }),
            },
          },
        ],
      })
      .mockResolvedValueOnce({ role: "assistant", content: "ok" });

    await runAssistant({
      ...base,
      messages: [
        {
          role: "user",
          content: "Abra um chamado sobre o disjuntor do painel",
        },
      ],
    });

    expect(mockComment).not.toHaveBeenCalled();
  });

  it("diz ao modelo para criar, e nao para agir no parecido, quando o chamado foi pedido", async () => {
    mockCall.mockResolvedValue({ role: "assistant", content: "ok" });

    await runAssistant({
      ...base,
      messages: [
        {
          role: "user",
          content: "Abra um chamado sobre o disjuntor do painel",
        },
      ],
    });

    const payload = mockCall.mock.calls[0]?.[0] as {
      messages: { content: string }[];
    };
    const contexto = payload.messages.map((m) => m.content).join("\n");

    expect(contexto).toContain("The user explicitly asked for a new ticket");
    expect(contexto).toContain("#7");
  });
});
