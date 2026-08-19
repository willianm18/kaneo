import { HTTPException } from "hono/http-exception";
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
import { selectToolsForConversation } from "../select-tools";

const DESTRUCTIVE_TOOLS = new Set([
  "delete_task",
  "delete_label",
  "delete_task_comment",
  "delete_task_relation",
]);

const MAX_TURNS = 8;

/**
 * Erro lancado quando uma etapa externa (chamada ao modelo ou execucao de
 * ferramenta) falha. Carrega `stage` para que quem chama runAssistant
 * (a rota) consiga logar onde exatamente a falha aconteceu, sem precisar
 * inspecionar o erro original.
 */
export class AssistantStageError extends Error {
  readonly stage: string;
  readonly cause: unknown;

  constructor(stage: string, cause: unknown) {
    super(`Assistant failed at stage: ${stage}`);
    this.name = "AssistantStageError";
    this.stage = stage;
    this.cause = cause;
  }
}

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
  // Chamado logo antes de cada ferramenta ser efetivamente executada (nao
  // para calls pulados, desconhecidos ou aguardando confirmacao). Usado pela
  // rota para transmitir progresso via SSE enquanto o turno roda.
  onProgress?: (toolName: string) => void | Promise<void>;
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

export function buildSystemPrompt(
  workspaceId?: string,
  projectId?: string,
  now: Date = new Date(),
): string {
  const context = [
    workspaceId ? `Current workspace id: ${workspaceId}.` : null,
    projectId ? `Current project id: ${projectId}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return [
    "You are the Kaneo assistant. You help the user manage tasks by calling the available tools.",
    "Before creating a task, decide its intent from the user's own wording. Three intents exist: a request for future work; a record of work already completed (past tense — 'foi feito', 'separamos', 'ajustei' — possibly with something still pending); or a free note (a thought, an observation, a reminder, an idea, or a long spoken dictation that simply does not read as a work request — 'anota ai', 'so registrando', or any dump of context with no ask in it). The structured formats exist to serve a request, never to block a note: if the message does not read as a work request, it is a free note, and you must create it as-is without forcing it into any section format and without asking anything.",
    "Prefer acting over asking. If the message already gives enough to fill the required sections for that intent, create the task immediately — do not ask anything. Ask only when the message clearly IS a work request and something essential is missing: then ask exactly one consolidated question gathering everything missing at once (e.g. 'quem isso impacta e qual o resultado esperado?'), then create the task from the answer; never a sequence of one-question-at-a-time. Never ask when the intent is a free note or a record of completed work — create it with whatever was said. Never fill a section with placeholder text like 'a definir' — either you know it or you ask once, and if it is not a request, drop the section format entirely instead of padding it.",
    "Structure the created task's description in markdown, translated into the user's language. Use only heading level 2 (## Heading) for section titles — the task editor renders only heading levels 1 to 3, so #### or deeper appears as literal '####' text. For a request: three headings — why it matters (the problem, impact, cost of not doing it), who it matters to (affected people, team, client, machine, or process), what is wanted (the concrete expected outcome). For a record of completed work: three headings — what was done (the substance of the card, described in full, not a preamble), what changed as a result, what is still pending (listed as pending only — never promoted into the ticket's purpose). For a free note: no headings and no fixed sections — write the content as clean prose or bullet points, preserving everything the user said (facts, numbers, names, decisions) with only the filler of speech cleaned up; do not invent, summarize away, or reorder into a format the user did not ask for. Keep the title short and specific — the structure belongs in the description, not the title.",
    "When the user does not name a project, use the current one from the context below.",
    "Stay scoped to the current project: any lookup or mutation (get_task, update_task, update_task_status, list_tasks, ...) must target the current project id from the context, unless the user explicitly names a different project. Never act on a task that turns out to belong to another project.",
    "Create a task only when the user asks for a NEW one. A follow-up that adds or changes fields (dates, estimate, status, description) on a task you just created or were just discussing is an UPDATE, not a new task — call update_task on that task. The conversation carries the ids of tasks already acted on this session in a `[sistema: ...id ...]` note on your earlier replies; use that id. If no id is available and the target is ambiguous, find it with list_tasks before creating a duplicate.",
    "Standard status slugs are to-do, planned, in-progress, in-review, done, archived, but columns are customizable per project and may use different slugs. Never guess or translate a status string. When the user names a column or status (in any language, e.g. 'em andamento', 'to do', 'review'), call list_project_columns for the current project first and use the exact slug it returns. 'Em aberto'/'open' is not a status: it means every task whose column is not final (isFinal), i.e. everything except done/archived-type columns.",
    "When creating a task, if the user states a target status anywhere in the message — even mid-sentence, in any language, buried in a long dictation — resolve it via list_project_columns and pass its exact slug as create_task's status. Never silently fall back to the default column when a status was stated.",
    "A reference like 'verify-proj-5' is <project-slug>-<task number>, not a task title or free text. Resolve it by listing the tasks of that project (list_tasks on the project matching the slug, defaulting to the current project when the slug matches it) and matching the `number` field exactly. Never resolve it by fuzzy-matching a title, and never search across other projects for it.",
    "Do not guess the target of a mutation. If you cannot identify the exact task, project, or column unambiguously, ask a clarifying question instead of acting. Reporting success on the wrong item is worse than asking one question.",
    `Current date and time: ${now.toISOString()} (ISO 8601, UTC offset). This is computed fresh for this request — trust it over any date you might otherwise recall from training data.`,
    "Resolve every relative date or time expression ('hoje', 'amanha', 'semana que vem', 'next Friday', 'in 3 days', etc.) against the current date and time above, never against memory or training data. When the user gives a date without a year (e.g. '18/08' or 'March 3rd'), resolve it to the nearest sensible occurrence relative to today: if that day/month has already passed this year, use next year; otherwise use this year. Never invent or default to a year from your training data.",
    "When reporting the current state of anything (a task's status, due date, estimate, completion date, assignee, comments, etc.), always use the result of the most recent tool call you made earlier in this same turn — never restate a value from an earlier message in the conversation, even one you produced yourself. If you have not looked the value up in this turn (e.g. right after changing it), call the appropriate read tool (get_task, list_tasks, ...) before asserting it, so you report what is actually stored now rather than what you last remembered.",
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

// Handled tool errors (isError: true) never throw — the text is fed back
// to the model so it can self-correct — so nothing about them reaches the
// route's catch block. Without a log line here, a tool silently failing
// (bad status slug, task not found, permission denied) leaves no trace at
// all, even though it's the common failure shape in daily use. Truncated
// because tool error text can include full stack-ish payloads.
const TOOL_ERROR_LOG_LENGTH = 500;

function truncateForLog(
  text: string,
  maxLength = TOOL_ERROR_LOG_LENGTH,
): string {
  return text.length > maxLength
    ? `${text.slice(0, maxLength)}... (truncated)`
    : text;
}

/**
 * Falhas que terminam o turno com uma mensagem "nao consegui" propria,
 * em vez de uma resposta normal do modelo. Usado so para o log-resumo de
 * fim de requisicao (nao muda nada do fluxo em si).
 */
function isFailureOutcome(reply: string): boolean {
  return (
    reply.startsWith("O modelo nao respondeu") ||
    reply.startsWith("Nao consegui concluir dentro do limite")
  );
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
  onProgress,
  requestId,
  toolErrors,
}: {
  calls: OpenRouterToolCall[];
  skipIds: Set<string>;
  conversation: OpenRouterMessage[];
  actions: { tool: string; summary: string }[];
  byName: Map<string, CollectedTool>;
  confirmations: string[];
  onProgress?: (toolName: string) => void | Promise<void>;
  requestId: string;
  toolErrors: { count: number };
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

    await onProgress?.(tool.name);

    let result: {
      content: { type: "text"; text: string }[];
      isError?: boolean;
    };
    try {
      result = await tool.execute(args);
    } catch (error) {
      throw new AssistantStageError(`tool:${tool.name}`, error);
    }
    const text = toolResultText(result);

    if (!result.isError) {
      actions.push({ tool: tool.name, summary: text.slice(0, 200) });
    } else {
      toolErrors.count += 1;
      // Warning, not error: the text still goes into the conversation below
      // unchanged so the model can try to recover — this is not fatal, just
      // worth knowing about when a conversation looks off in hindsight.
      console.warn(
        `assistant tool call failed (handled) reqId=${requestId} tool=${tool.name} reason="${truncateForLog(text)}"`,
      );
    }

    conversation.push({
      role: "tool",
      tool_call_id: call.id,
      content: text,
    });
  }

  return null;
}

async function runAssistantTurn(
  {
    messages,
    resumeFrom,
    token,
    baseUrl,
    apiKey,
    model,
    workspaceId,
    projectId,
    confirmations = [],
    onProgress,
  }: RunAssistantParams,
  requestId: string,
  toolErrors: { count: number },
): Promise<AssistantResult> {
  const tools = collectTools(baseUrl, token);
  // Os schemas das ferramentas viajam no prompt de toda chamada e o custo do
  // modelo e dominado pela entrada. Mandar so as do assunto da conversa corta
  // boa parte dos tokens de uma conversa comum. `byName` continua com TODAS
  // as ferramentas: se o modelo pedir uma que ficou de fora (ou a selecao
  // errar), a execucao ainda funciona.
  const conversationText = messages
    .map((message) => message.content)
    .join("\n");
  const toolDefinitions = toOpenRouterTools(
    selectToolsForConversation(tools, conversationText),
  );
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
        onProgress,
        requestId,
        toolErrors,
      });

      if (pending) {
        return pending;
      }
    }
  }

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let message: OpenRouterMessage;
    try {
      message = await callOpenRouter({
        apiKey,
        model,
        messages: conversation,
        tools: toolDefinitions,
      });
    } catch (error) {
      throw new AssistantStageError(`model-turn-${turn}`, error);
    }

    if (!message.tool_calls?.length && !message.content?.trim()) {
      // Empty response from the model. Retrying is only safe when nothing
      // has been executed yet in this request: if a tool already ran and
      // the model then returned nothing, retrying could re-run those tools
      // and duplicate work (the exact bug we hit earlier). In that case we
      // stop and tell the user to check before repeating instead.
      if (actions.length > 0) {
        return {
          reply:
            "O modelo nao respondeu, mas parte da solicitacao pode ja ter sido executada. Confira antes de repetir o pedido.",
          actions,
        };
      }

      try {
        message = await callOpenRouter({
          apiKey,
          model,
          messages: conversation,
          tools: toolDefinitions,
        });
      } catch (error) {
        throw new AssistantStageError(`model-turn-${turn}-retry`, error);
      }

      if (!message.tool_calls?.length && !message.content?.trim()) {
        throw new AssistantStageError(
          `model-turn-${turn}-retry`,
          new HTTPException(503, {
            message: "Assistant provider returned no response, try again",
          }),
        );
      }
    }

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
      onProgress,
      requestId,
      toolErrors,
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

/**
 * Envelope fino em volta de runAssistantTurn so para o log-resumo de fim de
 * requisicao: conta erros de ferramenta tratados (isError, nunca lancados) e
 * — quando houve pelo menos um — registra uma linha dizendo quantos
 * ocorreram e se o turno terminou com sucesso ou falha. Sem isso, um tool
 * error tratado nao deixa rastro nenhum no log (ele so aparece de volta na
 * conversa, para o modelo tentar se recuperar), o que torna impossivel
 * diagnosticar depois por que o assistente respondeu algo estranho. Nao
 * loga nada quando nao houve erro de ferramenta, para nao gerar ruido no
 * caminho feliz.
 */
async function runAssistant(
  params: RunAssistantParams,
): Promise<AssistantResult> {
  const requestId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  const toolErrors = { count: 0 };

  try {
    const result = await runAssistantTurn(params, requestId, toolErrors);

    if (toolErrors.count > 0) {
      const outcome = isFailureOutcome(result.reply) ? "failed" : "succeeded";
      console.warn(
        `assistant request summary reqId=${requestId} handledToolErrors=${toolErrors.count} outcome=${outcome}`,
      );
    }

    return result;
  } catch (error) {
    if (toolErrors.count > 0) {
      console.warn(
        `assistant request summary reqId=${requestId} handledToolErrors=${toolErrors.count} outcome=failed`,
      );
    }
    throw error;
  }
}

export default runAssistant;
