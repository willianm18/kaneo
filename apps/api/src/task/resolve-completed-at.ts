import { and, eq } from "drizzle-orm";
import db from "../database";
import { columnTable } from "../database/schema";

type ColumnFinality = { slug: string; isFinal: boolean } | null | undefined;

/**
 * Whether `status` counts as a "final" (done-equivalent) status, based on the
 * project's own column configuration rather than a hardcoded slug. Columns are
 * user-defined and renameable, so completion must come from the column's
 * `isFinal` flag. Falls back to the legacy `status === "done"` check only when
 * no column matches — e.g. virtual statuses ("planned", "archived") that have
 * no row in the column table.
 */
export function isColumnFinal(status: string, column: ColumnFinality): boolean {
  return column?.isFinal ?? status === "done";
}

/**
 * Looks up the column for `status` within `projectId` and resolves whether it
 * is final. Use this when the caller does not already have the column at hand
 * (e.g. resolving the *previous* status, which update flows don't otherwise
 * fetch).
 */
export async function lookupIsColumnFinal(
  projectId: string,
  status: string,
): Promise<boolean> {
  const column = await db.query.columnTable.findFirst({
    where: and(
      eq(columnTable.projectId, projectId),
      eq(columnTable.slug, status),
    ),
  });

  return isColumnFinal(status, column);
}

export type ResolveCompletedAtInput = {
  wasFinal: boolean;
  isFinal: boolean;
  existingCompletedAt: Date | null;
};

/**
 * Pure decision of what `completedAt` should become for a single status
 * transition, given whether the previous and next statuses are "final":
 * - Entering a final status stamps `now()` — but only if nothing is set yet,
 *   so re-saving a task that is already done (e.g. legacy rows migrated with
 *   `completed_at = NULL`) never gets re-stamped.
 * - Leaving a final status clears it.
 * - Anything else (including staying in the same final/non-final state)
 *   preserves whatever is already there.
 *
 * Callers that accept an explicit `completedAt` from the request payload
 * (currently only `update-task`) should short-circuit before calling this —
 * an explicit value always wins and isn't this function's concern.
 */
export function resolveCompletedAt({
  wasFinal,
  isFinal,
  existingCompletedAt,
}: ResolveCompletedAtInput): Date | null {
  if (isFinal && !wasFinal) {
    return existingCompletedAt ?? new Date();
  }

  if (!isFinal && wasFinal) {
    return null;
  }

  return existingCompletedAt ?? null;
}
