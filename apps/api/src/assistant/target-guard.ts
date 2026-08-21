import type { DuplicateCandidate } from "./duplicate-guard";

/**
 * Protecoes sobre o ALVO de uma alteracao — em qual chamado mexer, e se e para
 * mexer no status dele.
 *
 * Motivadas por um caso real: "Atualize o metax informando que ja avisamos o
 * Aldir e nada chegou". Havia mais de um chamado citando MetaX; o assistente
 * escolheu um por conta propria, comentou no errado e ainda mudou o status,
 * que ninguem tinha pedido. Errar o alvo e pior do que perguntar, e mudar de
 * coluna sem pedido mexe no board de todo mundo.
 */

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * A pessoa citou o chamado pelo numero? Se citou, nao ha o que adivinhar.
 *
 * O numero precisa vir acompanhado de "#", do nome do artefato ou do formato
 * <slug>-<numero>. Um numero solto costuma ser equipamento ("compressor 2"),
 * nao chamado.
 */
export function mentionsTaskNumber(text: string): boolean {
  const normalized = normalize(text);

  return (
    /#\s*\d+/.test(normalized) ||
    /\b(tarefa|chamado|card|ticket|issue|task)\s*(numero\s*)?#?\s*\d+/.test(
      normalized,
    ) ||
    /\b[a-z]{2,10}-\d+\b/.test(normalized)
  );
}

/**
 * Mais de um chamado disputando o mesmo pedido.
 *
 * Empate aqui e literal: candidatos a menos de um ponto do melhor colocado.
 * Quando um se destaca, ele e o alvo e nao ha por que interromper quem esta
 * falando; quando dois empatam, qualquer escolha e um chute.
 */
export function findAmbiguousTargets(
  text: string,
  candidates: DuplicateCandidate[],
): DuplicateCandidate[] | null {
  if (candidates.length < 2 || mentionsTaskNumber(text)) {
    return null;
  }

  const best = Math.max(...candidates.map((task) => task.score));
  const tied = candidates.filter((task) => best - task.score <= 1);

  return tied.length >= 2 ? tied : null;
}

/**
 * Termos que dizem que o estado do trabalho mudou — seja nomeando a coluna
 * ("em revisao"), seja contando que acabou ("terminamos", "pode fechar").
 */
const STATUS_CHANGE_PATTERNS = [
  /\b(status|coluna)\b/,
  /\b(fecha|fechar|fechado|fechamos|encerra\w*|conclui\w*|concluid\w*|finaliza\w*|finalizad\w*|resolvid\w*|pronto|prontos)\b/,
  /\b(termina\w*|terminamos|acabamos|acabou)\b/,
  /\b(mov[ae]|mover|passa|passar|coloca|colocar|joga|jogar)\b[^.?!]{0,30}\b(para|pra|em|no|na)\b/,
  /\b(to-do|todo|planned|in-progress|in-review|done|archived)\b/,
  /\b(em\s+(andamento|revisao|analise)|a\s+fazer|planejad\w*|arquivad\w*)\b/,
  /\b(reabr\w*|reabrir)\b/,
];

/**
 * A fala pede para mudar o estado do chamado?
 *
 * Registrar uma informacao ("informando que avisamos o Aldir") nao e pedido de
 * mudanca de coluna. Mover sem pedido e uma alteracao visivel para o time
 * inteiro a partir de uma frase que so queria deixar um recado.
 */
export function asksForStatusChange(text: string): boolean {
  const normalized = normalize(text);

  return STATUS_CHANGE_PATTERNS.some((pattern) => pattern.test(normalized));
}
