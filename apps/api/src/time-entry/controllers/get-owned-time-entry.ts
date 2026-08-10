import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { timeEntryTable } from "../../database/schema";

async function getOwnedTimeEntry({
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

  return entry;
}

export default getOwnedTimeEntry;
