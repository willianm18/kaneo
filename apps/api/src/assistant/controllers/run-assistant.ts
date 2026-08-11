import {
  type CollectedTool,
  collectTools,
  toOpenRouterTools,
} from "../collect-tools";
import {
  callOpenRouter,
  type OpenRouterMessage,
  type OpenRouterToolCall,
} from "../openrouter";

const DESTRUCTIVE_TOOLS = new Set([
  "delete_task",
  "delete_label",
  "delete_task_comment",
  "delete_task_relation",
]);

const MAX_TURNS = 8;

export type RunAssistantParams = {
  messages: { role: "user" | "assistant"; content: string }[];
  // Estado exato devolvido junto com um pendingConfirmation. Quando presente,
  // substitui `messages` como base da conversa, preservando o `call.id`
  // original do provider para que a confirmacao consiga bater com ele.
  resumeFrom?: OpenRouterMessage[];
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
  // Presente somente junto com pendingConfirmation. O cliente devolve isso
  // como `resumeFrom` na chamada seguinte para que a conversa continue do
  // ponto exato onde parou.
  conversationState?: OpenRouterMessage[];
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

/**
 * Executa os tool_calls informados, na ordem, respeitando o gate de
 * confirmacao para ferramentas destrutivas. Ids em `skipIds` ja possuem um
 * resultado de ferramenta na conversa (retomada de uma chamada anterior) e
 * nao sao reexecutados — isso e o que evita a criacao duplicada quando o
 * cliente reenvia o `resumeFrom`.
 *
 * Retorna um AssistantResult (com pendingConfirmation + conversationState)
 * se parar num call nao confirmado, ou `null` se todos os calls foram
 * tratados (executados, pulados ou com erro reportado ao modelo).
 */
async function processToolCalls({
  calls,
  skipIds,
  conversation,
  actions,
  byName,
  confirmations,
}: {
  calls: OpenRouterToolCall[];
  skipIds: Set<string>;
  conversation: OpenRouterMessage[];
  actions: { tool: string; summary: string }[];
  byName: Map<string, CollectedTool>;
  confirmations: string[];
}): Promise<AssistantResult | null> {
  for (const call of calls) {
    if (skipIds.has(call.id)) {
      continue;
    }

    const tool = byName.get(call.function.name);

    if (!tool) {
      conversation.push({
        role: "tool",
        tool_call_id: call.id,
        content: `Unknown tool: ${call.function.name}`,
      });
      continue;
    }

    if (DESTRUCTIVE_TOOLS.has(tool.name) && !confirmations.includes(call.id)) {
      return {
        reply: "",
        actions,
        pendingConfirmation: {
          toolCallId: call.id,
          tool: tool.name,
          description: `${tool.name} ${call.function.arguments}`,
        },
        conversationState: [...conversation],
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

  return null;
}

async function runAssistant({
  messages,
  resumeFrom,
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

  const conversation: OpenRouterMessage[] = resumeFrom
    ? [...resumeFrom]
    : [
        { role: "system", content: buildSystemPrompt(workspaceId, projectId) },
        ...messages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      ];

  const actions: { tool: string; summary: string }[] = [];

  // Retomada: se a conversa recebida termina numa mensagem do assistant com
  // tool_calls, esses calls ainda nao foram levados ao provider de novo.
  // Precisamos resolve-los (pulando os que ja tem resultado) antes de pedir
  // uma nova fala ao modelo — senao ele falaria duas vezes seguidas e os
  // calls benignos ja executados seriam reemitidos e rodariam de novo.
  if (resumeFrom) {
    let lastAssistantMessage: OpenRouterMessage | undefined;
    for (let i = conversation.length - 1; i >= 0; i--) {
      const entry = conversation[i];
      if (entry?.role === "assistant") {
        lastAssistantMessage = entry;
        break;
      }
    }

    if (lastAssistantMessage?.tool_calls?.length) {
      const executedIds = new Set<string>();
      for (const entry of conversation) {
        if (entry.role === "tool" && entry.tool_call_id) {
          executedIds.add(entry.tool_call_id);
        }
      }

      const pending = await processToolCalls({
        calls: lastAssistantMessage.tool_calls,
        skipIds: executedIds,
        conversation,
        actions,
        byName,
        confirmations,
      });

      if (pending) {
        return pending;
      }
    }
  }

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

    const pending = await processToolCalls({
      calls: message.tool_calls,
      skipIds: new Set(),
      conversation,
      actions,
      byName,
      confirmations,
    });

    if (pending) {
      return pending;
    }
  }

  return {
    reply:
      "Nao consegui concluir dentro do limite de passos. Tente dividir o pedido em partes menores.",
    actions,
  };
}

export default runAssistant;
