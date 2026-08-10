import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { timeEntryTable } from "../../database/schema";

async function stopTimer({
  timeEntryId,
  userId,
}: {
  timeEntryId: string;
  userId: string;
}) {
  const [entry] = await db
    .select()
    .from(timeEntryTable)
    .where(
      and(
        eq(timeEntryTable.id, timeEntryId),
        eq(timeEntryTable.userId, userId),
      ),
    )
    .limit(1);

  if (!entry) {
    throw new HTTPException(404, { message: "Time entry not found" });
  }

  if (entry.endTime) {
    return entry;
  }

  const now = new Date();
  const elapsed = entry.runningSince
    ? Math.floor((now.getTime() - entry.runningSince.getTime()) / 1000)
    : 0;

  const [stopped] = await db
    .update(timeEntryTable)
    .set({
      duration: (entry.duration ?? 0) + elapsed,
      runningSince: null,
      endTime: now,
    })
    .where(eq(timeEntryTable.id, timeEntryId))
    .returning();

  if (!stopped) {
    throw new HTTPException(500, { message: "Failed to stop timer" });
  }

  return stopped;
}

export default stopTimer;
