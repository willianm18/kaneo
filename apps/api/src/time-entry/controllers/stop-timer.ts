import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { timeEntryTable } from "../../database/schema";
import { accumulateDuration } from "../accumulate-duration";
import getOwnedTimeEntry from "./get-owned-time-entry";

async function stopTimer({
  timeEntryId,
  userId,
}: {
  timeEntryId: string;
  userId: string;
}) {
  const entry = await getOwnedTimeEntry({ timeEntryId, userId });

  if (entry.endTime) {
    return entry;
  }

  const now = new Date();

  const [stopped] = await db
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
    .where(eq(timeEntryTable.id, timeEntryId))
    .returning();

  if (!stopped) {
    throw new HTTPException(500, { message: "Failed to stop timer" });
  }

  return stopped;
}

export default stopTimer;
