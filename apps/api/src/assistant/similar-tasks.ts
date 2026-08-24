import { and, eq, ilike, ne, or } from "drizzle-orm";

import db from "../database";
import { taskTable } from "../database/schema";

/**
 * Chamados parecidos com o que a pessoa acabou de dizer.
 *
 * O assistente sabe procurar antes de criar, mas depender do julgamento do
 * modelo para isso nao se mostrou confiavel: ora ele nao procura, ora procura,
 * encontra o chamado e abre um card paralelo mesmo assim. Aqui a busca e
 * determinista e roda antes da decisao — o resultado e entregue ao modelo como
 * dado, junto do contexto, em vez de depender de ele lembrar de buscar.
 *
 * Casamento por palavra, nao por embedding: e barato (uma consulta SQL, zero
 * token), explicavel e suficiente para o vocabulario de chao de fabrica, onde
 * o que identifica o assunto costuma ser um substantivo concreto e o numero do
 * equipamento ("disjuntor", "compressor 2").
 */

export type CandidateTask = {
  id: string;
  number: number;
  title: string;
  description: string | null;
  status: string;
};

export type SimilarTask = CandidateTask & {
  score: number;
  // Trecho da fala que trouxe este candidato. Sem isso o modelo recebe uma
  // lista solta e cola qualquer item da fala em qualquer chamado da lista —
  // foi o que aconteceu num relato real, em que "conversei com o Bruno sobre
  // a tela de login" virou comentario num chamado de MetaX.
  matchedItem?: string;
};

const MAX_SIMILAR = 3;

/**
 * Palavras que aparecem em qualquer frase e por isso nao dizem do que ela
 * trata. Sem elas, "no painel eletrico" casaria com qualquer chamado que
 * tivesse "no".
 */
const STOPWORDS = new Set([
  "a",
  "ainda",
  "ao",
  "aos",
  "as",
  "ate",
  "com",
  "como",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "ela",
  "ele",
  "em",
  "essa",
  "esse",
  "esta",
  "este",
  "eu",
  "foi",
  "for",
  "isso",
  "ja",
  "la",
  "mais",
  "mas",
  "me",
  "mesmo",
  "meu",
  "na",
  "nao",
  "nas",
  "no",
  "nos",
  "num",
  "numa",
  "o",
  "os",
  "ou",
  "para",
  "pela",
  "pelo",
  "por",
  "porque",
  "pra",
  "que",
  "se",
  "sem",
  "ser",
  "seu",
  "so",
  "sobre",
  "sua",
  "tem",
  "ter",
  "um",
  "uma",
  "vai",
  "and",
  "are",
  "for",
  "from",
  "has",
  "not",
  "the",
  "was",
  "were",
  "with",
]);

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Reduz um texto as palavras que identificam o assunto. Numeros ficam mesmo
 * tendo um digito so: "compressor 2" e "compressor 3" sao maquinas diferentes,
 * e ignorar o numero e o caminho mais curto para casar com o ativo errado.
 */
export function extractKeywords(text: string): string[] {
  const words = normalize(text)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => {
      if (!word || STOPWORDS.has(word)) {
        return false;
      }
      return /^\d+$/.test(word) || word.length >= 3;
    });

  return [...new Set(words)];
}

/**
 * Ordena os candidatos pelo numero de palavras do assunto que aparecem no
 * titulo ou na descricao. Titulo pesa o dobro: quem repete a palavra no titulo
 * costuma ser sobre aquilo, enquanto a descricao pode so mencionar de passagem.
 */
