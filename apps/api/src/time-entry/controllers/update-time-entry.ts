import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { timeEntryTable } from "../../database/schema";

type UpdateTimeEntryParams = {
  timeEntryId: string;
  startTime?: Date;
  endTime?: Date;
  description?: string;
  duration?: number;
};

async function updateTimeEntry(params: UpdateTimeEntryParams) {
  const { timeEntryId, startTime, endTime, description, duration } = params;

  const [existingTimeEntry] = await db
    .select()
    .from(timeEntryTable)
    .where(eq(timeEntryTable.id, timeEntryId));

  if (!existingTimeEntry) {
    throw new HTTPException(404, {
      message: "Time entry not found",
    });
  }

  if (duration !== undefined && duration < 0) {
    throw new HTTPException(400, {
      message:
        "Duration cannot be negative. Please provide a value of 0 or more.",
    });
  }

  const effectiveStartTime = startTime ?? existingTimeEntry.startTime;
  const effectiveEndTime = endTime ?? existingTimeEntry.endTime;

  if (
    effectiveEndTime &&
    effectiveStartTime.getTime() > effectiveEndTime.getTime()
  ) {
    throw new HTTPException(400, {
      message:
        "Start time cannot be after end time. Please adjust the time range.",
    });
  }

  let nextDuration: number | null;

  if (duration !== undefined) {
    // The caller is correcting the accumulated total directly — it becomes
    // the new authoritative value, no heuristics involved.
    nextDuration = duration;
  } else {
    // O timer mantem `duration` como acumulado autoritativo em segundos, entao so
    // recalculamos a partir do intervalo quando a entrada nunca foi cronometrada.
    // LIMITACAO CONHECIDA: a heuristica nao distingue "nunca cronometrada" de "ja
    // editada manualmente uma vez" — a 1a edicao de uma entrada manual persiste
    // duration > 0, entao a 2a edicao mantem esse valor obsoleto em vez de
    // recalcular. O fix correto seria uma flag persistida `is_timed`, adiado por
    // nao existir UI de criacao manual de entradas ainda.
    const wasTimed =
      existingTimeEntry.runningSince !== null ||
      (existingTimeEntry.duration ?? 0) > 0;

    nextDuration = existingTimeEntry.duration ?? null;
    if (!wasTimed && effectiveEndTime) {
      nextDuration = Math.floor(
        (effectiveEndTime.getTime() - effectiveStartTime.getTime()) / 1000,
      );
    }
  }

  const isRunning = existingTimeEntry.runningSince !== null;

  const [updatedTimeEntry] = await db
    .update(timeEntryTable)
    .set({
      startTime: effectiveStartTime,
      endTime: effectiveEndTime,
      duration: nextDuration,
      ...(description !== undefined && { description }),
      // Editing the total while the timer is running rebases the in-flight
      // stretch onto the edit: without this, the pre-edit elapsed time would
      // still get added on top of the new value and the correction would
      // appear to be ignored.
      ...(duration !== undefined && isRunning && { runningSince: new Date() }),
    })
    .where(eq(timeEntryTable.id, timeEntryId))
    .returning();

  return updatedTimeEntry;
}

export default updateTimeEntry;
