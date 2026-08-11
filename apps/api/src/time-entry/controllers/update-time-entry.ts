import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { timeEntryTable } from "../../database/schema";

type UpdateTimeEntryParams = {
  timeEntryId: string;
  startTime: Date;
  endTime?: Date;
  description?: string;
};

async function updateTimeEntry(params: UpdateTimeEntryParams) {
  const { timeEntryId, startTime, endTime, description } = params;

  const [existingTimeEntry] = await db
    .select()
    .from(timeEntryTable)
    .where(eq(timeEntryTable.id, timeEntryId));

  if (!existingTimeEntry) {
    throw new HTTPException(404, {
      message: "Time entry not found",
    });
  }

  const effectiveEndTime = endTime ?? existingTimeEntry.endTime;

  if (effectiveEndTime && startTime.getTime() > effectiveEndTime.getTime()) {
    throw new HTTPException(400, {
      message:
        "Start time cannot be after end time. Please adjust the time range.",
    });
  }

  // O timer mantem `duration` como acumulado autoritativo em segundos, entao so
  // recalculamos a partir do intervalo quando a entrada nunca foi cronometrada.
  const wasTimed =
    existingTimeEntry.runningSince !== null ||
    (existingTimeEntry.duration ?? 0) > 0;

  let duration: number | null = existingTimeEntry.duration ?? null;
  if (!wasTimed && effectiveEndTime) {
    duration = Math.floor(
      (effectiveEndTime.getTime() - startTime.getTime()) / 1000,
    );
  }

  const [updatedTimeEntry] = await db
    .update(timeEntryTable)
    .set({
      startTime,
      endTime: effectiveEndTime,
      duration,
      ...(description !== undefined && { description }),
    })
    .where(eq(timeEntryTable.id, timeEntryId))
    .returning();

  return updatedTimeEntry;
}

export default updateTimeEntry;