export function rankSimilarTasks(
  tasks: CandidateTask[],
  keywords: string[],
): SimilarTask[] {
  if (keywords.length === 0) {
    return [];
  }

  const scored: SimilarTask[] = [];

  for (const task of tasks) {
    const title = normalize(task.title);
    const description = normalize(task.description ?? "");
    let score = 0;

    for (const keyword of keywords) {
      if (title.includes(keyword)) {
        score += 2;
      } else if (description.includes(keyword)) {
        score += 1;
      }
    }

    if (score > 0) {
      scored.push({ ...task, score });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || a.number - b.number)
    .slice(0, MAX_SIMILAR);
}

const MAX_PER_ITEM = 2;
const MAX_TOTAL = 6;

/**
 * Nota minima para um chamado ser oferecido como candidato.
 *
 * Um ponto e uma unica palavra casada na descricao — coincidencia de
 * vocabulario, nao mesmo assunto. Candidatos fracos assim nao ajudam ninguem e
 * atrapalham muito: num relato real, "conversei com o Bruno sobre a tela de
 * login" foi parar num chamado de compressor so porque ele estava na lista.
 * Tres pontos exigem titulo mais descricao, ou duas palavras no titulo.
 */
const MIN_SCORE = 3;

/**
 * Uma fala de turno cobre varios assuntos ("o compressor foi resolvido; o
 * disjuntor chegou; apareceu vazamento na prensa 4"). Pontuar a fala inteira de
 * uma vez faz o assunto dominante ocupar as vagas e esconder justamente o
 * chamado do item que ia virar duplicata — foi o que aconteceu no teste com o
 * card "Painel eletrico". Por isso a fala e quebrada em itens antes.
 */
export function splitIntoItems(text: string): string[] {
  return text
    .split(/[;\n.!?]+|\se\s(?=[a-z])/i)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Os chamados parecidos com cada item da fala, sem repetir e com um teto que
 * mantem o bloco curto no prompt.
 */
export function selectSimilarForText(
  tasks: CandidateTask[],
  text: string,
): SimilarTask[] {
  const items = splitIntoItems(text);
  const byId = new Map<string, SimilarTask>();

  for (const item of items) {
    const ranked = rankSimilarTasks(tasks, extractKeywords(item))
      .filter((task) => task.score >= MIN_SCORE)
      .slice(0, MAX_PER_ITEM);
    for (const task of ranked) {
      const existing = byId.get(task.id);
      // O mesmo chamado pode casar com mais de um item: fica com a maior nota,
      // e com o trecho que a produziu.
      if (!existing || existing.score < task.score) {
        byId.set(task.id, { ...task, matchedItem: item });
      }
    }
  }

  return [...byId.values()]
    .sort((a, b) => b.score - a.score || a.number - b.number)
    .slice(0, MAX_TOTAL);
}

/**
 * Busca no projeto os chamados que podem ser o mesmo assunto do texto dado.
 *
 * O filtro em SQL usa as palavras do assunto para trazer poucos candidatos; a
 * pontuacao final acontece em memoria (rankSimilarTasks). Tarefas arquivadas
 * ficam de fora: reabrir arquivo nao e o objetivo, e elas so poluiriam a lista.
 */
export async function findSimilarTasks(
  projectId: string,
  text: string,
): Promise<SimilarTask[]> {
  const keywords = extractKeywords(text);
  if (keywords.length === 0) {
    return [];
  }

  const candidates = await db
    .select({
      id: taskTable.id,
      number: taskTable.number,
      title: taskTable.title,
      description: taskTable.description,
      status: taskTable.status,
    })
    .from(taskTable)
    .where(
      and(
        eq(taskTable.projectId, projectId),
        ne(taskTable.status, "archived"),
        or(
          ...keywords.flatMap((keyword) => [
            ilike(taskTable.title, `%${keyword}%`),
            ilike(taskTable.description, `%${keyword}%`),
          ]),
        ),
      ),
    )
    // Um teto baixo mantem a consulta barata mesmo num projeto grande: a
    // pontuacao so precisa dos candidatos que ja casaram alguma palavra.
    .limit(50);

  return selectSimilarForText(
    candidates.map((task) => ({ ...task, number: task.number ?? 0 })),
    text,
  );
}
