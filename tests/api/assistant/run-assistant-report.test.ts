import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCall = vi.fn();
const mockCreate = vi.fn();
const mockComment = vi.fn();

vi.mock("../../../apps/api/src/assistant/openrouter", () => ({
  callOpenRouter: (...args: unknown[]) => mockCall(...args),
}));

vi.mock("../../../apps/api/src/assistant/similar-tasks", async () => {
  const actual = await vi.importActual<
    typeof import("../../../apps/api/src/assistant/similar-tasks")
  >("../../../apps/api/src/assistant/similar-tasks");
  return { ...actual, findSimilarTasks: async () => [] };
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

const relato =
  "O report de sexta para cá: conversei com o Bruno Dias sobre a melhoria da tela de login. " +
  "Fiz o ajuste que o Gustavo solicitou no portal MetaX. " +
  "Estou conversando com o Rafael da Bracell sobre a integração do Rainbow.";

const base = {
  token: "t",
  baseUrl: "http://localhost:1337",
  apiKey: "k",
  model: "m",
  projectId: "proj-1",
  messages: [{ role: "user" as const, content: relato }],
};

function userMessagesSent() {
  return mockCall.mock.calls.map((call) => {
    const payload = call[0] as {
      messages: { role: string; content: string }[];
    };
    return payload.messages
      .filter((message) => message.role === "user")
      .map((message) => message.content)
      .join(" ");
  });
}

describe("runAssistant: relato processado item a item", () => {
  beforeEach(() => {
    mockCall.mockReset();
    mockCreate.mockReset();
    mockComment.mockReset();
    mockCreate.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
    mockComment.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
    mockCall.mockResolvedValue({ role: "assistant", content: "registrado" });
  });

  it("manda um item por chamada, em vez da fala inteira", async () => {
    await runAssistant(base);

    const enviados = userMessagesSent();
    expect(enviados.some((texto) => texto.includes("Bruno Dias"))).toBe(true);
    expect(enviados.some((texto) => texto.includes("Gustavo"))).toBe(true);
    expect(enviados.some((texto) => texto.includes("Rainbow"))).toBe(true);
    // Nenhuma chamada recebe dois assuntos ao mesmo tempo.
    expect(
      enviados.every(
        (texto) => !(texto.includes("Bruno") && texto.includes("Rainbow")),
      ),
    ).toBe(true);
  });

  it("responde com o que foi feito em cada item", async () => {
    const result = await runAssistant(base);

    expect(result.reply).toContain("Bruno Dias");
    expect(result.reply).toContain("Rainbow");
  });

  it("nao divide um pedido comum de varias frases", async () => {
    await runAssistant({
      ...base,
      messages: [
        {
          role: "user",
          content:
            "preciso trocar o rolamento da bomba 3. ela está fazendo barulho alto. o operador reclamou hoje",
        },
      ],
    });

    expect(mockCall).toHaveBeenCalledTimes(1);
  });
});
