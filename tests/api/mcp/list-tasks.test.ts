import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type McpToolRegistrar,
  registerMcpTools,
} from "../../../apps/api/src/mcp/tools";

type ToolCallback = (args: unknown) => Promise<{
  content: Array<{ text: string }>;
  isError?: boolean;
}>;

function collectTools() {
  const tools = new Map<string, ToolCallback>();
  const registrar: McpToolRegistrar = {
    registerTool: (name, _config, callback) => tools.set(name, callback),
  };
  registerMcpTools(registrar, "http://api.test", "test-token");
  return tools;
}

function collectToolConfigs() {
  const configs = new Map<string, { description: string }>();
  const registrar: McpToolRegistrar = {
    registerTool: (name, config) => configs.set(name, config),
  };
  registerMcpTools(registrar, "http://api.test", "test-token");
  return configs;
}

async function call(name: string, args: unknown = {}) {
  const tools = collectTools();
  const tool = tools.get(name);
  if (!tool) throw new Error(`Tool ${name} is not registered`);
  const result = await tool(args);
  return { ...result, data: JSON.parse(result.content[0].text) };
}

let apiFetch: ReturnType<typeof vi.fn>;

/**
 * Stubbed reply matching the real GET /api/task/tasks/:projectId response:
 * a project object with tasks nested under columns, plus separate
 * archivedTasks/plannedTasks buckets and a pagination total. This is the
 * exact shape list_tasks must reshape into a flat list.
 */
function boardResponse(overrides: {
  columns?: unknown[];
  archivedTasks?: unknown[];
  plannedTasks?: unknown[];
  total?: number;
}) {
  return {
    data: {
      id: "msrxnqi5zd2or33i4fnyxe92",
      name: "Demo project",
      slug: "demo",
      icon: "Layout",
      description: null,
      isPublic: false,
      workspaceId: "ws1",
      columns: overrides.columns ?? [],
      archivedTasks: overrides.archivedTasks ?? [],
      plannedTasks: overrides.plannedTasks ?? [],
    },
    pagination: {
      total: overrides.total ?? 0,
      page: 1,
      pageSize: overrides.total ?? 0,
      totalPages: 1,
    },
  };
}

function rawTask(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    title: `Task ${id}`,
    number: Number(id.replace(/\D/g, "")) || 1,
    description: "",
    status: extra.status ?? "to-do",
    priority: "medium",
    startDate: null,
    dueDate: null,
    completedAt: null,
    estimatedSeconds: null,
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    userId: null,
    assigneeName: null,
    assigneeId: null,
    assigneeImage: null,
    projectId: "msrxnqi5zd2or33i4fnyxe92",
    labels: [],
    externalLinks: [],
    ...extra,
  };
}

