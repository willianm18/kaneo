import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { timeEntryTable } from "../../database/schema";

async function pauseTimer({
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
    throw new HTTPException(409, {
      message: "Cannot pause a time entry that is already finished",
    });
  }

  if (!entry.runningSince) {
    return entry;
  }

  const elapsed = Math.floor(
    (Date.now() - entry.runningSince.getTime()) / 1000,
  );

  const [paused] = await db
    .update(timeEntryTable)
    .set({
      duration: (entry.duration ?? 0) + elapsed,
      runningSince: null,
    })
    .where(eq(timeEntryTable.id, timeEntryId))
    .returning();

  if (!paused) {
    throw new HTTPException(500, { message: "Failed to pause timer" });
  }

  return paused;
}

export default pauseTimer;
