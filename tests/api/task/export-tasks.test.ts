import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const mockSelect = vi.fn();
const mockFindFirst = vi.fn();

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: (...args: unknown[]) => mockSelect(...args),
    query: {
      projectTable: {
        findFirst: (...args: unknown[]) => mockFindFirst(...args),
      },
    },
  },
}));

import { taskTable } from "../../../apps/api/src/database/schema";
import exportTasks from "../../../apps/api/src/task/controllers/export-tasks";

function makeTasksSelectMock(rows: unknown[]) {
  const chain: Record<string, Mock> = {
    from: vi.fn(() => chain),
    leftJoin: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => Promise.resolve(rows)),
  };
  return chain;
}

function makeLabelsSelectMock(rows: unknown[]) {
  const chain: Record<string, Mock> = {
    from: vi.fn(() => chain),
    where: vi.fn(() => Promise.resolve(rows)),
  };
  return chain;
}

describe("exportTasks — completedAt/estimatedSeconds", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockFindFirst.mockResolvedValue({
      name: "Projeto",
      slug: "projeto",
      description: "",
    });
  });

  it("inclui completedAt e estimatedSeconds na selecao de colunas", async () => {
    mockSelect
      .mockReturnValueOnce(makeTasksSelectMock([]))
      .mockReturnValueOnce(makeLabelsSelectMock([]));

    await exportTasks("project-1");

    const selection = mockSelect.mock.calls[0][0] as Record<string, unknown>;
    expect(selection.completedAt).toBe(taskTable.completedAt);
    expect(selection.estimatedSeconds).toBe(taskTable.estimatedSeconds);
  });

  it("exporta completedAt (ISO) e estimatedSeconds (segundos) por tarefa", async () => {
    const completedAt = new Date("2026-08-08T12:00:00.000Z");
    mockSelect
      .mockReturnValueOnce(
        makeTasksSelectMock([
          {
            id: "task-1",
            title: "Tarefa",
            completedAt,
            estimatedSeconds: 3600,
          },
        ]),
      )
      .mockReturnValueOnce(makeLabelsSelectMock([]));

    const result = await exportTasks("project-1");

    expect(result.tasks[0].completedAt).toBe("2026-08-08T12:00:00.000Z");
    expect(result.tasks[0].estimatedSeconds).toBe(3600);
  });

  it("exporta null quando os campos estao vazios", async () => {
    mockSelect
      .mockReturnValueOnce(
        makeTasksSelectMock([
          {
            id: "task-1",
            title: "Tarefa",
            completedAt: null,
            estimatedSeconds: null,
          },
        ]),
      )
      .mockReturnValueOnce(makeLabelsSelectMock([]));

    const result = await exportTasks("project-1");

    expect(result.tasks[0].completedAt).toBeNull();
    expect(result.tasks[0].estimatedSeconds).toBeNull();
  });
});
