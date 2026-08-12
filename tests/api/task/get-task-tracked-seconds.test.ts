import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const mockSelect = vi.fn();

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: (...args: unknown[]) => mockSelect(...args),
  },
}));

import getTask from "../../../apps/api/src/task/controllers/get-task";

function makeSelectMock(rows: unknown[]) {
  const chain: Record<string, Mock> = {
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(rows)),
  };
  return chain;
}

describe("getTask — trackedSeconds", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("inclui trackedSeconds na selecao de colunas", async () => {
    mockSelect.mockReturnValue(makeSelectMock([{ id: "task-1" }]));

    await getTask("task-1");

    const selection = mockSelect.mock.calls[0][0] as Record<string, unknown>;
    expect(selection.trackedSeconds).toBeDefined();
  });

  it("retorna trackedSeconds vindo da subquery agregada", async () => {
    mockSelect.mockReturnValue(
      makeSelectMock([{ id: "task-1", trackedSeconds: 3600 }]),
    );

    const task = await getTask("task-1");

    expect(task.trackedSeconds).toBe(3600);
  });

  it("retorna trackedSeconds 0 quando a task nao possui entradas de tempo", async () => {
    mockSelect.mockReturnValue(
      makeSelectMock([{ id: "task-1", trackedSeconds: 0 }]),
    );

    const task = await getTask("task-1");

    expect(task.trackedSeconds).toBe(0);
  });
});
