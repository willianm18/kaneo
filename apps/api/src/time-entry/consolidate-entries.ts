/**
 * Kaneo's time-tracking model holds at most one time entry per (task, user)
 * pair, always accumulating. Any code path that finds more than one row for
 * that pair — a leftover from before this rule was enforced everywhere —
 * must converge onto a single survivor without ever dropping a stored
 * second.
 *
 * Given every entry currently stored for a (task, user) pair, ordered
 * most-recent-first by `startTime`, this picks the most recent as the
 * survivor (`target`) and reports the rest as `duplicates` to be deleted by
 * the caller. `mergedDuration` sums every entry's stored `duration` — it
 * never recomputes anything from timestamps — so folding duplicates into
 * `target` can only ever add up already-recorded time, never lose it.
 *
 * Shared by `startTimer` (consolidating on resume) and `createTimeEntry`
 * (consolidating a manually logged entry onto the existing one) so the
 * summing arithmetic lives in exactly one place.
 */
export type TimeEntryDurationRow = {
  id: string;
  duration: number | null;
};

export function consolidateTimeEntries<T extends TimeEntryDurationRow>(
  entries: T[],
): {
  target: T | undefined;
  duplicates: T[];
  mergedDuration: number;
} {
  const [target, ...duplicates] = entries;
  const mergedDuration = entries.reduce(
    (total, entry) => total + (entry.duration ?? 0),
    0,
  );

  return { target, duplicates, mergedDuration };
}

export default consolidateTimeEntries;
