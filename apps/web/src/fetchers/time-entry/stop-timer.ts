import { client } from "@kaneo/libs";

async function stopTimer(timeEntryId: string) {
  const response = await client["time-entry"][":id"].stop.$post({
    param: { id: timeEntryId },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return await response.json();
}

export default stopTimer;
