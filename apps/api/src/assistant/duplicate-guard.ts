import { extractKeywords, type SimilarTask } from "./similar-tasks";

export type DuplicateCandidate = SimilarTask;

export type NewTaskDraft = {
  title: string;
  description?: string;
};

/**
 * Quantas palavras do assunto a nova tarefa precisa dividir com um chamado
 * aberto para ser tratada como a mesma coisa. Duas e o minimo que exclui
 * coincidencia de verbo generico ("verificar bomba" x "verificar iluminacao")
 * sem exigir que a pessoa repita o titulo inteiro.
 */
const MIN_SHARED_KEYWORDS = 2;

function keywordsOf(text: string): Set<string> {
  return new Set(extractKeywords(text));
}

/**
 * Diz se a tarefa que o assistente quer criar ja existe entre os chamados
 * parecidos — e, nesse caso, qual e.
 *
 * Existe porque so instruir o modelo nao bastou: mesmo recebendo a lista de
 * parecidos pronta, ele criava o card paralelo. Aqui a decisao e deterministica
 * e acontece antes da criacao.
 *
 * O criterio e conservador de proposito. Nao basta parecer: e preciso dividir
 * pelo menos duas palavras do assunto, e os numeros de equipamento tem de
 * bater — "compressor 3" nao e o "compressor 2". Chamado ja fechado nunca
 * bloqueia: se o assunto voltou depois de encerrado, e um caso novo e merece
 * card proprio.
 */
export function findBlockingDuplicate(
  draft: NewTaskDraft,
  candidates: DuplicateCandidate[],
): DuplicateCandidate | null {
  const draftKeywords = keywordsOf(`${draft.title} ${draft.description ?? ""}`);
  if (draftKeywords.size === 0) {
    return null;
  }

  const draftNumbers = new Set(
    [...draftKeywords].filter((word) => /^\d+$/.test(word)),
  );

  for (const candidate of candidates) {
    if (isClosed(candidate.status)) {
      continue;
    }

    const candidateKeywords = keywordsOf(
      `${candidate.title} ${candidate.description ?? ""}`,
    );
    const candidateNumbers = new Set(
      [...candidateKeywords].filter((word) => /^\d+$/.test(word)),
    );

    // Numero citado dos dois lados e diferente: sao ativos diferentes, e
    // fechar/comentar no errado seria pior do que criar um card a mais.
    if (draftNumbers.size > 0 && candidateNumbers.size > 0) {
      const sharesNumber = [...draftNumbers].some((number) =>
        candidateNumbers.has(number),
      );
      if (!sharesNumber) {
        continue;
      }
    }

    const shared = [...draftKeywords].filter(
      (word) => !/^\d+$/.test(word) && candidateKeywords.has(word),
    );

    if (shared.length >= MIN_SHARED_KEYWORDS) {
      return candidate;
    }
  }

  return null;
}

function isClosed(status: string): boolean {
  return status === "done" || status === "archived";
}
