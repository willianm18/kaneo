import { beforeEach, describe, expect, it, vi } from "vitest";

const mockFindFirstTask = vi.fn();
const mockFindFirstProject = vi.fn();
const mockFindFirstColumn = vi.fn();
const mockSelect = vi.fn();
const mockCloseOpenEntriesForTask = vi.fn(() => Promise.resolve(0));
const mockClaimTaskNumber = vi.fn(() => Promise.resolve(1));

function makeSelectMock(rows: unknown[]) {
  // `.where()` may be the terminal call (awaited directly) or may be
  // followed by `.orderBy()` — support both by basing the chain on a real
  // Promise (so it's genuinely awaitable via its inherited `then`) and
  // attaching the chain methods as own properties on top of it.
  const chain = Promise.resolve(rows) as Promise<unknown[]> &
    Record<string, unknown>;
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => Promise.resolve(rows));
  return chain;
}

function createMockTxContext(updatedTask: unknown) {
  const updateReturning = vi.fn(() => Promise.resolve([updatedTask]));
  const updateWhere = vi.fn(() => ({ returning: updateReturning }));
  const updateSet = vi.fn(() => ({ where: updateWhere }));
  return {
    update: vi.fn(() => ({ set: updateSet })),
    select: vi.fn(() => makeSelectMock([{ maxPosition: 0 }])),
  };
}

let txUpdatedTask: unknown;
const mockTransaction = vi.fn(async (cb: (tx: unknown) => unknown) =>
  cb(createMockTxContext(txUpdatedTask)),
);

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    query: {
      taskTable: {
        findFirst: (...args: unknown[]) => mockFindFirstTask(...args),
      },
      projectTable: {
        findFirst: (...args: unknown[]) => mockFindFirstProject(...args),
      },
      columnTable: {
        findFirst: (...args: unknown[]) => mockFindFirstColumn(...args),
      },
    },
    select: (...args: unknown[]) => mockSelect(...args),
    transaction: (...args: unknown[]) => mockTransaction(...args),
  },
}));

vi.mock("../../../apps/api/src/events", () => ({
  publishEvent: vi.fn(() => Promise.resolve()),
}));

vi.mock(
  "../../../apps/api/src/time-entry/controllers/close-open-entries-for-task",
  () => ({
    default: (...args: unknown[]) => mockCloseOpenEntriesForTask(...args),
  }),
);

vi.mock("../../../apps/api/src/task/controllers/claim-task-numbers", () => ({
  claimTaskNumber: (...args: unknown[]) => mockClaimTaskNumber(...args),
}));

import moveTask from "../../../apps/api/src/task/controllers/move-task";

function task(status: string, completedAt: Date | null) {
  return {
    id: "task-1",
    projectId: "project-a",
    status,
    completedAt,
    title: "Ajustar rele",
  };
}

describe("moveTask — encerramento de entradas de tempo", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCloseOpenEntriesForTask.mockResolvedValue(0);
    mockClaimTaskNumber.mockResolvedValue(1);
    mockFindFirstColumn.mockResolvedValue(undefined);
    // Both source and destination projects share the same workspace.
    mockFindFirstProject.mockResolvedValue({
      id: "project-x",
      workspaceId: "workspace-1",
    });
    // Destination workflow: one column matching the resolved status.
    mockSelect.mockReturnValue(
      makeSelectMock([
        { id: "col-done", slug: "done", position: 1, isFinal: true },
        { id: "col-todo", slug: "to-do", position: 0, isFinal: false },
      ]),
    );
  });

  it("encerra as entradas de tempo em aberto ao entrar numa coluna final no destino", async () => {
    mockFindFirstTask.mockResolvedValue(task("in-progress", null));
    txUpdatedTask = { id: "task-1", projectId: "project-b" };

    await moveTask({
      taskId: "task-1",
      destinationProjectId: "project-b",
      destinationStatus: "done",
      currentUserId: "user-1",
    });

    expect(mockCloseOpenEntriesForTask).toHaveBeenCalledWith("task-1");
  });

  it("nao encerra entradas de tempo quando o destino nao e final", async () => {
    mockFindFirstTask.mockResolvedValue(task("in-progress", null));
    txUpdatedTask = { id: "task-1", projectId: "project-b" };

    await moveTask({
      taskId: "task-1",
      destinationProjectId: "project-b",
      destinationStatus: "to-do",
      currentUserId: "user-1",
    });

    expect(mockCloseOpenEntriesForTask).not.toHaveBeenCalled();
  });

  it("nao encerra entradas de tempo quando a tarefa ja estava em coluna final", async () => {
    mockFindFirstTask.mockResolvedValue(
      task("done", new Date("2026-08-08T12:00:00.000Z")),
    );
    txUpdatedTask = { id: "task-1", projectId: "project-b" };

    await moveTask({
      taskId: "task-1",
      destinationProjectId: "project-b",
      destinationStatus: "done",
      currentUserId: "user-1",
    });

    expect(mockCloseOpenEntriesForTask).not.toHaveBeenCalled();
  });
});
