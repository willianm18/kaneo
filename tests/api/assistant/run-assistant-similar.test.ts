import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCall = vi.fn();
const mockFindSimilar = vi.fn();

vi.mock("../../../apps/api/src/assistant/openrouter", () => ({
  callOpenRouter: (...args: unknown[]) => mockCall(...args),
}));

vi.mock("../../../apps/api/src/assistant/similar-tasks", async () => {
  const actual = await vi.importActual<
    typeof import("../../../apps/api/src/assistant/similar-tasks")
  >("../../../apps/api/src/assistant/similar-tasks");
  return {
    ...actual,
    findSimilarTasks: (...args: unknown[]) => mockFindSimilar(...args),
  };
});

vi.mock("../../../apps/api/src/assistant/collect-tools", () => ({
  collectTools: () => [
    { name: "create_task", description: "", inputSchema: {}, execute: vi.fn() },
    { name: "list_tasks", description: "", inputSchema: {}, execute: vi.fn() },
    { name: "search", description: "", inputSchema: {}, execute: vi.fn() },
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

function conversationSent() {
  const payload = mockCall.mock.calls[0]?.[0] as {
    messages: { role: string; content: string }[];
  };
  return payload.messages.map((message) => message.content).join("\n---\n");
}

describe("runAssistant: chamados parecidos", () => {
  beforeEach(() => {
    mockCall.mockReset();
    mockFindSimilar.mockReset();
    mockCall.mockResolvedValue({ role: "assistant", content: "ok" });
    mockFindSimilar.mockResolvedValue([]);
  });

  it("entrega os chamados parecidos ao modelo antes de ele decidir", async () => {
    mockFindSimilar.mockResolvedValue([
      {
        id: "t7",
        number: 7,
        title: "Painel elétrico",
        description: "Faltou o disjuntor que o almoxarifado não tinha.",
        status: "to-do",
        score: 4,
      },
    ]);

    await runAssistant({
      ...base,
      messages: [
        {
          role: "user",
          content: "o disjuntor do painel chegou, falta instalar",
        },
      ],
    });

    const sent = conversationSent();
    expect(sent).toContain("Possibly related existing tickets");
    expect(sent).toContain("#7");
    expect(sent).toContain("Painel elétrico");
    expect(sent).toContain("to-do");
  });

  it("lista os trechos da fala que nao tem chamado, para virarem tarefa", async () => {
    mockFindSimilar.mockResolvedValue([
      {
        id: "t7",
        number: 7,
        title: "Painel elétrico",
        description: "Faltou o disjuntor.",
        status: "to-do",
        score: 4,
        matchedItem: "o disjuntor do painel chegou",
      },
    ]);

    await runAssistant({
      ...base,
      messages: [
        {
          role: "user",
          content:
            "o disjuntor do painel chegou; conversei com o Bruno sobre a melhoria da tela de login",
        },
      ],
    });

    const sent = conversationSent();
    expect(sent).toContain("no related ticket");
    expect(sent).toContain("tela de login");
  });

  it("procura pelo texto do que o usuario disse, no projeto atual", async () => {
    await runAssistant({
      ...base,
      messages: [{ role: "user", content: "vazamento na prensa 4" }],
    });

    expect(mockFindSimilar).toHaveBeenCalledWith(
      "proj-1",
      expect.stringContaining("vazamento na prensa 4"),
    );
  });

  it("diz para criar tarefa quando nenhum chamado casa com o item", async () => {
    mockFindSimilar.mockResolvedValue([]);

    await runAssistant({
      ...base,
      messages: [
        {
          role: "user",
          content:
            "conversei com o Bruno Dias sobre a melhoria da tela de login",
        },
      ],
    });

    expect(conversationSent()).toContain(
      "No existing ticket matches what the user just said",
    );
  });

  it("nao adiciona nada ao contexto quando nao ha parecido", async () => {
    await runAssistant({
      ...base,
      messages: [{ role: "user", content: "troca de lampada do refeitorio" }],
    });

    expect(conversationSent()).not.toContain(
      "Possibly related existing tickets",
    );
  });

  it("nao quebra o turno quando a busca falha", async () => {
    mockFindSimilar.mockRejectedValue(new Error("db offline"));

    const result = await runAssistant({
      ...base,
      messages: [{ role: "user", content: "abre um chamado" }],
    });

    expect(result.reply).toBe("ok");
  });

  it("nao procura quando nao ha projeto no contexto", async () => {
    await runAssistant({
      token: "t",
      baseUrl: "http://localhost:1337",
      apiKey: "k",
      model: "m",
      messages: [{ role: "user", content: "abre um chamado" }],
    });

    expect(mockFindSimilar).not.toHaveBeenCalled();
  });
});