beforeEach(() => {
  apiFetch = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", apiFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("list_tasks reshaping", () => {
  it("flattens tasks nested under columns into a single flat list", async () => {
    const board = boardResponse({
      columns: [
        {
          id: "to-do",
          slug: "to-do",
          name: "To Do",
          icon: "Circle",
          isFinal: false,
          tasks: [rawTask("t1", { status: "to-do" })],
        },
        {
          id: "in-progress",
          slug: "in-progress",
          name: "In Progress",
          icon: "Circle",
          isFinal: false,
          tasks: [rawTask("t2", { status: "in-progress" })],
        },
        {
          id: "done",
          slug: "done",
          name: "Done",
          icon: "Circle",
          isFinal: true,
          tasks: [
            rawTask("t3", { status: "done" }),
            rawTask("t4", { status: "done" }),
            rawTask("t5", { status: "done" }),
          ],
        },
      ],
      total: 5,
    });
    apiFetch.mockResolvedValueOnce(Response.json(board));

    const result = await call("list_tasks", { projectId: board.data.id });

    expect(result.isError).toBeFalsy();
    expect(Array.isArray(result.data.tasks)).toBe(true);
    expect(result.data.tasks).toHaveLength(5);
    expect(result.data.tasks.map((t: { id: string }) => t.id)).toEqual([
      "t1",
      "t2",
      "t3",
      "t4",
      "t5",
    ]);
    // No nesting: no `columns`, `archivedTasks`, or `plannedTasks` survive.
    expect(result.data).not.toHaveProperty("columns");
    expect(result.data.data).toBeUndefined();
  });

  it("sets each flat task's status to the column slug it sits in", async () => {
    const board = boardResponse({
      columns: [
        {
          slug: "in-progress",
          tasks: [rawTask("t1", { status: "some-other-status-on-record" })],
        },
      ],
      total: 1,
    });
    apiFetch.mockResolvedValueOnce(Response.json(board));

    const result = await call("list_tasks", { projectId: board.data.id });

    expect(result.data.tasks[0].status).toBe("in-progress");
  });

  it("computes countsByStatus from the flat list, so it always agrees with it", async () => {
    const board = boardResponse({
      columns: [
        { slug: "to-do", tasks: [rawTask("t1")] },
        { slug: "in-progress", tasks: [rawTask("t2")] },
        {
          slug: "done",
          tasks: [rawTask("t3"), rawTask("t4"), rawTask("t5")],
        },
      ],
      total: 5,
    });
    apiFetch.mockResolvedValueOnce(Response.json(board));

    const result = await call("list_tasks", { projectId: board.data.id });

    expect(result.data.countsByStatus).toEqual({
      "to-do": 1,
      "in-progress": 1,
      done: 3,
    });

    // The counts are derived from `tasks`, not an independent source.
    const recomputed: Record<string, number> = {};
    for (const task of result.data.tasks as Array<{ status: string }>) {
      recomputed[task.status] = (recomputed[task.status] ?? 0) + 1;
    }
    expect(result.data.countsByStatus).toEqual(recomputed);
  });

  it("takes `total` from pagination.total, not from counting the flat list", async () => {
    // Deliberately mismatched: 2 tasks in columns, but pagination.total says 5
    // (e.g. a filtered/paginated request). The tool must pass total through
    // as-is rather than recompute it from the tasks it can see.
    const board = boardResponse({
      columns: [{ slug: "to-do", tasks: [rawTask("t1"), rawTask("t2")] }],
      total: 5,
    });
    apiFetch.mockResolvedValueOnce(Response.json(board));

    const result = await call("list_tasks", { projectId: board.data.id });

    expect(result.data.total).toBe(5);
    expect(result.data.tasks).toHaveLength(2);
  });

  it("includes archived and planned tasks in the flat list, using their own status", async () => {
    const board = boardResponse({
      columns: [{ slug: "to-do", tasks: [rawTask("t1")] }],
      archivedTasks: [rawTask("t2", { status: "archived" })],
      plannedTasks: [rawTask("t3", { status: "planned" })],
      total: 3,
    });
    apiFetch.mockResolvedValueOnce(Response.json(board));

    const result = await call("list_tasks", { projectId: board.data.id });

    expect(result.data.tasks).toHaveLength(3);
    const statuses = result.data.tasks.map((t: { status: string }) => t.status);
    expect(statuses).toEqual(["to-do", "archived", "planned"]);
    expect(result.data.countsByStatus).toEqual({
      "to-do": 1,
      archived: 1,
      planned: 1,
    });
  });

  it("matches the real 1/1/3 project fixture: total 5 and matching counts", async () => {
    const board = boardResponse({
      columns: [
        { slug: "to-do", tasks: [rawTask("t1", { status: "to-do" })] },
        {
          slug: "in-progress",
          tasks: [rawTask("t2", { status: "in-progress" })],
        },
        {
          slug: "done",
          tasks: [
            rawTask("t3", { status: "done" }),
            rawTask("t4", { status: "done" }),
            rawTask("t5", { status: "done" }),
          ],
        },
      ],
      total: 5,
    });
    apiFetch.mockResolvedValueOnce(Response.json(board));

    const result = await call("list_tasks", {
      projectId: "msrxnqi5zd2or33i4fnyxe92",
    });

    expect(result.data.total).toBe(5);
    expect(result.data.countsByStatus).toEqual({
      "to-do": 1,
      "in-progress": 1,
      done: 3,
    });
    expect(result.data.tasks).toHaveLength(5);
  });

  it("keeps only the documented fields on each flat task", async () => {
    const board = boardResponse({
      columns: [
        {
          slug: "to-do",
          tasks: [
            rawTask("t1", {
              number: 5,
              priority: "low",
              assigneeId: null,
              dueDate: null,
            }),
          ],
        },
      ],
      total: 1,
    });
    apiFetch.mockResolvedValueOnce(Response.json(board));

    const result = await call("list_tasks", { projectId: board.data.id });

    expect(Object.keys(result.data.tasks[0]).sort()).toEqual(
      [
        "id",
        "number",
        "title",
        "status",
        "priority",
        "assigneeId",
        "dueDate",
      ].sort(),
    );
  });

  it("describes the flat shape and column-slug status contract", () => {
    const configs = collectToolConfigs();
    const description = configs.get("list_tasks")?.description ?? "";

    expect(description).toContain("flat list");
    expect(description).toContain("countsByStatus");
    expect(description).toContain("column slug");
  });
});
