import { Link } from "@tanstack/react-router";
import { Pause } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import usePauseTimer from "@/hooks/mutations/time-entry/use-pause-timer";
import useActiveTimers from "@/hooks/queries/time-entry/use-active-timers";
import { useElapsedSeconds } from "@/hooks/use-elapsed-seconds";
import { formatDuration } from "@/lib/format-duration";
import { toast } from "@/lib/toast";

type ActiveTimerRowProps = {
  entry: {
    id: string;
    taskId: string;
    taskTitle: string;
    projectId: string;
    workspaceId: string;
    duration: number | null;
    runningSince: string | null;
    isRunning: boolean;
  };
  clockSkewMs: number;
};

function ActiveTimerRow({ entry, clockSkewMs }: ActiveTimerRowProps) {
  const { t } = useTranslation();
  const { mutateAsync: pauseTimer, isPending: isPausing } = usePauseTimer();

  const elapsed = useElapsedSeconds({
    duration: entry.duration,
    runningSince: entry.runningSince,
    clockSkewMs,
  });

  const handlePause = async () => {
    try {
      await pauseTimer({ timeEntryId: entry.id, taskId: entry.taskId });
    } catch {
      toast.error(t("tasks:timer.pauseError"));
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
        aria-hidden="true"
      />

      <Link
        to="/dashboard/workspace/$workspaceId/project/$projectId/board"
        params={{
          workspaceId: entry.workspaceId,
          projectId: entry.projectId,
        }}
        search={{ taskId: entry.taskId }}
        className="max-w-40 truncate text-sm hover:underline"
      >
        {entry.taskTitle}
      </Link>

      <span className="font-mono text-sm tabular-nums">
        {formatDuration(elapsed)}
      </span>

      <Button
        size="icon"
        variant="ghost"
        disabled={isPausing}
        aria-label={t("tasks:timer.pause")}
        onClick={handlePause}
      >
        <Pause className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function ActiveTimersBar() {
  const { t } = useTranslation();
  const { data } = useActiveTimers();

  // The API's /time-entry/active returns every open entry for the user
  // (running and paused alike — an entry is only excluded once it's
  // closed). The bar's purpose is narrower than that: show what is
  // counting right now. A paused entry loses nothing by leaving the bar —
  // the user resumes it from the task itself — so filter here rather than
  // changing the endpoint.
  const entries = (data?.entries ?? []).filter((entry) => entry.isRunning);

  if (entries.length === 0) {
    return null;
  }

  const clockSkewMs = data?.serverTime
    ? new Date(data.serverTime).getTime() - Date.now()
    : 0;

  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-border bg-card px-3 py-1.5">
      <span className="text-xs text-muted-foreground">
        {t("tasks:timer.runningCount", { count: entries.length })}
      </span>

      {entries.map((entry) => (
        <ActiveTimerRow
          key={entry.id}
          entry={entry}
          clockSkewMs={clockSkewMs}
        />
      ))}
    </div>
  );
}
