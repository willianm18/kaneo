/**
 * `HH:MM:SS`, zero-padded. Used only where a timer is actively ticking
 * (the live running counter) — the seconds place is the sole feedback
 * that the timer hasn't frozen, so it must stay visible there.
 */
export function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

/**
 * Compact duration for anywhere a timer is NOT actively ticking: a task's
 * tracked total once paused/stopped, board/list cards, etc. `2h 15m` when
 * an hour or more has been tracked, just `45m` under an hour. Under a
 * minute, rounding to minutes would collapse any tracked time (even 45s)
 * down to `0m`, which reads identically to nothing tracked at all — so
 * that range is shown in seconds instead. Exactly zero is `0m`, matching
 * the "no time tracked" state used elsewhere.
 */
export function formatDurationCompact(totalSeconds: number): string {
  if (totalSeconds <= 0) return "0m";

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${totalSeconds}s`;
}
