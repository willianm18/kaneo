import { client } from "@kaneo/libs";

async function startTimer({
  taskId,
  description,
}: {
  taskId: string;
  description?: string;
}) {
  const response = await client["time-entry"].task[":taskId"].start.$post({
    param: { taskId },
    json: { description },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return await response.json();
}

export default startTimer;
