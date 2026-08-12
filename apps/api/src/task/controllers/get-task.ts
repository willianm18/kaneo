import { eq, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskTable, timeEntryTable, userTable } from "../../database/schema";

// Correlated subquery rather than a join: a join on time_entry would
// multiply task rows (one per entry) and require an extra GROUP BY that
// reshapes this query's selection. The subquery keeps the row count at
// exactly one per task and returns 0 (via COALESCE) for tasks with no
// entries, so it can't be silently dropped by an inner join.
const trackedSecondsExpr = sql<number>`(
  SELECT COALESCE(SUM(${timeEntryTable.duration}), 0)
  FROM ${timeEntryTable}
  WHERE ${timeEntryTable.taskId} = ${taskTable.id}
)`;

async function getTask(taskId: string) {
  const task = await db
    .select({
      id: taskTable.id,
      title: taskTable.title,
      number: taskTable.number,
      description: taskTable.description,
      status: taskTable.status,
      priority: taskTable.priority,
      startDate: taskTable.startDate,
      dueDate: taskTable.dueDate,
      completedAt: taskTable.completedAt,
      estimatedSeconds: taskTable.estimatedSeconds,
      trackedSeconds: trackedSecondsExpr,
      position: taskTable.position,
      createdAt: taskTable.createdAt,
      userId: taskTable.userId,
      assigneeName: userTable.name,
      assigneeId: userTable.id,
      projectId: taskTable.projectId,
    })
    .from(taskTable)
    .leftJoin(userTable, eq(taskTable.userId, userTable.id))
    .where(eq(taskTable.id, taskId))
    .limit(1);

  if (!task.length || !task[0]) {
    throw new HTTPException(404, {
      message: "Task not found",
    });
  }

  return task[0];
}

export default getTask;
