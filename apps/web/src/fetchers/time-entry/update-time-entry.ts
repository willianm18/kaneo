import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";

export type UpdateTimeEntryRequest = InferRequestType<
  (typeof client)["time-entry"][":id"]["$put"]
>["json"] & {
  id: string;
};

async function updateTimeEntry({
  id,
  startTime,
  endTime,
  description,
  duration,
}: UpdateTimeEntryRequest) {
  const response = await client["time-entry"][":id"].$put({
    param: { id },
    json: {
      startTime,
      endTime,
      description,
      duration,
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error);
  }

  const data = await response.json();
  return data;
}

export default updateTimeEntry;
