import { desc, eq } from "drizzle-orm";

import db from "../database";
import { taskTable } from "../database/schema";
import { extractKeywords } from "./similar-tasks";

/**
 * Vocabulario para a transcricao de voz.
 *
 * Modelos de audio erram justamente as palavras que nunca viram: nomes
 * proprios e jargao. "Kaneo" volta como "canel", "compressor" como
 * "compresor". Duas camadas atacam isso:
 *
 * 1. `buildTranscriptionPrompt` monta a dica de contexto que vai junto do
 *    audio. O Whisper usa esse texto como continuacao provavel da fala, entao
 *    escrever os termos ali torna a grafia certa mais provavel.
 * 2. `correctKnownTerms` conserta o que passou, comparando palavra a palavra
 *    com o vocabulario conhecido. E deterministica e roda depois, sobre o
 *    texto ja transcrito.
 */

/**
 * Termos que valem para qualquer projeto. O nome do produto e o caso obvio:
 * nenhum modelo de audio foi treinado com ele.
 */
const ALWAYS_KNOWN = ["Kaneo"];

/**
 * O Whisper so considera o inicio do prompt (cerca de 224 tokens). Passar mais
 * do que isso nao ajuda e ainda arrisca empurrar para fora justamente os
 * termos mais importantes, que vem primeiro.
 */
const MAX_PROMPT_CHARS = 700;

export function buildTranscriptionPrompt(projectTerms: string[]): string {
  const terms: string[] = [];
  const seen = new Set<string>();

  for (const term of [...ALWAYS_KNOWN, ...projectTerms]) {
    const trimmed = term.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) {
      continue;
    }
    seen.add(key);
    terms.push(trimmed);
  }

  // Frase, e nao lista solta: o prompt do Whisper e tratado como fala anterior,
  // entao um texto natural funciona melhor do que palavras enfileiradas.
  const prefix = "Termos usados nesta conversa: ";
  let prompt = prefix;

  for (const term of terms) {
    const next = prompt === prefix ? term : `, ${term}`;
    if (prompt.length + next.length + 1 > MAX_PROMPT_CHARS) {
      break;
    }
    prompt += next;
  }

  return `${prompt}.`;
}

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/**
 * Distancia de edicao com corte: para assim que passa de `max`, porque acima
 * disso a resposta ja nao interessa e o trabalho seria jogado fora.
 */
function editDistanceWithin(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) {
    return max + 1;
  }

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;

    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
      current.push(value);
      best = Math.min(best, value);
    }

    if (best > max) {
      return max + 1;
    }
    previous = current;
  }

  return previous[b.length] ?? max + 1;
}

/**
 * Quanto menor a palavra, menos erro se pode tolerar: em quatro letras, duas
 * trocas ja formam outra palavra. Por isso o limite cresce com o tamanho, e
 * palavras muito curtas nao sao corrigidas.
 */
function allowedDistance(word: string): number {
  if (word.length <= 4) {
    return 0;
  }
  // Duas trocas cobrem o erro tipico de ouvido ("canel" por "Kaneo": c/k e
  // l/o) sem alcancar palavras reais parecidas — "canal" fica a tres trocas
  // de "Kaneo" e por isso nao e mexido.
  return 2;
}

/**
 * Troca palavras que sao quase um termo conhecido pelo termo certo.
 *
 * Conservador de proposito: palavra curta nao e tocada, e o limite de
 * diferenca cresce com o tamanho. "canel" vira "Kaneo", mas "canal" — que e
 * uma palavra real e comum — nao, porque a distancia ate "Kaneo" e maior do
 * que o permitido para cinco letras.
 */
export function correctKnownTerms(text: string, terms: string[]): string {
  const vocabulary = [...ALWAYS_KNOWN, ...terms]
    .map((term) => term.trim())
    .filter(Boolean);

  if (vocabulary.length === 0) {
    return text;
  }

  return text.replace(/[\p{L}\p{N}]+/gu, (word) => {
    const normalizedWord = normalize(word);

    for (const term of vocabulary) {
      const normalizedTerm = normalize(term);

      if (normalizedWord === normalizedTerm) {
        return word;
      }

      const max = allowedDistance(normalizedTerm);
      if (max === 0) {
        continue;
      }

      if (editDistanceWithin(normalizedWord, normalizedTerm, max) <= max) {
        // O termo entra com a grafia oficial (ex.: "Kaneo"), que e o ponto.
        return term;
      }
    }

    return word;
  });
}

const MAX_TERMS = 40;

/**
 * Extrai o vocabulario do proprio projeto a partir dos titulos das tarefas.
 *
 * Quem fala usa as palavras que ja estao no board — "compressor", "prensa",
 * "vedacao". Ordenar por frequencia coloca primeiro o que mais aparece, que e
 * o que tem mais chance de ser dito de novo (e o prompt do Whisper so
 * considera o comeco).
 *
 * Numeros sozinhos ficam de fora: "2" nao ajuda a grafia de nada, e o modelo
 * de audio ja acerta digito.
 */
export function collectVocabularyTerms(taskTitles: string[]): string[] {
  const frequency = new Map<string, number>();

  for (const title of taskTitles) {
    for (const word of extractKeywords(title)) {
      if (/^\d+$/.test(word)) {
        continue;
      }
      frequency.set(word, (frequency.get(word) ?? 0) + 1);
    }
  }

  return [...frequency.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, MAX_TERMS)
    .map(([word]) => word);
}

/**
 * Titulos das tarefas do projeto, usados como fonte do vocabulario. As mais
 * recentes primeiro: o que se fala hoje tende a estar no que foi criado
 * ultimamente.
 */
export async function getProjectTaskTitles(
  projectId: string,
): Promise<string[]> {
  const rows = await db
    .select({ title: taskTable.title })
    .from(taskTable)
    .where(eq(taskTable.projectId, projectId))
    .orderBy(desc(taskTable.createdAt))
    .limit(200);

  return rows.map((row) => row.title);
}
