import { Link } from "@tanstack/react-router";
import { Pause, Play, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDuration } from "@/components/task/task-timer";
import { Button } from "@/components/ui/button";
import usePauseTimer from "@/hooks/mutations/time-entry/use-pause-timer";
import useStartTimer from "@/hooks/mutations/time-entry/use-start-timer";
import useStopTimer from "@/hooks/mutations/time-entry/use-stop-timer";
import useActiveTimers from "@/hooks/queries/time-entry/use-active-timers";
import { useElapsedSeconds } from "@/hooks/use-elapsed-seconds";
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
  const { mutateAsync: startTimer, isPending: isStarting } = useStartTimer();
  const { mutateAsync: pauseTimer, isPending: isPausing } = usePauseTimer();
  const { mutateAsync: stopTimer, isPending: isStopping } = useStopTimer();

  const elapsed = useElapsedSeconds({
    duration: entry.duration,
    runningSince: entry.runningSince,
    clockSkewMs,
  });

  const isBusy = isStarting || isPausing || isStopping;

  const handleResume = async () => {
    try {
      await startTimer({ taskId: entry.taskId });
    } catch {
      toast.error(t("tasks:timer.startError"));
    }
  };

  const handlePause = async () => {
    try {
      await pauseTimer({ timeEntryId: entry.id, taskId: entry.taskId });
    } catch {
      toast.error(t("tasks:timer.pauseError"));
    }
  };

  const handleStop = async () => {
    try {
      await stopTimer({ timeEntryId: entry.id, taskId: entry.taskId });
    } catch {
      toast.error(t("tasks:timer.stopError"));
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Link
        to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
        params={{
          workspaceId: entry.workspaceId,
          projectId: entry.projectId,
          taskId: entry.taskId,
        }}
        className="max-w-40 truncate text-sm hover:underline"
      >
        {entry.taskTitle}
      </Link>

      <span className="font-mono text-sm tabular-nums">
        {formatDuration(elapsed)}
      </span>

      {entry.isRunning ? (
        <Button
          size="icon"
          variant="ghost"
          disabled={isBusy}
          aria-label={t("tasks:timer.pause")}
          onClick={handlePause}
        >
          <Pause className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          size="icon"
          variant="ghost"
          disabled={isBusy}
          aria-label={t("tasks:timer.resume")}
          onClick={handleResume}
        >
          <Play className="h-4 w-4" />
        </Button>
      )}

      <Button
        size="icon"
        variant="ghost"
        disabled={isBusy}
        aria-label={t("tasks:timer.stop")}
        onClick={handleStop}
      >
        <Square className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function ActiveTimersBar() {
  const { t } = useTranslation();
  const { data } = useActiveTimers();

  const entries = data?.entries ?? [];

  if (entries.length === 0) {
    return null;
  }

  const clockSkewMs = data?.serverTime
    ? new Date(data.serverTime).getTime() - Date.now()
    : 0;

  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-border bg-card px-3 py-1.5">
      <span className="text-xs text-muted-foreground">
        {t("tasks:timer.activeCount", { count: entries.length })}
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
