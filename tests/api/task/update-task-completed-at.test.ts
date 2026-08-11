import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockFindFirstColumn = vi.fn();
const mockCloseOpenEntriesForTask = vi.fn(() => Promise.resolve(0));

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: (...args: unknown[]) => mockSelect(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    query: {
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

vi.mock("../../../apps/api/src/storage/cleanup-assets", () => ({
  deleteOrphanedAssets: vi.fn(),
}));

// close-open-entries-for-task performs its own db.select/db.update calls
// against timeEntryTable; mocked separately so it never touches the
// taskTable-shaped mockSelect/mockUpdate chains above.
vi.mock(
  "../../../apps/api/src/time-entry/controllers/close-open-entries-for-task",
  () => ({
    default: (...args: unknown[]) => mockCloseOpenEntriesForTask(...args),
  }),
);

import updateTask from "../../../apps/api/src/task/controllers/update-task";

function makeSelectMock(rows: unknown[]) {
  const chain: Record<string, Mock> = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(rows)),
  };
  return chain;
}

function makeUpdateMock(updatedRow: unknown) {
  const returning = vi.fn(() => Promise.resolve([updatedRow]));
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  return { set, where, returning };
}

const base = {
  id: "task-1",
  title: "Ajustar rele",
  projectId: "project-1",
  description: "",
  priority: "low",
  position: 0,
};

function existing(status: string, completedAt: Date | null) {
  return {
    id: "task-1",
    description: "",
    status,
    projectId: "project-1",
    completedAt,
  };
}

