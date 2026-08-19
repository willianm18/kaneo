import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCall = vi.fn();

vi.mock("../../../apps/api/src/assistant/openrouter", () => ({
  callOpenRouter: (...args: unknown[]) => mockCall(...args),
}));

const tool = (name: string) => ({
  name,
  description: name,
  inputSchema: {},
  execute: vi.fn(),
});

vi.mock("../../../apps/api/src/assistant/collect-tools", () => ({
  collectTools: () => [
    tool("create_task"),
    tool("update_task"),
    tool("list_tasks"),
    tool("get_task"),
    tool("update_task_status"),
    tool("update_task_assignee"),
    tool("update_task_due_date"),
    tool("move_task"),
    tool("delete_task"),
    tool("search"),
    tool("whoami"),
    tool("list_workspaces"),
    tool("list_projects"),
    tool("list_project_columns"),
    tool("start_task_timer"),
    tool("create_time_entry"),
    tool("create_label"),
  ],
  toOpenRouterTools: (tools: { name: string }[]) =>
    tools.map((t) => ({ type: "function", function: { name: t.name } })),
}));

import runAssistant from "../../../apps/api/src/assistant/controllers/run-assistant";

const base = {
  token: "t",
  baseUrl: "http://localhost:1337",
  apiKey: "k",
  model: "m",
};

function toolNamesSentToModel() {
  const payload = mockCall.mock.calls[0]?.[0] as {
    tools: { function: { name: string } }[];
  };
  return payload.tools.map((entry) => entry.function.name);
}

describe("runAssistant tool selection", () => {
  beforeEach(() => {
    mockCall.mockReset();
    mockCall.mockResolvedValue({ role: "assistant", content: "ok" });
  });

  it("nao envia as ferramentas de tempo quando a conversa nao fala de tempo", async () => {
    await runAssistant({
      ...base,
      messages: [
        { role: "user", content: "abre um chamado do vazamento na bomba 3" },
      ],
    });

    const names = toolNamesSentToModel();
    expect(names).toContain("create_task");
    expect(names).not.toContain("start_task_timer");
    expect(names).not.toContain("create_time_entry");
  });

  it("envia as ferramentas de tempo quando a conversa fala de apontamento", async () => {
    await runAssistant({
      ...base,
      messages: [{ role: "user", content: "apontar 2 horas nessa tarefa" }],
    });

    const names = toolNamesSentToModel();
    expect(names).toContain("create_time_entry");
    expect(names).toContain("start_task_timer");
  });

  it("considera a conversa inteira, nao so a ultima mensagem", async () => {
    await runAssistant({
      ...base,
      messages: [
        { role: "user", content: "quero apontar o tempo dessa tarefa" },
        { role: "assistant", content: "qual tarefa?" },
        { role: "user", content: "a do rolamento" },
      ],
    });

    expect(toolNamesSentToModel()).toContain("create_time_entry");
  });
});
