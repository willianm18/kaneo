import { createId } from "@paralleldrive/cuid2";
import { and, desc, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskTable, timeEntryTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { consolidateTimeEntries } from "../consolidate-entries";

/**
 * Starts, resumes, or reopens the single time entry that a (task, user) pair
 * may ever hold. The model deliberately has no session log: every play/pause
 * cycle accumulates into one row, and stopping only closes it — it never
 * spawns a second entry for the next play.
 */
async function startTimer({
  taskId,
  userId,
  description,
}: {
  taskId: string;
  userId: string;
  description?: string;
}) {
  const now = new Date();

  const entries = await db
    .select()
    .from(timeEntryTable)
    .where(
      and(eq(timeEntryTable.taskId, taskId), eq(timeEntryTable.userId, userId)),
    )
    .orderBy(desc(timeEntryTable.startTime));

  const { target, duplicates, mergedDuration } =
    consolidateTimeEntries(entries);

  if (!target) {
    const [created] = await db
      .insert(timeEntryTable)
      .values({
        id: createId(),
        taskId,
        userId,
        description: description || "",
        startTime: now,
        endTime: null,
        duration: 0,
        runningSince: now,
      })
      .returning();

    if (!created) {
      throw new HTTPException(500, { message: "Failed to start timer" });
    }

    const [task] = await db
      .select({ userId: taskTable.userId, title: taskTable.title })
      .from(taskTable)
      .where(eq(taskTable.id, taskId));

    await publishEvent("time-entry.created", {
      timeEntryId: created.id,
      taskId: created.taskId,
      userId,
      type: "create",
      content: "started time tracking",
      taskOwnerId: task?.userId,
      taskTitle: task?.title,
    });

    return created;
  }

  if (target.runningSince && duplicates.length === 0) {
    return target;
  }

  // Earlier behavior could leave several closed entries for the same (task,
  // user) — `stop` closed one and the next `start` created another. Converge
  // onto the single-entry model here: fold every duplicate's stored
  // `duration` into the most recent entry (`target`, ordered by
  // `startTime`) and delete the rest. This only sums already-stored totals —
  // it never recomputes from timestamps — so no second is lost.
  const [updated] = await db
    .update(timeEntryTable)
    .set({
      duration: mergedDuration,
      runningSince: target.runningSince ?? now,
      endTime: null,
    })
    .where(eq(timeEntryTable.id, target.id))
    .returning();

  if (!updated) {
    throw new HTTPException(500, { message: "Failed to resume timer" });
  }

  if (duplicates.length > 0) {
    await db.delete(timeEntryTable).where(
      inArray(
        timeEntryTable.id,
        duplicates.map((entry) => entry.id),
      ),
    );
  }

  return updated;
}

export default startTimer;
