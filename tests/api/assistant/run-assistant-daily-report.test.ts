import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCall = vi.fn();
const mockCreate = vi.fn();
const mockComment = vi.fn();
const mockStatus = vi.fn();
const mockFindDaily = vi.fn();

vi.mock("../../../apps/api/src/assistant/openrouter", () => ({
  callOpenRouter: (...args: unknown[]) => mockCall(...args),
}));

vi.mock("../../../apps/api/src/assistant/similar-tasks", async () => {
  const actual = await vi.importActual<
    typeof import("../../../apps/api/src/assistant/similar-tasks")
  >("../../../apps/api/src/assistant/similar-tasks");
  return { ...actual, findSimilarTasks: async () => [] };
});

vi.mock("../../../apps/api/src/assistant/daily-report-store", () => ({
  findTaskByTitle: (...a: unknown[]) => mockFindDaily(...a),
  findFirstColumnSlug: async () => "a-fazer",
}));

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

const relato =
  "O report de sexta para cá: conversei com o Bruno Dias sobre a melhoria da tela de login. " +
  "Fiz o ajuste que o Gustavo solicitou no portal MetaX. " +
  "Meu chamado sobre a duplicidade dos documentos ainda está em andamento.";

const base = {
  token: "t",
  baseUrl: "http://localhost:1337",
  apiKey: "k",
  model: "m",
  projectId: "proj-1",
  messages: [{ role: "user" as const, content: relato }],
};

describe("runAssistant: report diario", () => {
  beforeEach(() => {
    mockCall.mockReset();
    mockCreate.mockReset();
    mockComment.mockReset();
    mockStatus.mockReset();
    mockFindDaily.mockReset();
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"number": 42}' }],
    });
    mockComment.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
    mockFindDaily.mockResolvedValue(null);
    mockCall.mockResolvedValue({
      role: "assistant",
      content:
        "- Conversa com Bruno Dias sobre a tela de login\n- Ajuste do Gustavo no portal MetaX",
    });
  });

  it("cria o card do dia com o relato, quando ainda nao existe", async () => {
    await runAssistant(base);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const args = mockCreate.mock.calls[0]?.[0] as {
      title: string;
      description: string;
    };
    expect(args.title).toContain("Report diário");
    // A coluna vem do board, nao de um chute: projetos renomeiam colunas.
    expect((args as unknown as { status: string }).status).toBe("a-fazer");
    expect(args.description).toContain("Bruno Dias");
  });

  it("nao toca em nenhum outro chamado", async () => {
    await runAssistant(base);

    expect(mockComment).not.toHaveBeenCalled();
    expect(mockStatus).not.toHaveBeenCalled();
  });

  it("acrescenta ao card do dia quando ele ja existe, em vez de criar outro", async () => {
    mockFindDaily.mockResolvedValue({ id: "task-do-dia", number: 42 });

    await runAssistant(base);

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockComment).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-do-dia" }),
    );
  });

  it("diz onde registrou", async () => {
    const result = await runAssistant(base);

    expect(result.reply).toContain("42");
  });

  it("nao diz que registrou quando a criacao falha", async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: "text",
          text: '{"error":"Workspace ID could not be determined"}',
        },
      ],
      isError: true,
    });

    const result = await runAssistant(base);

    expect(result.reply.toLowerCase()).not.toContain("criei o report");
    expect(result.reply.toLowerCase()).toContain("nao consegui");
  });

  it("nao trata um pedido comum como report", async () => {
    mockCall.mockReset();
    mockCall.mockResolvedValue({ role: "assistant", content: "ok" });

    await runAssistant({
      ...base,
      messages: [
        {
          role: "user",
          content: "comenta na tarefa 29 que o Aldir não enviou",
        },
      ],
    });

    expect(mockCreate).not.toHaveBeenCalled();
  });
});
