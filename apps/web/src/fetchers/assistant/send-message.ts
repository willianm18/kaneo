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
//
// This is now delivered as the terminal event of an SSE stream (event:
// "result") rather than as a single JSON body — see AssistantRequestError
// below for how the client tells a genuine assistant failure apart from the
// connection merely dropping mid-stream.
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

/**
 * Thrown by sendAssistantMessage when the turn does not end in a "result"
 * event. `kind` lets the UI show a different message for each case:
 *  - "assistant": the server sent an explicit "error" event — the assistant
 *    (or a tool it called) genuinely failed. Logged server-side already.
 *  - "connection": the stream ended or errored before a "result"/"error"
 *    event arrived — most likely a dropped connection, not a real failure.
 * `partial` is true when at least one tool had already started running
 * before the stream died, meaning the work may already have been applied —
 * the UI must not invite a blind retry in that case.
 */
export class AssistantRequestError extends Error {
  readonly kind: "assistant" | "connection";
  readonly partial: boolean;

  constructor(
    message: string,
    kind: "assistant" | "connection",
    partial: boolean,
  ) {
    super(message);
    this.name = "AssistantRequestError";
    this.kind = kind;
    this.partial = partial;
  }
}

type SSEEvent = { event: string; data: string };

// Minimal parser for the subset of the SSE wire format writeSSE() produces:
// one or more "field: value" lines per message, separated by a blank line.
// Our payloads are always single-line JSON, so multi-line `data:` framing
// is not needed.
function parseSSEBlock(block: string): SSEEvent {
  let event = "message";
  const dataLines: string[] = [];

  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trim());
    }
  }

  return { event, data: dataLines.join("\n") };
}

async function sendAssistantMessage(
  payload: SendAssistantMessageRequest,
  onProgress?: (toolName: string) => void,
): Promise<SendAssistantMessageResponse> {
  const response = await client.assistant.chat.$post({ json: payload });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new AssistantRequestError(
      "Assistant response has no body",
      "connection",
      false,
    );
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let result: SendAssistantMessageResponse | null = null;
  let serverError: string | null = null;
  let toolStarted = false;

  const handleEvent = ({ event, data }: SSEEvent) => {
    if (!data) return;
    if (event === "progress") {
      toolStarted = true;
      const parsed = JSON.parse(data) as { tool: string };
      onProgress?.(parsed.tool);
    } else if (event === "result") {
      result = JSON.parse(data) as SendAssistantMessageResponse;
    } else if (event === "error") {
      const parsed = JSON.parse(data) as { message: string };
      serverError = parsed.message;
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      let separatorIndex = buffer.indexOf("\n\n");
      while (separatorIndex !== -1) {
        handleEvent(parseSSEBlock(buffer.slice(0, separatorIndex)));
        buffer = buffer.slice(separatorIndex + 2);
        separatorIndex = buffer.indexOf("\n\n");
      }
    }
  } catch (error) {
    throw new AssistantRequestError(
      error instanceof Error ? error.message : "Connection lost",
      "connection",
      toolStarted,
    );
  }

  if (serverError) {
    throw new AssistantRequestError(serverError, "assistant", toolStarted);
  }

  if (!result) {
    throw new AssistantRequestError(
      "Stream ended before a result was received",
      "connection",
      toolStarted,
    );
  }

  return result;
}

export default sendAssistantMessage;
