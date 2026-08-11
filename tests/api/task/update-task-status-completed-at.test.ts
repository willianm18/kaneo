import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindFirstTask = vi.fn();
const mockFindFirstColumn = vi.fn();
const mockUpdate = vi.fn();

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    update: (...args: unknown[]) => mockUpdate(...args),
    query: {
      taskTable: {
        findFirst: (...args: unknown[]) => mockFindFirstTask(...args),
      },
      columnTable: {
        findFirst: (...args: unknown[]) => mockFindFirstColumn(...args),
      },
    },
  },
}));

vi.mock("../../../apps/api/src/events", () => ({
  publishEvent: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../../apps/api/src/task/validate-task-fields", () => ({
  assertValidTaskStatus: vi.fn(() => Promise.resolve()),
}));

import updateTaskStatus from "../../../apps/api/src/task/controllers/update-task-status";

function makeUpdateMock(updatedRow: unknown) {
  const returning = vi.fn(() => Promise.resolve([updatedRow]));
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  return { set, where, returning };
}

function task(status: string, completedAt: Date | null) {
  return {
    id: "task-1",
    projectId: "project-1",
    status,
    completedAt,
    title: "Ajustar rele",
    userId: null,
  };
}

describe("updateTaskStatus — completedAt", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: no matching column row for either lookup, so isColumnFinal()
    // falls back to the legacy `status === "done"` check.
    mockFindFirstColumn.mockResolvedValue(undefined);
  });

  it("preenche completedAt ao entrar em done", async () => {
    mockFindFirstTask.mockResolvedValue(task("in-progress", null));
    const updateChain = makeUpdateMock({
      id: "task-1",
      projectId: "project-1",
    });
    mockUpdate.mockReturnValue(updateChain);

    await updateTaskStatus({
      id: "task-1",
      status: "done",
      currentUserId: "user-1",
    });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.completedAt).toBeInstanceOf(Date);
  });

  it("limpa completedAt ao sair de done", async () => {
    const manual = new Date("2026-08-08T12:00:00.000Z");
    mockFindFirstTask.mockResolvedValue(task("done", manual));
    const updateChain = makeUpdateMock({
      id: "task-1",
      projectId: "project-1",
    });
    mockUpdate.mockReturnValue(updateChain);

    await updateTaskStatus({
      id: "task-1",
      status: "in-progress",
      currentUserId: "user-1",
    });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.completedAt).toBeNull();
  });

  it("nao re-carimba completedAt ao permanecer em done com data nula (regressao)", async () => {
    // Same regression guard as update-task.ts: the status-change path must
    // not stamp a fresh date onto a legacy task that stays in "done".
    mockFindFirstTask.mockResolvedValue(task("done", null));
    const updateChain = makeUpdateMock({
      id: "task-1",
      projectId: "project-1",
    });
    mockUpdate.mockReturnValue(updateChain);

    await updateTaskStatus({
      id: "task-1",
      status: "done",
      currentUserId: "user-1",
    });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.completedAt).toBeNull();
  });

  it("preserva completedAt ja definido ao permanecer em done", async () => {
    const manual = new Date("2026-08-08T12:00:00.000Z");
    mockFindFirstTask.mockResolvedValue(task("done", manual));
    const updateChain = makeUpdateMock({
      id: "task-1",
      projectId: "project-1",
    });
    mockUpdate.mockReturnValue(updateChain);

    await updateTaskStatus({
      id: "task-1",
      status: "done",
      currentUserId: "user-1",
    });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.completedAt).toBe(manual);
  });

  it("nao mexe em completedAt numa mudanca de status que nao envolve done", async () => {
    mockFindFirstTask.mockResolvedValue(task("to-do", null));
    const updateChain = makeUpdateMock({
      id: "task-1",
      projectId: "project-1",
    });
    mockUpdate.mockReturnValue(updateChain);

    await updateTaskStatus({
      id: "task-1",
      status: "in-progress",
      currentUserId: "user-1",
    });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.completedAt).toBeNull();
  });

  it("preenche completedAt ao entrar numa coluna final com slug diferente de 'done'", async () => {
    // Finding 4: completion must be driven by the column's isFinal flag, not
    // a hardcoded "done" string — a renamed/custom final column (e.g.
    // "finalizado") must behave identically to the built-in "done" column.
    mockFindFirstTask.mockResolvedValue(task("in-progress", null));
    mockFindFirstColumn
      .mockResolvedValueOnce({
        id: "col-finalizado",
        slug: "finalizado",
        isFinal: true,
      }) // destination column
      .mockResolvedValueOnce(undefined); // previous status ("in-progress") column
    const updateChain = makeUpdateMock({
      id: "task-1",
      projectId: "project-1",
    });
    mockUpdate.mockReturnValue(updateChain);

    await updateTaskStatus({
      id: "task-1",
      status: "finalizado",
      currentUserId: "user-1",
    });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.completedAt).toBeInstanceOf(Date);
  });

  it("limpa completedAt ao sair de uma coluna final com slug diferente de 'done'", async () => {
    const manual = new Date("2026-08-08T12:00:00.000Z");
    mockFindFirstTask.mockResolvedValue(task("finalizado", manual));
    mockFindFirstColumn
      .mockResolvedValueOnce(undefined) // destination column ("in-progress")
      .mockResolvedValueOnce({
        id: "col-finalizado",
        slug: "finalizado",
        isFinal: true,
      }); // previous status column
    const updateChain = makeUpdateMock({
      id: "task-1",
      projectId: "project-1",
    });
    mockUpdate.mockReturnValue(updateChain);

    await updateTaskStatus({
      id: "task-1",
      status: "in-progress",
      currentUserId: "user-1",
    });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.completedAt).toBeNull();
  });
});
