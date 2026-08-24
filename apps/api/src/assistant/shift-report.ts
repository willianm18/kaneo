import { extractKeywords, splitIntoItems } from "./similar-tasks";

/**
 * Relato de turno: uma fala que cobre varios assuntos de uma vez.
 *
 * Mandar a fala inteira numa unica chamada nao funciona. O modelo recebe
 * quatro assuntos e uma lista de chamados a disposicao, e mistura: um item vai
 * parar no card de outro, outro fica sem registro. Foi assim com gpt-4o-mini e
 * com gpt-4.1-mini — nao e falta de instrucao, e excesso de decisao numa
 * chamada so.
 *
 * A saida e dividir antes: cada item vira uma chamada com uma decisao simples
 * ("este item, este chamado ou um novo?").
 *
 * Dividir TODA mensagem seria pior. "Preciso trocar o rolamento da bomba 3.
 * Ela esta fazendo barulho. O operador reclamou" e um pedido so, contado em
 * tres frases, e viraria tres cards. Por isso a divisao so vale quando a fala
 * se anuncia como relato — que e como as pessoas de fato comecam.
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
 * Vale a pena dividir esta fala?
 *
 * So quando ela se anuncia como relato E traz mais de um assunto: "fechando o
 * turno, terminamos a vedacao" e uma coisa so, e segue pelo caminho normal.
 */
export function shouldSplitIntoItems(text: string): boolean {
  return isShiftReport(text) && splitReportItems(text).length >= 2;
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
