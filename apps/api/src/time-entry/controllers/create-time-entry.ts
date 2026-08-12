import { createId } from "@paralleldrive/cuid2";
import { and, desc, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskTable, timeEntryTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { consolidateTimeEntries } from "../consolidate-entries";

/**
 * Derives the seconds to store for a newly logged entry. An explicitly
 * passed `duration` is always authoritative — the timer paths (start/pause/
 * stop) and the MCP `durationMinutes` shortcut both rely on that. Otherwise,
 * a closed interval (`endTime` present) derives its duration from the
 * timestamps; an entry with no `endTime` is an open timer and must not have
 * a duration fabricated for it.
 */
function deriveDuration({
  duration,
  startTime,
  endTime,
}: {
  duration?: number;
  startTime: Date;
  endTime?: Date;
}): number {
  if (duration !== undefined) {
    return duration;
  }
  if (!endTime) {
    return 0;
  }
  return Math.max(
    0,
    Math.floor((endTime.getTime() - startTime.getTime()) / 1000),
  );
}

async function createTimeEntry({
  taskId,
  userId,
  description,
  startTime,
  endTime,
  duration,
}: {
  taskId: string;
  userId: string;
  description?: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
}) {
  if (duration !== undefined && duration < 0) {
    throw new HTTPException(400, {
      message:
        "Duration cannot be negative. Please provide a value of 0 or more.",
    });
  }

  const requestedDuration = deriveDuration({ duration, startTime, endTime });

  // The owner's model is exactly one time entry per (task, user), always
  // accumulating. If one already exists, fold this newly logged duration
  // into it instead of inserting a second row — and, in the same pass,
  // converge any leftover duplicates from before this rule was enforced
  // everywhere onto that single survivor. Never recomputed from timestamps,
  // so no already-stored second is ever lost.
  const existingEntries = await db
    .select()
    .from(timeEntryTable)
    .where(
      and(eq(timeEntryTable.taskId, taskId), eq(timeEntryTable.userId, userId)),
    )
    .orderBy(desc(timeEntryTable.startTime));

  if (existingEntries.length > 0) {
    const { target, duplicates, mergedDuration } =
      consolidateTimeEntries(existingEntries);

    if (!target) {
      throw new HTTPException(500, {
        message: "Failed to accumulate time entry",
      });
    }

    const [accumulated] = await db
      .update(timeEntryTable)
      .set({
        duration: mergedDuration + requestedDuration,
      })
      .where(eq(timeEntryTable.id, target.id))
      .returning();

    if (!accumulated) {
      throw new HTTPException(500, {
        message: "Failed to accumulate time entry",
      });
    }

    if (duplicates.length > 0) {
      await db.delete(timeEntryTable).where(
        inArray(
          timeEntryTable.id,
          duplicates.map((entry) => entry.id),
        ),
      );
    }

    return accumulated;
  }

  const [createdTimeEntry] = await db
    .insert(timeEntryTable)
    .values({
      id: createId(),
      taskId,
      userId,
      description: description || "",
      startTime,
      endTime: endTime || null,
      duration: requestedDuration,
    })
    .returning();

  if (!createdTimeEntry) {
    throw new HTTPException(500, {
      message: "Failed to create time entry",
    });
  }

  const [task] = await db
    .select({ userId: taskTable.userId, title: taskTable.title })
    .from(taskTable)
    .where(eq(taskTable.id, taskId));

  await publishEvent("time-entry.created", {
    timeEntryId: createdTimeEntry.id,
    taskId: createdTimeEntry.taskId,
    userId,
    type: "create",
    content: "started time tracking",
    taskOwnerId: task?.userId,
    taskTitle: task?.title,
  });

  return createdTimeEntry;
}

export default createTimeEntry;
