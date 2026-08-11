import { collectTools, toOpenRouterTools } from "../collect-tools";
import { callOpenRouter, type OpenRouterMessage } from "../openrouter";

const DESTRUCTIVE_TOOLS = new Set([
  "delete_task",
  "delete_label",
  "delete_task_comment",
  "delete_task_relation",
]);

const MAX_TURNS = 8;

export type RunAssistantParams = {
  messages: { role: "user" | "assistant"; content: string }[];
  token: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  workspaceId?: string;
  projectId?: string;
  confirmations?: string[];
};

export type AssistantResult = {
  reply: string;
  actions: { tool: string; summary: string }[];
  pendingConfirmation?: {
    toolCallId: string;
    tool: string;
    description: string;
  };
};

function buildSystemPrompt(workspaceId?: string, projectId?: string): string {
  const context = [
    workspaceId ? `Current workspace id: ${workspaceId}.` : null,
    projectId ? `Current project id: ${projectId}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return [
    "You are the Kaneo assistant. You help the user manage tasks by calling the available tools.",
    "Prefer acting over asking: if the user asks to open a ticket, create the task with the information given.",
    "When the user does not name a project, use the current one from the context below.",
    "Answer in the same language the user writes in.",
    context,
  ]
    .filter(Boolean)
    .join(" ");
}

function toolResultText(result: {
  content: { type: "text"; text: string }[];
}): string {
  return result.content.map((part) => part.text).join("\n");
}

async function runAssistant({
  messages,
  token,
  baseUrl,
  apiKey,
  model,
  workspaceId,
  projectId,
  confirmations = [],
}: RunAssistantParams): Promise<AssistantResult> {
  const tools = collectTools(baseUrl, token);
  const toolDefinitions = toOpenRouterTools(tools);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const conversation: OpenRouterMessage[] = [
    { role: "system", content: buildSystemPrompt(workspaceId, projectId) },
    ...messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];

  const actions: { tool: string; summary: string }[] = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const message = await callOpenRouter({
      apiKey,
      model,
      messages: conversation,
      tools: toolDefinitions,
    });

    if (!message.tool_calls?.length) {
      return { reply: message.content ?? "", actions };
    }

    conversation.push(message);

    for (const call of message.tool_calls) {
      const tool = byName.get(call.function.name);

      if (!tool) {
        conversation.push({
          role: "tool",
          tool_call_id: call.id,
          content: `Unknown tool: ${call.function.name}`,
        });
        continue;
      }

      if (
        DESTRUCTIVE_TOOLS.has(tool.name) &&
        !confirmations.includes(call.id)
      ) {
        return {
          reply: "",
          actions,
          pendingConfirmation: {
            toolCallId: call.id,
            tool: tool.name,
            description: `${tool.name} ${call.function.arguments}`,
          },
        };
      }

      let args: unknown = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        conversation.push({
          role: "tool",
          tool_call_id: call.id,
          content: "Invalid tool arguments: not valid JSON",
        });
        continue;
      }

      const result = await tool.execute(args);
      const text = toolResultText(result);

      if (!result.isError) {
        actions.push({ tool: tool.name, summary: text.slice(0, 200) });
      }

      conversation.push({
        role: "tool",
        tool_call_id: call.id,
        content: text,
      });
    }
  }

  return {
    reply:
      "Nao consegui concluir dentro do limite de passos. Tente dividir o pedido em partes menores.",
    actions,
  };
}

export default runAssistant;
