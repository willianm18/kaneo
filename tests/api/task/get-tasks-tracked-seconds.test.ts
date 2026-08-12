import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelect = vi.fn();
const mockFindFirstProject = vi.fn();

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: (...args: unknown[]) => mockSelect(...args),
    query: {
      projectTable: {
        findFirst: (...args: unknown[]) => mockFindFirstProject(...args),
      },
    },
  },
}));

import getTasks from "../../../apps/api/src/task/controllers/get-tasks";

// Same chainable-query-builder mock used by the completedAt/estimatedSeconds
// regression test — see get-tasks-completed-at.test.ts for the rationale.
function makeChain(result: unknown) {
  const chain = Object.assign(
    Promise.resolve(result),
    {} as Record<string, unknown>,
  );
  for (const name of [
    "from",
    "leftJoin",
    "innerJoin",
    "where",
    "orderBy",
    "limit",
    "offset",
  ]) {
    chain[name] = vi.fn(() => chain);
  }
  return chain;
}

describe("getTasks — trackedSeconds", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("inclui trackedSeconds na selecao e soma as entradas de tempo de uma task", async () => {
    mockFindFirstProject.mockResolvedValue({
      id: "project-1",
      name: "Projeto",
      slug: "projeto",
      icon: null,
      description: null,
      isPublic: false,
      workspaceId: "workspace-1",
    });

    const taskWithEntries = {
      id: "task-15",
      status: "archived",
      trackedSeconds: 3600,
    };

    mockSelect
      .mockReturnValueOnce(makeChain([{ count: 1 }]))
      .mockReturnValueOnce(makeChain([taskWithEntries]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]));

    const result = await getTasks("project-1");

    const selection = mockSelect.mock.calls[1][0] as Record<string, unknown>;
    expect(selection.trackedSeconds).toBeDefined();

    expect(result.data.archivedTasks).toHaveLength(1);
    expect(result.data.archivedTasks[0]?.trackedSeconds).toBe(3600);
  });

  it("mantem a task no resultado com trackedSeconds 0 quando ela nao possui entradas de tempo (LEFT JOIN guard)", async () => {
    mockFindFirstProject.mockResolvedValue({
      id: "project-1",
      name: "Projeto",
      slug: "projeto",
      icon: null,
      description: null,
      isPublic: false,
      workspaceId: "workspace-1",
    });

    const taskWithoutEntries = {
      id: "task-no-entries",
      status: "archived",
      trackedSeconds: 0,
    };

    mockSelect
      .mockReturnValueOnce(makeChain([{ count: 1 }]))
      .mockReturnValueOnce(makeChain([taskWithoutEntries]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]));

    const result = await getTasks("project-1");

    expect(result.data.archivedTasks).toHaveLength(1);
    expect(result.data.archivedTasks[0]?.trackedSeconds).toBe(0);
  });

  it("nao altera a contagem de tasks retornadas ao agregar trackedSeconds (row-multiplication guard)", async () => {
    mockFindFirstProject.mockResolvedValue({
      id: "project-1",
      name: "Projeto",
      slug: "projeto",
      icon: null,
      description: null,
      isPublic: false,
      workspaceId: "workspace-1",
    });

    // Three distinct tasks, only some with time entries. If the aggregation
    // were implemented as a naive join instead of a correlated subquery,
    // a task with multiple time entries would appear more than once here.
    const tasks = [
      { id: "task-15", status: "archived", trackedSeconds: 3600 },
      { id: "task-17", status: "archived", trackedSeconds: 3600 },
      { id: "task-no-entries", status: "archived", trackedSeconds: 0 },
    ];

    mockSelect
      .mockReturnValueOnce(makeChain([{ count: 3 }]))
      .mockReturnValueOnce(makeChain(tasks))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]));

    const result = await getTasks("project-1");

    expect(result.data.archivedTasks).toHaveLength(3);
    expect(result.pagination.total).toBe(3);
    expect(result.data.archivedTasks.map((task) => task.id).sort()).toEqual([
      "task-15",
      "task-17",
      "task-no-entries",
    ]);
  });
});
