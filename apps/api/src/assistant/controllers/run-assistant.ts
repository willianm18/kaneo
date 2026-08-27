import { HTTPException } from "hono/http-exception";
import {
  type CollectedTool,
  collectTools,
  toOpenRouterTools,
} from "../collect-tools";
import { findFirstColumnSlug, findTaskByTitle } from "../daily-report-store";
import {
  type DuplicateCandidate,
  findBlockingDuplicate,
  hasExplicitCreateRequest,
  isFreeNoteRequest,
} from "../duplicate-guard";
import {
  callOpenRouter,
  type OpenRouterMessage,
  type OpenRouterToolCall,
} from "../openrouter";
import { selectToolsForConversation } from "../select-tools";
import { buildDailyReportTitle, isShiftReport } from "../shift-report";
import {
  extractKeywords,
  findSimilarTasks,
  splitIntoItems,
} from "../similar-tasks";
import {
  asksForStatusChange,
  extractDeclaredTaskNumbers,
  findAmbiguousTargets,
  isReadOnlyQuestion,
} from "../target-guard";
import {
  parseTaskNumberReference,
  resolveTaskIdByNumber,
} from "../task-reference";

const DESTRUCTIVE_TOOLS = new Set([
  "delete_task",
  "delete_label",
  "delete_task_comment",
  "delete_task_relation",
]);

/**
 * Um relato de turno costuma trazer quatro ou cinco itens, e cada item gasta
 * dois passos: procurar o chamado e agir nele. Com oito, uma fala comum de
 * fim de expediente esbarrava no teto e voltava "nao consegui concluir dentro
 * do limite de passos" — depois de ja ter criado parte das tarefas.
 */
const MAX_TURNS = 14;

/**
 * Ferramentas que alteram um chamado existente. Sao as que exigem saber
 * exatamente qual e o alvo — errar aqui mexe no trabalho de outra pessoa.
 */
const TASK_ID_ARG_TOOLS = new Set([
  "get_task",
  "create_task_comment",
  "list_task_comments",
  "update_task",
  "update_task_status",
  "update_task_assignee",
  "update_task_due_date",
  "move_task",
  "delete_task",
  "set_task_estimate",
  "set_task_completion_date",
  "list_task_activity",
  "list_task_time_entries",
  "start_task_timer",
  "stop_task_timer",
  "pause_task_timer",
]);

const TASK_MUTATION_TOOLS = new Set([
  "create_task_comment",
  "update_task",
  "update_task_status",
  "update_task_assignee",
  "update_task_due_date",
  "move_task",
]);

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
    "Every intent ends in create_task: a request, a record of completed work and a free note are all recorded as a task in the current project. Answering in the chat is not recording it — a note that only appears in your reply is lost when the window closes. Never reply 'anotado', 'registrado' or similar without having called create_task in this same turn.",
    "Prefer acting over asking. If the message already gives enough to fill the required sections for that intent, create the task immediately — do not ask anything. Ask only when the message clearly IS a work request and something essential is missing: then ask exactly one consolidated question gathering everything missing at once (e.g. 'quem isso impacta e qual o resultado esperado?'), then create the task from the answer; never a sequence of one-question-at-a-time. Never ask when the intent is a free note or a record of completed work — create it with whatever was said. Never fill a section with placeholder text like 'a definir' — either you know it or you ask once, and if it is not a request, drop the section format entirely instead of padding it.",
    "One message can carry several items at once — a shift report covering different machines or fronts. Handle every item in the same turn, never only the first, and never merge two items into one task.",
    "Items usually refer to work already tracked. When the context lists possibly related existing tickets, act on the matching one instead of creating a new task about it: record what was said with create_task_comment (once per ticket), and only call update_task_status when the item says that work actually finished. An item saying something arrived, was requested, or is still pending does NOT finish the ticket — comment and leave the status alone. If no listed ticket is the same subject, create a new task normally.",
    "Do not ask for confirmation before applying a multi-item report: apply every item and end with a short summary listing what you created, updated and closed, one line each.",
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
/**
 * Anexa a resposta o que foi recusado no turno.
 *
 * O modelo relata as acoes que TENTOU, nao as que aconteceram: numa recusa
 * ele respondeu "adicionei o comentario no chamado 19" sem que comentario
 * nenhum tivesse sido criado. Como a recusa e decisao do codigo, o aviso
 * tambem tem de vir do codigo — quem esta falando precisa saber o que ficou
 * de fora.
 */
