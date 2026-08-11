import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockCloseOpenEntriesForTask = vi.fn(() => Promise.resolve(0));

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: (...args: unknown[]) => mockSelect(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

vi.mock("../../../apps/api/src/events", () => ({
  publishEvent: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../../apps/api/src/task/validate-task-fields", () => ({
  assertValidTaskStatus: vi.fn(() => Promise.resolve()),
  assertValidPriority: vi.fn(),
}));

vi.mock(
  "../../../apps/api/src/plugins/github/utils/sync-label-to-github",
  () => ({ removeLabelFromGitHub: vi.fn() }),
);

vi.mock(
  "../../../apps/api/src/plugins/gitea/utils/sync-label-to-gitea",
  () => ({ removeLabelFromGitea: vi.fn() }),
);

vi.mock(
  "../../../apps/api/src/time-entry/controllers/close-open-entries-for-task",
  () => ({
    default: (...args: unknown[]) => mockCloseOpenEntriesForTask(...args),
  }),
);

import bulkUpdateTasks from "../../../apps/api/src/task/controllers/bulk-update-tasks";

function makeSelectMock(rows: unknown[]) {
  // Based on a real Promise so it's genuinely awaitable via its inherited
  // `then`, with the chain methods attached as own properties on top.
  const chain = Promise.resolve(rows) as Promise<unknown[]> &
    Record<string, unknown>;
  chain.from = vi.fn(() => chain);
  chain.innerJoin = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => Promise.resolve(rows));
  return chain;
}

function makeUpdateMock() {
  const chain: Record<string, unknown> = {};
  chain.set = vi.fn(() => chain);
  chain.where = vi.fn(() => Promise.resolve({ rowCount: 1 }));
  return chain;
}

describe("bulkUpdateTasks — encerramento de entradas de tempo", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockCloseOpenEntriesForTask.mockResolvedValue(0);
  });

  it("encerra as entradas de tempo das tarefas que entram numa coluna final", async () => {
    let call = 0;
    mockSelect.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        // tasks lookup (joined with project)
        return makeSelectMock([
          {
            id: "task-1",
            title: "T1",
            status: "in-progress",
            projectId: "project-1",
            userId: null,
            dueDate: null,
            completedAt: null,
            workspaceId: "workspace-1",
          },
        ]);
      }
      if (call === 2) {
        // workspace membership check
        return makeSelectMock([{ id: "member-1" }]);
      }
      // per-project columns lookup
      return makeSelectMock([
        { id: "col-done", slug: "done", isFinal: true },
        { id: "col-in-progress", slug: "in-progress", isFinal: false },
      ]);
    });
    mockUpdate.mockReturnValue(makeUpdateMock());

    await bulkUpdateTasks({
      taskIds: ["task-1"],
      operation: "updateStatus",
      value: "done",
      userId: "user-1",
    });

    expect(mockCloseOpenEntriesForTask).toHaveBeenCalledWith(
      "task-1",
      expect.any(Date),
    );
  });

  it("nao encerra entradas de tempo quando o novo status nao e final", async () => {
    let call = 0;
    mockSelect.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return makeSelectMock([
          {
            id: "task-1",
            title: "T1",
            status: "to-do",
            projectId: "project-1",
            userId: null,
            dueDate: null,
            completedAt: null,
            workspaceId: "workspace-1",
          },
        ]);
      }
      if (call === 2) {
        return makeSelectMock([{ id: "member-1" }]);
      }
      return makeSelectMock([
        { id: "col-in-progress", slug: "in-progress", isFinal: false },
        { id: "col-todo", slug: "to-do", isFinal: false },
      ]);
    });
    mockUpdate.mockReturnValue(makeUpdateMock());

    await bulkUpdateTasks({
      taskIds: ["task-1"],
      operation: "updateStatus",
      value: "in-progress",
      userId: "user-1",
    });

    expect(mockCloseOpenEntriesForTask).not.toHaveBeenCalled();
  });

  it("nao encerra entradas de tempo quando a tarefa ja estava numa coluna final", async () => {
    let call = 0;
    mockSelect.mockImplementation(() => {
      call += 1;
      if (call === 1) {
        return makeSelectMock([
          {
            id: "task-1",
            title: "T1",
            status: "done",
            projectId: "project-1",
            userId: null,
            dueDate: null,
            completedAt: new Date("2026-08-08T12:00:00.000Z"),
            workspaceId: "workspace-1",
          },
        ]);
      }
      if (call === 2) {
        return makeSelectMock([{ id: "member-1" }]);
      }
      return makeSelectMock([
        { id: "col-done", slug: "done", isFinal: true },
        { id: "col-archived", slug: "archived", isFinal: true },
      ]);
    });
    mockUpdate.mockReturnValue(makeUpdateMock());

    await bulkUpdateTasks({
      taskIds: ["task-1"],
      operation: "updateStatus",
      value: "archived",
      userId: "user-1",
    });

    expect(mockCloseOpenEntriesForTask).not.toHaveBeenCalled();
  });
});
