import { and, eq, isNull } from "drizzle-orm";
import db from "../../database";
import { timeEntryTable } from "../../database/schema";
import { accumulateDuration } from "../accumulate-duration";

/**
 * Closes every still-open time entry (running or merely paused — anything
 * without an `endTime`) for a task, exactly as `stopTimer` closes a single
 * entry: any in-flight stretch is folded into `duration`, `endTime` is
 * stamped with the server clock, and `runningSince` is cleared. Nothing is
 * deleted and no accumulated second is lost — entries simply stop being
 * open.
 *
 * Called when a task transitions INTO a final (done-equivalent) column, so
 * the global timer bar doesn't keep showing a timer for a finished task.
 * Never call this when leaving a final column — a new session is always
 * started manually, entries are never reopened.
 */
async function closeOpenEntriesForTask(taskId: string, now: Date = new Date()) {
  const openEntries = await db
    .select({
      id: timeEntryTable.id,
      duration: timeEntryTable.duration,
      runningSince: timeEntryTable.runningSince,
    })
    .from(timeEntryTable)
    .where(
      and(eq(timeEntryTable.taskId, taskId), isNull(timeEntryTable.endTime)),
    );

  for (const entry of openEntries) {
    await db
      .update(timeEntryTable)
      .set({
        duration: accumulateDuration({
          duration: entry.duration,
          runningSince: entry.runningSince,
          now,
        }),
        runningSince: null,
        endTime: now,
      })
      .where(eq(timeEntryTable.id, entry.id));
  }

  return openEntries.length;
}

export default closeOpenEntriesForTask;
