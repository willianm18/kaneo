import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCall = vi.fn();
const mockStatus = vi.fn();

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
  return { ...actual, resolveTaskIdByNumber: async () => "t35" };
});

vi.mock("../../../apps/api/src/assistant/collect-tools", () => ({
  collectTools: () => [
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

const statusCall = (id: string) => ({
  role: "assistant",
  content: null,
  tool_calls: [
    {
      id,
      type: "function",
      function: {
        name: "update_task_status",
        arguments: JSON.stringify({ taskId: "t35", status: "done" }),
      },
    },
  ],
});

describe("runAssistant: repeticao da mesma acao", () => {
  beforeEach(() => {
    mockCall.mockReset();
    mockStatus.mockReset();
    mockStatus.mockResolvedValue({ content: [{ type: "text", text: "{}" }] });
  });

  it("executa a mesma acao uma vez, mesmo que o modelo insista", async () => {
    // O modelo entrou em loop em producao: seis update_task_status iguais,
    // queimando o turno inteiro.
    for (let i = 0; i < 6; i++) {
      mockCall.mockResolvedValueOnce(statusCall(`c${i}`));
    }
    mockCall.mockResolvedValue({ role: "assistant", content: "pronto" });

    await runAssistant({
      token: "t",
      baseUrl: "http://localhost:1337",
      apiKey: "k",
      model: "m",
      projectId: "proj-1",
      messages: [{ role: "user", content: "fecha o chamado 35" }],
    });

    expect(mockStatus).toHaveBeenCalledTimes(1);
  });
});
