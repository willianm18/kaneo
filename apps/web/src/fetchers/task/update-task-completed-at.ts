import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";
import type Task from "@/types/task";

type UpdateTaskPriority = InferRequestType<
  (typeof client)["task"][":id"]["$put"]
>["json"]["priority"];

/**
 * Dedicated single-field update for completedAt.
 *
 * This intentionally does NOT reuse the generic `updateTask` fetcher: that
 * fetcher is shared by status-changing flows (kanban/list-view drag,
 * backlog, archive) which must NOT send `completedAt` explicitly, since the
 * API only auto-fills/clears completedAt on a status transition when the
 * field is omitted from the payload — an explicit value (even the current
 * `null`) always wins and would silently defeat that auto-behavior.
 * This popover, by contrast, always wants its explicit value to win.
 */
async function updateTaskCompletedAt(taskId: string, task: Task) {
  const response = await client.task[":id"].$put({
    param: { id: taskId },
    json: {
      userId: task.userId || "",
      title: task.title,
      description: task.description || "",
      status: task.status,
      priority: (task.priority || "") as UpdateTaskPriority,
      startDate: task.startDate?.toString(),
      dueDate: task.dueDate?.toString(),
      position: task.position ?? 0,
      projectId: task.projectId,
      completedAt: task.completedAt,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  const data = await response.json();

  return data;
}

export default updateTaskCompletedAt;
