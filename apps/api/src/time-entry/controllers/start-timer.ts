import { createId } from "@paralleldrive/cuid2";
import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskTable, timeEntryTable } from "../../database/schema";
import { publishEvent } from "../../events";

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

  const [openEntry] = await db
    .select()
    .from(timeEntryTable)
    .where(
      and(
        eq(timeEntryTable.taskId, taskId),
        eq(timeEntryTable.userId, userId),
        isNull(timeEntryTable.endTime),
      ),
    )
    .limit(1);

  if (openEntry?.runningSince) {
    return openEntry;
  }

  if (openEntry) {
    const [resumed] = await db
      .update(timeEntryTable)
      .set({ runningSince: now })
      .where(eq(timeEntryTable.id, openEntry.id))
      .returning();

    if (!resumed) {
      throw new HTTPException(500, { message: "Failed to resume timer" });
    }

    return resumed;
  }

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

export default startTimer;
