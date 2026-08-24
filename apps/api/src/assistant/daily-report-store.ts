import { and, asc, eq, ne } from "drizzle-orm";

import db from "../database";
import { columnTable, taskTable } from "../database/schema";

/**
 * Acha o card do dia pelo titulo exato, dentro do projeto.
 *
 * E o que garante um card por dia: o segundo relato do mesmo dia encontra o
 * card que ja existe e entra nele, em vez de abrir outro. Card arquivado fica
 * de fora — se o dia foi arquivado, o relato novo comeca um card limpo.
 */
export async function findTaskByTitle(
  projectId: string,
  title: string,
): Promise<{ id: string; number: number } | null> {
  const [task] = await db
    .select({ id: taskTable.id, number: taskTable.number })
    .from(taskTable)
    .where(
      and(
        eq(taskTable.projectId, projectId),
        eq(taskTable.title, title),
        ne(taskTable.status, "archived"),
      ),
    )
    .limit(1);

  return task ? { id: task.id, number: task.number ?? 0 } : null;
}

/**
 * Slug da primeira coluna do projeto — onde o card do dia nasce.
 *
 * Colunas sao configuraveis por projeto, entao chutar "to-do" quebra em quem
 * renomeou o board. Sem coluna nenhuma, "to-do" e o padrao do Kaneo e serve de
 * ultimo recurso.
 */
export async function findFirstColumnSlug(projectId: string): Promise<string> {
  const [column] = await db
    .select({ slug: columnTable.slug })
    .from(columnTable)
    .where(eq(columnTable.projectId, projectId))
    .orderBy(asc(columnTable.position))
    .limit(1);

  return column?.slug ?? "to-do";
}