function withBlockedNotices(reply: string, notices: string[]): string {
  if (notices.length === 0) {
    return reply;
  }

  const unicos = [...new Set(notices)];

  const lista = unicos.map((notice) => `- ${notice}`).join("\n");

  return `${reply.trim()}\n\n---\nAtencao, isto nao foi aplicado:\n${lista}`.trim();
}

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
/**
 * Ids de tarefa que ja apareceram nesta conversa.
 *
 * O assistente anota em suas proprias respostas as tarefas em que agiu
 * ("[sistema: ... id ...]"), e e isso que permite o acompanhamento natural:
 * "cria o chamado" seguido de "coloca tambem que o operador escorregou" mexe
 * na tarefa recem-criada sem a pessoa precisar dizer o numero.
 */
function collectTaskIdsFromHistory(
  messages: { role: string; content: string }[],
): string[] {
  const ids: string[] = [];

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }
    for (const match of message.content.matchAll(/\[sistema:[^\]]*\]/g)) {
      for (const id of match[0].matchAll(/\b[a-z0-9]{20,32}\b/g)) {
        ids.push(id[0]);
      }
    }
  }

  return ids;
}

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
  explicitCreateRequest,
  readOnlyQuestion,
  allowedTaskIds,
  declaredNumbers,
  blockedNotices,
  executedCalls,
  statusChangeRequested,
  blockedDrafts,
  projectId,
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
  // Chamados parecidos ja calculados para este turno; usados para barrar a
  // criacao de um card que repete um deles. Vazio quando nao ha projeto.
  // A fala pediu uma tarefa nova? Nesse caso, chamados existentes ficam fora
  // do alcance a menos que a pessoa tenha citado o numero de algum.
  explicitCreateRequest: boolean;
  // A fala e pergunta? Consulta nao escreve no board.
  readOnlyQuestion: boolean;
  // Ids em que se pode mexer: os que a pessoa citou pelo numero e os que ja
  // foram tocados nesta conversa. Fora disso, chamado nao e alterado.
  allowedTaskIds: Set<string>;
  declaredNumbers: number[];
  // Projeto atual, usado para traduzir o numero do chamado para o id real.
  projectId?: string;
  // A fala pede para mudar o estado do chamado? Quando nao pede, mover de
  // coluna e uma alteracao que ninguem autorizou.
  statusChangeRequested: boolean;
  // Assinaturas de create_task ja barradas uma vez neste turno. A barreira
  // avisa, nao impede: se o modelo insistir com os mesmos dados, cria.
  blockedDrafts: Set<string>;
  // Acoes recusadas neste turno. O modelo costuma relatar como se tivessem
  // acontecido, entao o aviso e anexado a resposta pelo proprio codigo.
  blockedNotices: string[];
  // Assinaturas ja executadas neste turno, para nao repetir a mesma acao.
  executedCalls: Set<string>;
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

    // O modelo costuma passar o numero do chamado ("29") no lugar do id,
    // porque e o que a pessoa fala e o que aparece na tela. Traduzir aqui
    // evita a falha em cascata: sem isso a API nao acha a tarefa, devolve
    // "Workspace ID could not be determined" e cada tentativa queima um passo
    // do turno.
    if (projectId && TASK_ID_ARG_TOOLS.has(tool.name)) {
      const draft = args as Record<string, unknown>;
      const rawTaskId = draft.taskId;
      if (typeof rawTaskId === "string") {
        const number = parseTaskNumberReference(rawTaskId);
        if (number !== null) {
          const resolved = await resolveTaskIdByNumber(projectId, number);
          if (resolved) {
            args = { ...draft, taskId: resolved };
          }
        }
      }
    }

    // Consulta nao escreve. Uma pergunta se responde lendo, e escrever a
    // partir dela e sempre erro — "quais chamados estao em aberto?" chegou a
    // virar comentario dentro de um chamado.
    if (
      (TASK_MUTATION_TOOLS.has(tool.name) || tool.name === "create_task") &&
      readOnlyQuestion
    ) {
      blockedNotices.push(
        `${tool.name} nao foi aplicado: a mensagem era uma pergunta, nao um pedido de registro.`,
      );
      conversation.push({
        role: "tool",
        tool_call_id: call.id,
        content:
          "Not applied: the user asked a question, they did not ask to record anything. " +
          "Answer it by reading (list_tasks, get_task, search) and reply with the answer. Never tell the user you recorded something that was not applied.",
      });
      continue;
    }

    // Chamado so e tocado quando a pessoa diz qual: pelo numero, ou porque a
    // tarefa foi criada nesta mesma conversa. Sem isso o assistente escolhia
    // sozinho e escrevia em cards que nada tinham a ver com o pedido.
    if (TASK_MUTATION_TOOLS.has(tool.name)) {
      const target = (args as { taskId?: unknown }).taskId;
      const permitido =
        typeof target === "string" && allowedTaskIds.has(target);

      if (!permitido) {
        const alvos =
          declaredNumbers.length > 0
            ? ` Voce citou ${declaredNumbers.map((n) => `#${n}`).join(", ")}.`
            : "";
        blockedNotices.push(
          `${tool.name} nao foi aplicado: nao ficou claro em qual chamado mexer.${alvos}`,
        );
        conversation.push({
          role: "tool",
          tool_call_id: call.id,
          content:
            "Not applied: you may only change a ticket the user named by number in this conversation, or one created in this same conversation. " +
            "Do not pick a ticket yourself. Ask the user for the ticket number, or create a new task if that is what was asked. Never tell the user you changed a ticket that was not changed.",
        });
        continue;
      }
    }

    // Alvo ambiguo: mais de um chamado disputa o pedido e ninguem disse o
    // numero. Escolher um seria chute, e comentar no chamado errado ja
    // Mudanca de coluna sem pedido: a fala so queria registrar uma
    // informacao, e mover o chamado altera o board para todo mundo.
    if (tool.name === "update_task_status" && !statusChangeRequested) {
      blockedNotices.push(
        "update_task_status nao foi aplicado: voce nao pediu para mudar a coluna, so para registrar.",
      );
      conversation.push({
        role: "tool",
        tool_call_id: call.id,
        content:
          "Not applied: the user did not ask to change the status, only to record something. " +
          "Add the information with create_task_comment and leave the column as it is. Never tell the user the status changed when it did not.",
      });
      continue;
    }

    // Repetir a mesma acao com os mesmos argumentos nao muda nada e queima o
    // turno: em producao o modelo chamou update_task_status seis vezes
    // seguidas, identicas, ate estourar o limite de passos.
    const executionKey = `${tool.name}:${JSON.stringify(args)}`;
    if (executedCalls.has(executionKey)) {
      conversation.push({
        role: "tool",
        tool_call_id: call.id,
        content:
          "Already applied in this turn with exactly these arguments — the result was the same as before. Move on to the next step or answer the user.",
      });
      continue;
    }
    executedCalls.add(executionKey);

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

