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

import { taskTable } from "../../../apps/api/src/database/schema";
import getTasks from "../../../apps/api/src/task/controllers/get-tasks";

// A chainable query-builder mock built on a real Promise: every chain method
// returns the same object, and it can also be awaited directly at any point
// — matching how get-tasks.ts sometimes chains further (.limit().offset())
// and sometimes awaits the builder as-is. Using a real Promise (rather than a
// plain object with a manual `.then`) keeps this a genuine thenable instead
// of the fake-thenable pattern biome's noThenProperty rule warns about.
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

describe("getTasks — completedAt/estimatedSeconds", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("inclui completedAt e estimatedSeconds na selecao e no retorno das tasks", async () => {
    mockFindFirstProject.mockResolvedValue({
      id: "project-1",
      name: "Projeto",
      slug: "projeto",
      icon: null,
      description: null,
      isPublic: false,
      workspaceId: "workspace-1",
    });

    const completedAt = new Date("2026-08-08T12:00:00.000Z");
    // status "archived" so the task lands in a fixed output bucket regardless
    // of the (empty, in this test) project column configuration.
    const taskRow = {
      id: "task-1",
      status: "archived",
      completedAt,
      estimatedSeconds: 1800,
    };

    // Calls happen in this order: count, main task query, labels,
    // externalLinks, project columns.
    mockSelect
      .mockReturnValueOnce(makeChain([{ count: 1 }]))
      .mockReturnValueOnce(makeChain([taskRow]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]))
      .mockReturnValueOnce(makeChain([]));

    const result = await getTasks("project-1");

    // Regression guard for Finding 1: get-tasks.ts built an explicit column
    // selection that silently omitted these two columns.
    const selection = mockSelect.mock.calls[1][0] as Record<string, unknown>;
    expect(selection.completedAt).toBe(taskTable.completedAt);
    expect(selection.estimatedSeconds).toBe(taskTable.estimatedSeconds);

    expect(result.data.archivedTasks).toHaveLength(1);
    expect(result.data.archivedTasks[0]?.completedAt).toBe(completedAt);
    expect(result.data.archivedTasks[0]?.estimatedSeconds).toBe(1800);
  });
});
