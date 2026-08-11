import { client } from "@kaneo/libs";

async function getActiveTimers() {
  const response = await client["time-entry"].active.$get();

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return await response.json();
}

export default getActiveTimers;