/**
 * Monta o bloco de contexto com os chamados parecidos. Devolve null quando nao
 * ha projeto, nao ha parecido ou a busca falha: o assistente continua
 * funcionando sem esse apoio, so perde a chance de evitar uma duplicata.
 */
async function fetchSimilarTasks(
  projectId: string | undefined,
  conversationText: string,
): Promise<DuplicateCandidate[]> {
  if (!projectId) {
    return [];
  }

  try {
    const similar = await findSimilarTasks(projectId, conversationText);
    if (similar.length > 0) {
      console.info(
        `assistant similar-tasks projectId=${projectId} found=${similar.length} tasks=${similar
          .map((task) => `#${task.number}(${task.score})`)
          .join(",")}`,
      );
    }
    return similar;
  } catch (error) {
    // Nao e fatal: sem a lista o assistente so perde a chance de evitar uma
    // duplicata. Mas registrar e essencial — um catch silencioso aqui ja
    // escondeu um erro de programacao que fazia o bloco nunca aparecer.
    console.warn(
      `assistant similar-tasks lookup failed (handled) projectId=${projectId} reason="${error instanceof Error ? error.message : String(error)}"`,
    );
    return [];
  }
}

function formatSimilarTasksBlock(
  similar: DuplicateCandidate[],
  explicitCreateRequest: boolean,
  conversationText: string,
): string | null {
  if (similar.length === 0) {
    // Silencio aqui era uma brecha: sem candidato o modelo chamava list_tasks
    // e escolhia um chamado qualquer para pendurar o assunto. Dizer que nao ha
    // nada fecha essa porta.
    return explicitCreateRequest
      ? null
      : "No existing ticket matches what the user just said, so this needs a new task. Do not attach it to an unrelated ticket you may find with list_tasks — create the task.";
  }

  // Cada linha amarra o candidato ao trecho da fala que o trouxe. Sem isso o
  // modelo recebe uma lista solta e cola qualquer item em qualquer chamado:
  // num relato real, "conversei com o Bruno sobre a tela de login" virou
  // comentario num chamado de MetaX so porque ele estava na lista.
  const lines = similar.map((task) => {
    const about = task.matchedItem
      ? `for "${task.matchedItem.replace(/\s+/g, " ").slice(0, 90)}" -> `
      : "";
    const description = task.description
      ? ` — ${task.description.replace(/\s+/g, " ").slice(0, 160)}`
      : "";
    return `- ${about}#${task.number} [${task.status}] ${task.title}${description}`;
  });

  // Os trechos que nenhum chamado cobriu. Dizer isso como dado — e nao como
  // regra — e o que faz o assistente criar tarefa para eles: num relato real
  // ele comentou nos dois chamados encontrados e simplesmente ignorou os
  // outros dois assuntos da mesma fala.
  const matched = new Set(
    similar.map((task) => task.matchedItem).filter(Boolean),
  );
  const unmatched = splitIntoItems(conversationText).filter(
    (item) => !matched.has(item) && extractKeywords(item).length >= 3,
  );

  const unmatchedLine =
    unmatched.length > 0
      ? `Parts of the message with no related ticket (each one still needs to be recorded): ${unmatched
          .map((item) => `"${item.replace(/\s+/g, " ").slice(0, 90)}"`)
          .join("; ")}`
      : null;

  return [
    "Possibly related existing tickets in the current project, found automatically for what the user just said:",
    ...lines,
    ...(unmatchedLine ? [unmatchedLine] : []),
    explicitCreateRequest
      ? "The user explicitly asked for a new ticket, so create it — this list is context, not a reason to skip the creation. If one of these is clearly about the same problem, still create what was asked and say in your reply that #N looks related, so the person decides what to do with it. Never silently comment on an existing ticket instead of creating what was requested."
      : "Each line says which part of the message it was found for: only act on a ticket for THAT part, never for a different item of the message, and act on AT MOST ONE ticket per part — if two tickets are listed for the same part, pick the closest one and leave the other alone. For the matching part, record what was said with create_task_comment and use update_task_status only when the work actually finished. Any part of the message with no ticket listed for it needs a new task — do not attach it to a ticket listed for another part. Always tell the user what you did and on which ticket.",
  ].join("\n");
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

  // Chamados que ja existem sobre o mesmo assunto, calculados aqui e entregues
  // ao modelo como dado. Depender de ele lembrar de buscar antes de criar nao
  // se mostrou confiavel — ver o comentario em similar-tasks.ts. Numa retomada
  // (resumeFrom) esse bloco ja esta na conversa preservada.
  // A busca por chamados parecidos saiu. Ela oferecia cards ao modelo e ele
  // escrevia neles: "quero um card novo replicando o 1910" virou comentario
  // em dois chamados que apenas citavam assuntos proximos. Agora chamado so
  // e tocado quando a pessoa diz qual — por numero, ou porque a tarefa foi
  // criada nesta mesma conversa.
  const explicitCreateRequest =
    hasExplicitCreateRequest(conversationText) ||
    (isFreeNoteRequest(conversationText) &&
      extractDeclaredTaskNumbers(conversationText).length === 0);
  const statusChangeRequested = asksForStatusChange(conversationText);
  const readOnlyQuestion = isReadOnlyQuestion(
    messages.at(-1)?.content ?? conversationText,
  );
  const blockedNotices: string[] = [];
  const executedCalls = new Set<string>();

  const declaredNumbers = extractDeclaredTaskNumbers(conversationText);
  const allowedTaskIds = new Set<string>(collectTaskIdsFromHistory(messages));
  if (projectId) {
    for (const number of declaredNumbers) {
      let id: string | null = null;
      try {
        id = await resolveTaskIdByNumber(projectId, number);
      } catch (error) {
        console.warn(
          `assistant declared-target lookup failed (handled) projectId=${projectId} number=${number} reason="${error instanceof Error ? error.message : String(error)}"`,
        );
      }
      if (id) {
        allowedTaskIds.add(id);
        allowedTaskIds.add(String(number));
      }
    }
  }

  // Uma assinatura por rascunho barrado, valida so dentro deste turno.
  const blockedDrafts = new Set<string>();

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
        explicitCreateRequest,
        readOnlyQuestion,
        allowedTaskIds,
        declaredNumbers,
        blockedNotices,
        executedCalls,
        statusChangeRequested,
        blockedDrafts,
        projectId,
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
      return {
        reply: withBlockedNotices(message.content ?? "", blockedNotices),
        actions,
      };
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
      explicitCreateRequest,
      readOnlyQuestion,
      allowedTaskIds,
      declaredNumbers,
      blockedNotices,
      executedCalls,
      statusChangeRequested,
      blockedDrafts,
      projectId,
    });

    if (pending) {
      return pending;
    }
  }

  return {
    reply: withBlockedNotices(
      "Nao consegui concluir dentro do limite de passos. Tente dividir o pedido em partes menores.",
      blockedNotices,
    ),
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
/**
 * O report e registro: dizer que gravou sem ter gravado e o pior desfecho
 * possivel, porque a pessoa segue o dia achando que esta anotado.
 */
function reportFailureReply(detail: string): string {
  return `Nao consegui registrar o report: ${detail.slice(0, 200)}`;
}

/**
 * Registra o report do dia.
 *
 * Um report e historico, nao pedido de trabalho: tudo o que foi dito vai para
 * o card daquele dia e nenhum outro chamado e tocado. Mexer em card continua
 * sendo um pedido separado ("atualize o card 29"), com o numero na mao.
 *
 * O modelo entra so para organizar o texto ditado em topicos — sem
 * ferramentas, sem decidir nada. Onde gravar e decisao do codigo, para que o
 * report caia sempre no mesmo lugar.
 */
async function runDailyReport(
  params: RunAssistantParams,
  reportText: string,
  requestId: string,
): Promise<AssistantResult> {
  const { baseUrl, token, apiKey, model, projectId } = params;
  const tools = collectTools(baseUrl, token);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  let body = reportText.trim();
  try {
    const organized = await callOpenRouter({
      apiKey,
      model,
      messages: [
        {
          role: "system",
          content:
            "Organize the dictated report into short markdown bullet points, one per subject, in the same language as the text. Preserve every fact, name, number and decision; only clean up the filler of speech. Do not invent, do not summarize away, do not add headings or commentary. Answer with the bullets only.",
        },
        { role: "user", content: reportText },
      ],
      tools: [],
    });
    if (organized.content?.trim()) {
      body = organized.content.trim();
    }
  } catch (error) {
    // Falhar aqui nao pode custar o registro: sem a organizacao, grava-se o
    // texto como foi dito.
    console.warn(
      `assistant daily-report formatting failed (handled) reqId=${requestId} reason="${error instanceof Error ? error.message : String(error)}"`,
    );
  }

  const title = buildDailyReportTitle(new Date());
  const actions: { tool: string; summary: string }[] = [];

  const existing = projectId ? await findTaskByTitle(projectId, title) : null;

  if (existing) {
    const comment = byName.get("create_task_comment");
    if (!comment) {
      throw new AssistantStageError("daily-report", new Error("missing tool"));
    }
    const result = await comment.execute({
      taskId: existing.id,
      content: body,
    });
    const text = toolResultText(result);

    if (result.isError) {
      console.warn(
        `assistant daily-report append failed reqId=${requestId} reason="${truncateForLog(text)}"`,
      );
      return { reply: reportFailureReply(text), actions };
    }

    actions.push({ tool: "create_task_comment", summary: text.slice(0, 200) });

    return {
      reply: `Registrei no report de hoje (#${existing.number}).`,
      actions,
    };
  }

  const create = byName.get("create_task");
  if (!create) {
    throw new AssistantStageError("daily-report", new Error("missing tool"));
  }

  const result = await create.execute({
    projectId,
    title,
    description: body,
    priority: "low",
    // create_task exige o status, e as colunas sao configuraveis por projeto:
    // o card do dia nasce na primeira coluna do board, seja qual for o nome.
    status: projectId ? await findFirstColumnSlug(projectId) : "to-do",
  });
  const text = toolResultText(result);

  if (result.isError) {
    console.warn(
      `assistant daily-report create failed reqId=${requestId} reason="${truncateForLog(text)}"`,
    );
    return { reply: reportFailureReply(text), actions };
  }

  actions.push({ tool: "create_task", summary: text.slice(0, 200) });

  const number = text.match(/"number"\s*:\s*(\d+)/)?.[1];

  return {
    reply: number
      ? `Criei o report de hoje (#${number}) com o que voce falou.`
      : "Criei o report de hoje com o que voce falou.",
    actions,
  };
}

async function runAssistant(
  params: RunAssistantParams,
): Promise<AssistantResult> {
  const requestId =
    typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);
  const toolErrors = { count: 0 };

  try {
    // Uma fala anunciada como report vira o registro do dia; qualquer outra
    // segue o caminho normal, com ferramentas e decisao do modelo.
    const lastMessage = params.messages.at(-1);
    const isReport =
      !params.resumeFrom &&
      lastMessage?.role === "user" &&
      isShiftReport(lastMessage.content);

    const result =
      isReport && lastMessage
        ? await runDailyReport(params, lastMessage.content, requestId)
        : await runAssistantTurn(params, requestId, toolErrors);

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
