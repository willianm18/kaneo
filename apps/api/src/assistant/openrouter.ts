import { HTTPException } from "hono/http-exception";
import type { OpenRouterTool } from "./collect-tools";

export type OpenRouterToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type OpenRouterMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenRouterToolCall[];
  tool_call_id?: string;
};

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export async function callOpenRouter({
  apiKey,
  model,
  messages,
  tools,
}: {
  apiKey: string;
  model: string;
  messages: OpenRouterMessage[];
  tools: OpenRouterTool[];
}): Promise<OpenRouterMessage> {
  let response: Response;

  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages, tools, tool_choice: "auto" }),
    });
  } catch {
    throw new HTTPException(503, {
      message: "Assistant provider is unreachable",
    });
  }

  if (response.status === 401 || response.status === 403) {
    throw new HTTPException(500, {
      message: "Assistant credentials are invalid",
    });
  }

  if (response.status === 402) {
    throw new HTTPException(500, {
      message: "Assistant provider reported insufficient credit",
    });
  }

  if (!response.ok) {
    throw new HTTPException(503, {
      message: "Assistant provider returned an error",
    });
  }

  const data = (await response.json()) as {
    choices?: { message?: OpenRouterMessage }[];
  };

  const message = data.choices?.[0]?.message;

  if (!message) {
    throw new HTTPException(503, {
      message: "Assistant provider returned an empty response",
    });
  }

  return message;
}
