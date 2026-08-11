/**
 * Folds the in-flight stretch of a running time entry into its stored
 * `duration`. Shared by every path that closes an open entry (`stopTimer`,
 * `pauseTimer`, `closeOpenEntriesForTask`) so the accumulation arithmetic —
 * including the clamp against backwards clock jumps — lives in one place.
 */
export function accumulateDuration({
  duration,
  runningSince,
  now,
}: {
  duration: number | null;
  runningSince: Date | null;
  now: Date;
}): number {
  if (!runningSince) {
    return duration ?? 0;
  }

  const elapsed = Math.max(
    0,
    Math.floor((now.getTime() - runningSince.getTime()) / 1000),
  );

  return (duration ?? 0) + elapsed;
}

export default accumulateDuration;
