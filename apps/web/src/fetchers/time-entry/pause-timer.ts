import { client } from "@kaneo/libs";

async function pauseTimer(timeEntryId: string) {
  const response = await client["time-entry"][":id"].pause.$post({
    param: { id: timeEntryId },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return await response.json();
}

export default pauseTimer;
