import { and, eq, isNull } from "drizzle-orm";
import db from "../../database";
import { projectTable, taskTable, timeEntryTable } from "../../database/schema";

async function getActiveTimers(userId: string) {
  const rows = await db
    .select({
      id: timeEntryTable.id,
      taskId: timeEntryTable.taskId,
      taskTitle: taskTable.title,
      projectId: taskTable.projectId,
      workspaceId: projectTable.workspaceId,
      duration: timeEntryTable.duration,
      runningSince: timeEntryTable.runningSince,
    })
    .from(timeEntryTable)
    .innerJoin(taskTable, eq(timeEntryTable.taskId, taskTable.id))
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(eq(timeEntryTable.userId, userId), isNull(timeEntryTable.endTime)),
    );

  return rows.map((row) => ({
    ...row,
    isRunning: row.runningSince !== null,
  }));
}

export default getActiveTimers;
