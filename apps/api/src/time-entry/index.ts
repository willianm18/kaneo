import { Hono } from "hono";
import { describeRoute, resolver, validator } from "hono-openapi";
import * as v from "valibot";
import { activeTimersResponseSchema, timeEntrySchema } from "../schemas";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import createTimeEntry from "./controllers/create-time-entry";
import getActiveTimers from "./controllers/get-active-timers";
import getTimeEntriesByTaskId from "./controllers/get-time-entries";
import getTimeEntry from "./controllers/get-time-entry";
import pauseTimer from "./controllers/pause-timer";
import startTimer from "./controllers/start-timer";
import stopTimer from "./controllers/stop-timer";
import updateTimeEntry from "./controllers/update-time-entry";

const timeEntry = new Hono<{
  Variables: {
    userId: string;
  };
}>()
  .get(
    "/active",
    describeRoute({
      operationId: "getActiveTimers",
      tags: ["Time Entries"],
      description: "List the current user's open time entries",
      responses: {
        200: {
          description: "Open time entries plus the server clock",
          content: {
            "application/json": {
              schema: resolver(activeTimersResponseSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const userId = c.get("userId");
      const entries = await getActiveTimers(userId);
      return c.json({ entries, serverTime: new Date().toISOString() });
    },
  )
  .get(
    "/task/:taskId",
    describeRoute({
      operationId: "getTaskTimeEntries",
      tags: ["Time Entries"],
      description: "Get all time entries for a specific task",
      responses: {
        200: {
          description: "List of time entries for the task",
          content: {
            "application/json": { schema: resolver(v.array(timeEntrySchema)) },
          },
        },
      },
    }),
    validator("param", v.object({ taskId: v.string() })),
    workspaceAccess.fromTaskId(),
    async (c) => {
      const { taskId } = c.req.valid("param");
      const timeEntries = await getTimeEntriesByTaskId(taskId);
      return c.json(timeEntries);
    },
  )
  .get(
    "/:id",
    describeRoute({
      operationId: "getTimeEntry",
      tags: ["Time Entries"],
      description: "Get a specific time entry by ID",
      responses: {
        200: {
          description: "Time entry details",
          content: {
            "application/json": { schema: resolver(timeEntrySchema) },
          },
        },
      },
    }),
    validator("param", v.object({ id: v.string() })),
    workspaceAccess.fromTimeEntry(),
    async (c) => {
      const { id } = c.req.valid("param");
      const timeEntry = await getTimeEntry(id);
      return c.json(timeEntry);
    },
  )
  .post(
    "/",
    describeRoute({
      operationId: "createTimeEntry",
      tags: ["Time Entries"],
      description: "Create a new time entry for a task",
      responses: {
        200: {
          description: "Time entry created successfully",
          content: {
            "application/json": { schema: resolver(timeEntrySchema) },
          },
        },
      },
    }),
    validator(
      "json",
      v.object({
        taskId: v.string(),
        startTime: v.string(),
        endTime: v.optional(v.string()),
        description: v.optional(v.string()),
      }),
    ),
    workspaceAccess.fromTaskId(),
    requireWorkspacePermission({ task: ["update"] }),
    async (c) => {
      const { taskId, startTime, endTime, description } = c.req.valid("json");
      const userId = c.get("userId");
      const timeEntry = await createTimeEntry({
        taskId,
        userId,
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : undefined,
        description,
      });
      return c.json(timeEntry);
    },
  )
  .put(
    "/:id",
    describeRoute({
      operationId: "updateTimeEntry",
      tags: ["Time Entries"],
      description: "Update an existing time entry",
      responses: {
        200: {
          description: "Time entry updated successfully",
          content: {
            "application/json": { schema: resolver(timeEntrySchema) },
          },
        },
      },
    }),
    validator("param", v.object({ id: v.string() })),
    validator(
      "json",
      v.object({
        startTime: v.optional(v.string()),
        endTime: v.optional(v.string()),
        description: v.optional(v.string()),
        duration: v.optional(v.number()),
      }),
    ),
    workspaceAccess.fromTimeEntry(),
    requireWorkspacePermission({ task: ["update"] }),
    async (c) => {
      const { id } = c.req.valid("param");
      const { startTime, endTime, description, duration } = c.req.valid("json");
      const timeEntry = await updateTimeEntry({
        timeEntryId: id,
        startTime: startTime ? new Date(startTime) : undefined,
        endTime: endTime ? new Date(endTime) : undefined,
        description,
        duration,
      });
      return c.json(timeEntry);
    },
  )
  .post(
    "/task/:taskId/start",
    describeRoute({
      operationId: "startTimer",
      tags: ["Time Entries"],
      description: "Start or resume the timer for a task",
      responses: {
        200: {
          description: "Timer started",
          content: {
            "application/json": { schema: resolver(timeEntrySchema) },
          },
        },
      },
    }),
    validator("param", v.object({ taskId: v.string() })),
    validator("json", v.object({ description: v.optional(v.string()) })),
    workspaceAccess.fromTaskId(),
    requireWorkspacePermission({ task: ["update"] }),
    async (c) => {
      const { taskId } = c.req.valid("param");
      const { description } = c.req.valid("json");
      const userId = c.get("userId");
      const timeEntry = await startTimer({ taskId, userId, description });
      return c.json(timeEntry);
    },
  )
  .post(
    "/:id/pause",
    describeRoute({
      operationId: "pauseTimer",
      tags: ["Time Entries"],
      description: "Pause a running timer",
      responses: {
        200: {
          description: "Timer paused",
          content: {
            "application/json": { schema: resolver(timeEntrySchema) },
          },
        },
      },
    }),
    validator("param", v.object({ id: v.string() })),
    workspaceAccess.fromTimeEntry(),
    requireWorkspacePermission({ task: ["update"] }),
    async (c) => {
      const { id } = c.req.valid("param");
      const userId = c.get("userId");
      const timeEntry = await pauseTimer({ timeEntryId: id, userId });
      return c.json(timeEntry);
    },
  )
  .post(
    "/:id/stop",
    describeRoute({
      operationId: "stopTimer",
      tags: ["Time Entries"],
      description: "Stop a timer and close the entry",
      responses: {
        200: {
          description: "Timer stopped",
          content: {
            "application/json": { schema: resolver(timeEntrySchema) },
          },
        },
      },
    }),
    validator("param", v.object({ id: v.string() })),
    workspaceAccess.fromTimeEntry(),
    requireWorkspacePermission({ task: ["update"] }),
    async (c) => {
      const { id } = c.req.valid("param");
      const userId = c.get("userId");
      const timeEntry = await stopTimer({ timeEntryId: id, userId });
      return c.json(timeEntry);
    },
  );

export default timeEntry;
