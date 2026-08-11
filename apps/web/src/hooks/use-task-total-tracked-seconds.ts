import { useEffect, useState } from "react";

export type TrackedTimeEntry = {
  duration: number | null;
  runningSince: string | Date | null | undefined;
};

const EMPTY_ENTRIES: TrackedTimeEntry[] = [];

/**
 * Sums every time entry tracked for a task — closed entries plus, when one
 * is still running, the in-flight stretch since `runningSince` (server-clock
 * corrected via `clockSkewMs`, same as `useElapsedSeconds`). Only the
 * running portion ticks; everything else is a static sum.
 */
export function computeTaskTotalTrackedSeconds(
  entries: TrackedTimeEntry[],
  clockSkewMs: number,
) {
  const serverNow = Date.now() + clockSkewMs;

  return entries.reduce((total, entry) => {
    const accumulated = entry.duration ?? 0;

    if (!entry.runningSince) {
      return total + accumulated;
    }

    const elapsed = Math.floor(
      (serverNow - new Date(entry.runningSince).getTime()) / 1000,
    );

    return total + accumulated + Math.max(0, elapsed);
  }, 0);
}

export function useTaskTotalTrackedSeconds(
  entries: TrackedTimeEntry[] | undefined,
  clockSkewMs: number,
) {
  const list = entries ?? EMPTY_ENTRIES;
  const hasRunning = list.some((entry) => !!entry.runningSince);

  const [seconds, setSeconds] = useState(() =>
    computeTaskTotalTrackedSeconds(list, clockSkewMs),
  );

  useEffect(() => {
    setSeconds(computeTaskTotalTrackedSeconds(list, clockSkewMs));

    if (!hasRunning) {
      return;
    }

    const interval = setInterval(() => {
      setSeconds(computeTaskTotalTrackedSeconds(list, clockSkewMs));
    }, 1000);

    return () => clearInterval(interval);
  }, [list, clockSkewMs, hasRunning]);

  return seconds;
}

export default useTaskTotalTrackedSeconds;
