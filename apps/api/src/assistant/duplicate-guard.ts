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

/**
 * O usuario pediu, com todas as letras, para abrir um chamado?
 *
 * Existe porque a barreira de duplicata errou feio em producao: a pessoa
 * mandou "Abra um chamado para verificar os itens duplicados no MetaX Acesso",
 * a barreira achou parecido um chamado de outro assunto que tambem citava
 * MetaX Acesso, e o assistente foi comentar no card errado em vez de criar o
 * que foi pedido — e repetiu o erro quando a pessoa insistiu.
 *
 * Diante de um pedido explicito, a barreira nao tem o que decidir: quem esta
 * falando sabe que quer um chamado novo. Ela existe para o caso oposto, o
 * relato solto em que ninguem pediu nada e o assistente e que escolhe criar.
 */
const EXPLICIT_CREATE_PATTERNS = [
  // "criei", "abri" e "registrei" entram porque a transcricao de voz troca o
  // imperativo pelo passado: "crie uma tarefa" volta como "criei uma tarefa".
  /\b(abre|abra|abri|abrir|cria|crie|criei|criar|registra|registre|registrei|registrar|faca|faz|faze[rn]?)\b[^.?!]{0,40}\b(chamado|chamados|tarefa|tarefas|card|ticket)\b/,
  /\b(novo|nova|outro|outra)\s+(chamado|tarefa|card|ticket)\b/,
  /\b(open|create|file)\b[^.?!]{0,40}\b(ticket|task|issue|card)\b/,
];

export function hasExplicitCreateRequest(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return EXPLICIT_CREATE_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * Pedido de anotacao livre: "anota ai que...", "so registrando que...".
 *
 * E pedido de registro NOVO, nao de escrever num chamado existente — em
 * producao "anota ai que a Alessandra pediu mais dois projetos" virou
 * comentario em dois chamados de Bracell. Quando a pessoa cita o numero de um
 * chamado, isso deixa de valer: ai o alvo foi dado por ela.
 */
const FREE_NOTE_PATTERNS = [
  /\banota\b/,
  /\banote\b/,
  /\banotar\b/,
  /\bdeixa\s+(registrado|anotado)\b/,
  /\bso\s+registrando\b/,
  /\bsomente\s+registrando\b/,
];

export function isFreeNoteRequest(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return FREE_NOTE_PATTERNS.some((pattern) => pattern.test(normalized));
}