describe("updateTask — completedAt", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Default: no matching column row, so isColumnFinal() falls back to the
    // legacy `status === "done"` check. Individual tests override this to
    // simulate a real column (e.g. a renamed final column).
    mockFindFirstColumn.mockResolvedValue(undefined);
    mockCloseOpenEntriesForTask.mockResolvedValue(0);
  });

  it("preenche completedAt ao entrar em done quando estava vazio", async () => {
    mockSelect.mockReturnValue(makeSelectMock([existing("in-progress", null)]));
    const updateChain = makeUpdateMock({
      id: "task-1",
      projectId: "project-1",
    });
    mockUpdate.mockReturnValue(updateChain);

    await updateTask({ ...base, status: "done" });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.completedAt).toBeInstanceOf(Date);
  });

  it("nao sobrescreve um completedAt ja definido", async () => {
    const manual = new Date("2026-08-08T12:00:00.000Z");
    mockSelect.mockReturnValue(
      makeSelectMock([existing("in-progress", manual)]),
    );
    const updateChain = makeUpdateMock({
      id: "task-1",
      projectId: "project-1",
    });
    mockUpdate.mockReturnValue(updateChain);

    await updateTask({ ...base, status: "done" });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.completedAt).toBe(manual);
  });

  it("limpa completedAt ao sair de done", async () => {
    mockSelect.mockReturnValue(
      makeSelectMock([existing("done", new Date("2026-08-08T12:00:00.000Z"))]),
    );
    const updateChain = makeUpdateMock({
      id: "task-1",
      projectId: "project-1",
    });
    mockUpdate.mockReturnValue(updateChain);

    await updateTask({ ...base, status: "in-progress" });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.completedAt).toBeNull();
  });

  it("aceita completedAt explicito no passado", async () => {
    const manual = new Date("2026-08-08T12:00:00.000Z");
    mockSelect.mockReturnValue(makeSelectMock([existing("done", null)]));
    const updateChain = makeUpdateMock({
      id: "task-1",
      projectId: "project-1",
    });
    mockUpdate.mockReturnValue(updateChain);

    await updateTask({ ...base, status: "done", completedAt: manual });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.completedAt).toBe(manual);
  });

  it("rejeita completedAt no futuro com 400", async () => {
    mockSelect.mockReturnValue(makeSelectMock([existing("done", null)]));
    mockUpdate.mockReturnValue(makeUpdateMock({}));

    await expect(
      updateTask({
        ...base,
        status: "done",
        completedAt: new Date(Date.now() + 86_400_000),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejeita estimatedSeconds negativo com 400", async () => {
    mockSelect.mockReturnValue(makeSelectMock([existing("to-do", null)]));
    mockUpdate.mockReturnValue(makeUpdateMock({}));

    await expect(
      updateTask({ ...base, status: "to-do", estimatedSeconds: -1 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejeita completedAt invalido (Invalid Date) com 400", async () => {
    mockSelect.mockReturnValue(makeSelectMock([existing("done", null)]));
    mockUpdate.mockReturnValue(makeUpdateMock({}));

    await expect(
      updateTask({
        ...base,
        status: "done",
        completedAt: new Date(Number.NaN),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("nao mexe em completedAt numa mudanca de status que nao envolve done", async () => {
    mockSelect.mockReturnValue(makeSelectMock([existing("to-do", null)]));
    const updateChain = makeUpdateMock({
      id: "task-1",
      projectId: "project-1",
    });
    mockUpdate.mockReturnValue(updateChain);

    await updateTask({ ...base, status: "in-progress" });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.completedAt).toBeNull();
  });

  it("nao re-carimba completedAt ao permanecer em done com data nula (regressao)", async () => {
    // Regression guard for Finding 2: a re-save that keeps a task in "done"
    // (e.g. the kanban drag handler PUTs every card in the affected columns,
    // not just the one that moved) must NOT stamp a fresh date onto legacy
    // tasks whose completed_at was left NULL by the migration.
    mockSelect.mockReturnValue(makeSelectMock([existing("done", null)]));
    const updateChain = makeUpdateMock({
      id: "task-1",
      projectId: "project-1",
    });
    mockUpdate.mockReturnValue(updateChain);

    await updateTask({ ...base, status: "done" });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.completedAt).toBeNull();
  });

  it("preenche completedAt ao entrar numa coluna final com slug diferente de 'done'", async () => {
    // Finding 4: completion is driven by the column's isFinal flag, not a
    // hardcoded "done" string, so a renamed/custom final column must behave
    // identically to the built-in "done" column.
    mockSelect.mockReturnValue(makeSelectMock([existing("in-progress", null)]));
    const updateChain = makeUpdateMock({
      id: "task-1",
      projectId: "project-1",
    });
    mockUpdate.mockReturnValue(updateChain);
    mockFindFirstColumn
      .mockResolvedValueOnce({ id: "col-1", slug: "finalizado", isFinal: true }) // destination column
      .mockResolvedValueOnce(undefined); // previous status ("in-progress") column

    await updateTask({ ...base, status: "finalizado" });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.completedAt).toBeInstanceOf(Date);
  });

  it("limpa completedAt ao sair de uma coluna final com slug diferente de 'done'", async () => {
    const manual = new Date("2026-08-08T12:00:00.000Z");
    mockSelect.mockReturnValue(
      makeSelectMock([existing("finalizado", manual)]),
    );
    const updateChain = makeUpdateMock({
      id: "task-1",
      projectId: "project-1",
    });
    mockUpdate.mockReturnValue(updateChain);
    mockFindFirstColumn
      .mockResolvedValueOnce(undefined) // destination column ("in-progress")
      .mockResolvedValueOnce({
        id: "col-1",
        slug: "finalizado",
        isFinal: true,
      }); // previous status column

    await updateTask({ ...base, status: "in-progress" });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.completedAt).toBeNull();
  });

  it("encerra as entradas de tempo em aberto ao entrar em done", async () => {
    mockSelect.mockReturnValue(makeSelectMock([existing("in-progress", null)]));
    const updateChain = makeUpdateMock({
      id: "task-1",
      projectId: "project-1",
    });
    mockUpdate.mockReturnValue(updateChain);

    await updateTask({ ...base, status: "done" });

    expect(mockCloseOpenEntriesForTask).toHaveBeenCalledWith("task-1");
  });

  it("nao encerra entradas de tempo ao permanecer em done (re-save)", async () => {
    const manual = new Date("2026-08-08T12:00:00.000Z");
    mockSelect.mockReturnValue(makeSelectMock([existing("done", manual)]));
    const updateChain = makeUpdateMock({
      id: "task-1",
      projectId: "project-1",
    });
    mockUpdate.mockReturnValue(updateChain);

    await updateTask({ ...base, status: "done" });

    expect(mockCloseOpenEntriesForTask).not.toHaveBeenCalled();
  });

  it("nao encerra nem reabre entradas de tempo ao sair de done", async () => {
    mockSelect.mockReturnValue(
      makeSelectMock([existing("done", new Date("2026-08-08T12:00:00.000Z"))]),
    );
    const updateChain = makeUpdateMock({
      id: "task-1",
      projectId: "project-1",
    });
    mockUpdate.mockReturnValue(updateChain);

    await updateTask({ ...base, status: "in-progress" });

    expect(mockCloseOpenEntriesForTask).not.toHaveBeenCalled();
  });
});
