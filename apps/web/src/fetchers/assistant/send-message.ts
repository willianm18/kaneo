import { client } from "@kaneo/libs";
import type { InferRequestType } from "hono/client";

export type AssistantMessage = {
  role: "user" | "assistant";
  content: string;
};

// Matches the request validator in apps/api/src/assistant/index.ts. When
// confirming a destructive action the caller must send `confirmations`,
// `resumeFrom`, and `conversationSignature` together — `resumeFrom` and
// `conversationSignature` must be the exact, unmodified values received in
// a prior response (see SendAssistantMessageResponse below).
export type SendAssistantMessageRequest = InferRequestType<
  (typeof client)["assistant"]["chat"]["$post"]
>["json"];

// Mirrors AssistantResult (apps/api/src/assistant/controllers/run-assistant.ts)
// plus the conversationSignature the route adds alongside conversationState
// (apps/api/src/assistant/index.ts). `conversationState` is opaque: store it
// and send it back unchanged as `resumeFrom` — never parse, reorder, or
// rebuild it, because the HMAC signature covers its exact content. Without
// `resumeFrom` the model re-derives the deletion and gets a new call id that
// never matches the confirmation; without `conversationSignature` the server
// rejects the request with 400.
export type SendAssistantMessageResponse = {
  reply: string;
  actions: { tool: string; summary: string }[];
  pendingConfirmation?: {
    toolCallId: string;
    tool: string;
    description: string;
  };
  conversationState?: unknown[];
  conversationSignature?: string;
};

async function sendAssistantMessage(
  payload: SendAssistantMessageRequest,
): Promise<SendAssistantMessageResponse> {
  const response = await client.assistant.chat.$post({ json: payload });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as SendAssistantMessageResponse;
}

export default sendAssistantMessage;
