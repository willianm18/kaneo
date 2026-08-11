import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const mockSelect = vi.fn();

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: (...args: unknown[]) => mockSelect(...args),
  },
}));

import { taskTable } from "../../../apps/api/src/database/schema";
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

describe("getTask — completedAt/estimatedSeconds", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("inclui completedAt e estimatedSeconds na selecao de colunas", async () => {
    mockSelect.mockReturnValue(makeSelectMock([{ id: "task-1" }]));

    await getTask("task-1");

    // Regression guard for Finding 1: get-task.ts built an explicit column
    // selection that silently omitted these two columns, so saved values
    // never made it back to the UI even though they were persisted.
    const selection = mockSelect.mock.calls[0][0] as Record<string, unknown>;
    expect(selection.completedAt).toBe(taskTable.completedAt);
    expect(selection.estimatedSeconds).toBe(taskTable.estimatedSeconds);
  });

  it("retorna completedAt e estimatedSeconds vindos da linha do banco", async () => {
    const completedAt = new Date("2026-08-08T12:00:00.000Z");
    mockSelect.mockReturnValue(
      makeSelectMock([{ id: "task-1", completedAt, estimatedSeconds: 3600 }]),
    );

    const task = await getTask("task-1");

    expect(task.completedAt).toBe(completedAt);
    expect(task.estimatedSeconds).toBe(3600);
  });
});
