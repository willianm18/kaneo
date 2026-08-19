import type { CollectedTool } from "./collect-tools";

/**
 * Ferramentas que vao em toda chamada. Sao as que qualquer conversa pode
 * precisar sem avisar antes: achar, ler, criar e mexer em tarefa. Manter esse
 * conjunto pequeno e o objetivo — cada schema aqui e pago em todas as
 * mensagens, inclusive nas que so pedem "cria uma tarefa".
 */
const CORE_TOOLS = new Set([
  "whoami",
  "list_workspaces",
  "list_projects",
  "list_project_columns",
  "list_tasks",
  "get_task",
  "create_task",
  "update_task",
  "update_task_status",
  "update_task_assignee",
  "update_task_due_date",
  "move_task",
  "delete_task",
  "search",
  // Comentar e acao central do relato de turno ("terminamos X, ficou pingando
  // um pouco"), e a palavra "comentario" nunca aparece nesse tipo de fala —
  // depender do grupo deixaria o assistente sem como registrar o relato.
  "create_task_comment",
]);

/**
 * O resto das ferramentas so entra quando a conversa toca no assunto. Os
 * termos cobrem portugues e ingles porque o assistente responde no idioma de
 * quem fala; a comparacao e feita sobre o texto sem acento e em minusculas,
 * entao "cronometro" casa com "cronômetro" e "CRONOMETRO".
 */
const TOOL_GROUPS: { match: RegExp; tools: string[] }[] = [
  {
    // Tempo e o grupo mais caro (cerca de um quarto de todos os schemas) e o
    // menos usado numa conversa comum de abertura de chamado.
    match:
      /\b(tempo|hora|horas|minuto|minutos|cronometr\w*|timer|apontament\w*|apontar|apontei|estimativ\w*|estimar|duracao|durou|track\w*|clock\w*)\b/,
    tools: [
      "list_task_time_entries",
      "get_time_entry",
      "create_time_entry",
      "update_time_entry",
      "start_task_timer",
      "pause_task_timer",
      "stop_task_timer",
      "list_active_timers",
      "set_task_estimate",
      "set_task_completion_date",
    ],
  },
  {
    match: /\b(comentari\w*|comentar|comment\w*|observacao|observacoes)\b/,
    tools: ["list_task_comments", "update_task_comment", "delete_task_comment"],
  },
  {
    match: /\b(etiqueta\w*|label\w*|tag\w*|marcador\w*)\b/,
    tools: [
      "list_workspace_labels",
      "create_label",
      "delete_label",
      "attach_label_to_task",
      "detach_label_from_task",
    ],
  },
  {
    match:
      /\b(relacion\w*|relacao|relacoes|depend\w*|bloque\w*|bloqueia\w*|vincul\w*|subtarefa\w*|relation\w*|block\w*)\b/,
    tools: [
      "create_task_relation",
      "get_task_relations",
      "delete_task_relation",
    ],
  },
  {
    match: /\b(notifica\w*|aviso\w*|avisos|notification\w*)\b/,
    tools: ["list_notifications"],
  },
  {
    match:
      /\b(membro\w*|equipe\w*|time|usuario\w*|pessoa\w*|member\w*|team\w*)\b/,
    tools: ["list_workspace_members"],
  },
  {
    match: /\b(projeto\w*|project\w*)\b/,
    tools: ["get_project", "create_project", "update_project"],
  },
  {
    match: /\b(atividade\w*|historico\w*|activity|history)\b/,
    tools: ["list_task_activity"],
  },
];

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Escolhe quais ferramentas acompanham a chamada ao modelo, a partir do texto
 * da conversa. Toda chamada envia os schemas das ferramentas no prompt, e o
 * custo do modelo e dominado pela entrada — mandar as 42 sempre significa
 * pagar pelas ferramentas de tempo, etiqueta e relacao em conversas que nunca
 * vao usa-las.
 *
 * A selecao e deliberadamente generosa: na duvida a ferramenta entra. Faltar
 * uma ferramenta que o modelo precisava e uma falha visivel para quem usa,
 * enquanto mandar uma a mais custa alguns tokens.
 */
export function selectToolsForConversation(
  tools: CollectedTool[],
  conversationText: string,
): CollectedTool[] {
  const text = normalize(conversationText);
  const allowed = new Set(CORE_TOOLS);

  for (const group of TOOL_GROUPS) {
    if (group.match.test(text)) {
      for (const name of group.tools) {
        allowed.add(name);
      }
    }
  }

  const selected = tools.filter((tool) => allowed.has(tool.name));

  // Se nenhum nome do nucleo bate com a lista recebida, os nomes daqui estao
  // velhos (ferramenta renomeada no MCP, por exemplo) e a selecao deixaria o
  // assistente sem o basico. Nesse caso e mais seguro mandar tudo. Faltar
  // ferramentas do nucleo na lista recebida, por outro lado, e normal: a
  // selecao trabalha com as que existirem.
  const conheceONucleo = tools.some((tool) => CORE_TOOLS.has(tool.name));

  return conheceONucleo ? selected : tools;
}
