import { useEffect, useState } from "react";

export interface UseElapsedSecondsParams {
  duration: number | null;
  runningSince: string | null;
  clockSkewMs: number;
}

function compute({
  duration,
  runningSince,
  clockSkewMs,
}: UseElapsedSecondsParams) {
  const accumulated = duration ?? 0;

  if (!runningSince) {
    return accumulated;
  }

  const serverNow = Date.now() + clockSkewMs;
  const elapsed = Math.floor(
    (serverNow - new Date(runningSince).getTime()) / 1000,
  );

  return accumulated + Math.max(0, elapsed);
}

export function useElapsedSeconds({
  duration,
  runningSince,
  clockSkewMs,
}: UseElapsedSecondsParams) {
  const [seconds, setSeconds] = useState(() =>
    compute({ duration, runningSince, clockSkewMs }),
  );

  useEffect(() => {
    setSeconds(compute({ duration, runningSince, clockSkewMs }));

    if (!runningSince) {
      return;
    }

    const interval = setInterval(() => {
      setSeconds(compute({ duration, runningSince, clockSkewMs }));
    }, 1000);

    return () => clearInterval(interval);
  }, [duration, runningSince, clockSkewMs]);

  return seconds;
}
