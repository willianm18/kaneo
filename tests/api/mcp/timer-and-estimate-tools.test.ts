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

const NEW_TOOL_NAMES = [
  "set_task_estimate",
  "set_task_completion_date",
  "start_task_timer",
  "pause_task_timer",
  "stop_task_timer",
  "list_active_timers",
];

let apiFetch: ReturnType<typeof vi.fn>;

function existingTaskResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: "task-1",
    title: "Existing title",
    description: "Existing description",
    status: "to-do",
    priority: "medium",
    projectId: "proj-1",
    position: 3,
    startDate: null,
    dueDate: null,
    userId: null,
    completedAt: null,
    estimatedSeconds: null,
    ...overrides,
  };
}

beforeEach(() => {
  apiFetch = vi.fn(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", apiFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("timer and estimate tools are registered", () => {
  it("registers all the new tools by name", () => {
    const tools = collectTools();

    for (const name of NEW_TOOL_NAMES) {
      expect(tools.has(name)).toBe(true);
    }
  });

  it("gives every new tool a non-empty description", () => {
    const configs = collectToolConfigs();

    for (const name of NEW_TOOL_NAMES) {
      expect(configs.get(name)?.description?.length ?? 0).toBeGreaterThan(0);
    }
  });
});

describe("set_task_estimate", () => {
  it("converts minutes to seconds in the PUT body", async () => {
    apiFetch
      .mockResolvedValueOnce(Response.json(existingTaskResponse()))
      .mockResolvedValueOnce(Response.json({ ok: true }));

    await call("set_task_estimate", { taskId: "task-1", estimateMinutes: 90 });

    const putCall = apiFetch.mock.calls[1];
    expect(putCall[0]).toBe("http://api.test/api/task/task-1");
    const body = JSON.parse(putCall[1].body);
    expect(body.estimatedSeconds).toBe(90 * 60);
  });

  it("rejects a non-integer estimateMinutes instead of silently truncating it", async () => {
    const result = await call("set_task_estimate", {
      taskId: "task-1",
      estimateMinutes: 1.5,
    });

    expect(result.isError).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("rejects a negative estimateMinutes", async () => {
    const result = await call("set_task_estimate", {
      taskId: "task-1",
      estimateMinutes: -5,
    });

    expect(result.isError).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("clears the estimate (sends null) when estimateMinutes is omitted", async () => {
    apiFetch
      .mockResolvedValueOnce(
        Response.json(existingTaskResponse({ estimatedSeconds: 3600 })),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));

    await call("set_task_estimate", { taskId: "task-1" });

    const body = JSON.parse(apiFetch.mock.calls[1][1].body);
    expect(body.estimatedSeconds).toBeNull();
  });

  it("preserves the rest of the existing task's fields in the full-update body", async () => {
    apiFetch
      .mockResolvedValueOnce(
        Response.json(
          existingTaskResponse({
            title: "Keep me",
            status: "in-progress",
            priority: "high",
          }),
        ),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));

    await call("set_task_estimate", { taskId: "task-1", estimateMinutes: 5 });

    const body = JSON.parse(apiFetch.mock.calls[1][1].body);
    expect(body.title).toBe("Keep me");
    expect(body.status).toBe("in-progress");
    expect(body.priority).toBe("high");
    expect(body.projectId).toBe("proj-1");
    expect(body.position).toBe(3);
  });

  it("mentions minutes in its description so the model does not do the conversion itself", () => {
    const configs = collectToolConfigs();
    const description = configs.get("set_task_estimate")?.description ?? "";

    expect(description.toLowerCase()).toContain("minutes");
    expect(description.toLowerCase()).toContain("seconds");
  });
});

describe("set_task_completion_date", () => {
  it("sends the given ISO date as completedAt", async () => {
    apiFetch
      .mockResolvedValueOnce(Response.json(existingTaskResponse()))
      .mockResolvedValueOnce(Response.json({ ok: true }));

    await call("set_task_completion_date", {
      taskId: "task-1",
      completedAt: "2026-01-05T12:00:00.000Z",
    });

    const body = JSON.parse(apiFetch.mock.calls[1][1].body);
    expect(body.completedAt).toBe("2026-01-05T12:00:00.000Z");
  });

  it("clears completedAt (sends null) when omitted", async () => {
    apiFetch
      .mockResolvedValueOnce(
        Response.json(
          existingTaskResponse({ completedAt: "2026-01-01T00:00:00.000Z" }),
        ),
      )
      .mockResolvedValueOnce(Response.json({ ok: true }));

    await call("set_task_completion_date", { taskId: "task-1" });

    const body = JSON.parse(apiFetch.mock.calls[1][1].body);
    expect(body.completedAt).toBeNull();
  });

  it("mentions that a final column fills this automatically and future dates are rejected", () => {
    const configs = collectToolConfigs();
    const description =
      configs.get("set_task_completion_date")?.description ?? "";

    expect(description.toLowerCase()).toContain("automatically");
    expect(description.toLowerCase()).toContain("future");
  });
});

describe("timer transition tools", () => {
  it("start_task_timer posts to /api/time-entry/task/:taskId/start", async () => {
    await call("start_task_timer", { taskId: "task-1" });

    expect(apiFetch).toHaveBeenCalledTimes(1);
    const [url, init] = apiFetch.mock.calls[0];
    expect(url).toBe("http://api.test/api/time-entry/task/task-1/start");
    expect(init.method).toBe("POST");
  });

  it("start_task_timer forwards an optional description", async () => {
    await call("start_task_timer", {
      taskId: "task-1",
      description: "working on it",
    });

    const body = JSON.parse(apiFetch.mock.calls[0][1].body);
    expect(body.description).toBe("working on it");
  });

  it("pause_task_timer posts to /api/time-entry/:id/pause using the entry id", async () => {
    await call("pause_task_timer", { id: "entry-1" });

    const [url, init] = apiFetch.mock.calls[0];
    expect(url).toBe("http://api.test/api/time-entry/entry-1/pause");
    expect(init.method).toBe("POST");
  });

  it("stop_task_timer posts to /api/time-entry/:id/stop using the entry id", async () => {
    await call("stop_task_timer", { id: "entry-1" });

    const [url, init] = apiFetch.mock.calls[0];
    expect(url).toBe("http://api.test/api/time-entry/entry-1/stop");
    expect(init.method).toBe("POST");
  });

  it("list_active_timers gets /api/time-entry/active", async () => {
    await call("list_active_timers", {});

    const [url] = apiFetch.mock.calls[0];
    expect(url).toBe("http://api.test/api/time-entry/active");
  });
});
