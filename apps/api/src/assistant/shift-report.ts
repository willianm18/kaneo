import { extractKeywords, splitIntoItems } from "./similar-tasks";

/**
 * Report diario: o registro do que a pessoa fez no dia.
 *
 * Nao e pedido de trabalho nem atualizacao de chamado. E historico: tudo o
 * que foi dito vai para um lugar so, o card do dia, sem tocar em nenhum outro
 * chamado. Mexer em card e um pedido separado e explicito ("atualize o card
 * X"), com numero na mao.
 *
 * A primeira versao tentava distribuir cada assunto do relato entre os
 * chamados existentes. Funcionava tecnicamente, mas nao era o que se queria:
 * um report e um so registro, e espalhar o dia por varios cards fazia o
 * historico do dia deixar de existir.
 */

const REPORT_OPENERS = [
  /\breport\b/,
  /\brelato\b/,
  /\bdaily\b/,
  // Cobre "fechamento do turno", "fechamento de turno" e "fechando o turno".
  /\bfecha(ndo|mento)\s+(d?[eoa]s?\s+)?turno\b/,
  /\bpassagem\s+de\s+turno\b/,
  /\bresumo\s+d[oa]\s+(dia|semana|turno)\b/,
  /\bstatus\s+d[oa]\s+(dia|semana)\b/,
];

/** Um item precisa de conteudo proprio para virar registro. */
const MIN_KEYWORDS_PER_ITEM = 3;

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function isShiftReport(text: string): boolean {
  return REPORT_OPENERS.some((pattern) => pattern.test(normalize(text)));
}

/**
 * Titulo do card do dia. A data no titulo e o que garante um card por dia:
 * um segundo relato no mesmo dia encontra o card que ja existe.
 */
export function buildDailyReportTitle(now: Date): string {
  const day = String(now.getDate()).padStart(2, "0");
  const month = String(now.getMonth() + 1).padStart(2, "0");

  return `Report diário — ${day}/${month}/${now.getFullYear()}`;
}

/**
 * Os assuntos do relato, um por item.
 *
 * O cabecalho ("O report de sexta para ca:") e descartado junto com os
 * fragmentos curtos ("ok", "beleza") — nao sao registro, sao conversa.
 */
export function splitReportItems(text: string): string[] {
  return splitIntoItems(text)
    .map((item) => item.replace(/^[^:]{0,60}:\s*/, "").trim())
    .filter((item) => extractKeywords(item).length >= MIN_KEYWORDS_PER_ITEM);
}
