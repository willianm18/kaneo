import { and, eq } from "drizzle-orm";

import db from "../database";
import { taskTable } from "../database/schema";

/**
 * O numero do chamado passado no lugar do id.
 *
 * O que a pessoa ve na tela e o numero ("#29", "MC-29"), e e assim que ela
 * fala. O modelo repete isso nas chamadas de ferramenta, mas a API espera o
 * id (cuid2). O resultado era `/api/comment/29: Workspace ID could not be
 * determined` — a tarefa nao era encontrada, o middleware nao descobria o
 * workspace, e o assistente repassava esse erro enigmatico para quem estava
 * falando, gastando um passo do turno a cada tentativa.
 *
 * Em vez de exigir que o modelo acerte, o numero e traduzido para o id antes
 * de executar a ferramenta.
 */
export function parseTaskNumberReference(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  // "29" ou "#29"
  const plain = trimmed.match(/^#?(\d+)$/);
  if (plain?.[1]) {
    return Number(plain[1]);
  }

  // "MC-29", "man-3": o prefixo e o slug do projeto.
  const slugged = trimmed.match(/^[a-zA-Z]{1,10}-(\d+)$/);
  if (slugged?.[1]) {
    return Number(slugged[1]);
  }

  // Qualquer outra coisa e um id de verdade (cuid2 mistura letras e digitos
  // sem separador) e nao deve ser tocada.
  return null;
}

/**
 * Acha o id real da tarefa a partir do numero dela dentro do projeto.
 * Devolve null quando nao existe — nesse caso a ferramenta segue com o valor
 * original e o erro que voltar sera sobre a tarefa, nao sobre o workspace.
 */
export async function resolveTaskIdByNumber(
  projectId: string,
  number: number,
): Promise<string | null> {
  const [task] = await db
    .select({ id: taskTable.id })
    .from(taskTable)
    .where(
      and(eq(taskTable.projectId, projectId), eq(taskTable.number, number)),
    )
    .limit(1);

  return task?.id ?? null;
}
