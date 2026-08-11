import { Pause, Play, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/components/providers/auth-provider/hooks/use-auth";
import { Button } from "@/components/ui/button";
import usePauseTimer from "@/hooks/mutations/time-entry/use-pause-timer";
import useStartTimer from "@/hooks/mutations/time-entry/use-start-timer";
import useStopTimer from "@/hooks/mutations/time-entry/use-stop-timer";
import useActiveTimers from "@/hooks/queries/time-entry/use-active-timers";
import useGetTimeEntriesByTaskId from "@/hooks/queries/time-entry/use-get-time-entries";
import { useTaskTotalTrackedSeconds } from "@/hooks/use-task-total-tracked-seconds";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";
import TaskTotalPopover from "./task-total-popover";

export function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

type TaskTimerProps = {
  taskId: string;
  compact?: boolean;
};

export default function TaskTimer({ taskId, compact = false }: TaskTimerProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data } = useActiveTimers();
  const { data: timeEntries } = useGetTimeEntriesByTaskId(taskId);
  const { mutateAsync: startTimer, isPending: isStarting } = useStartTimer();
  const { mutateAsync: pauseTimer, isPending: isPausing } = usePauseTimer();
  const { mutateAsync: stopTimer, isPending: isStopping } = useStopTimer();
  const { canManageTasks } = useWorkspacePermission();

  const entry = data?.entries.find((item) => item.taskId === taskId);
  // The single-entry-per-(task,user) model means at most one item in
  // `timeEntries` belongs to the current user, whether it's open, paused, or
  // closed — `useActiveTimers` only covers the open case, so this is needed
  // to find the entry to edit even after the timer has been stopped.
  const myTimeEntryId = user?.id
    ? timeEntries?.find((item) => item.userId === user.id)?.id
    : undefined;
  const clockSkewMs = data?.serverTime
    ? new Date(data.serverTime).getTime() - Date.now()
    : 0;

  // The single duration shown to the user is the task's tracked total, not a
  // separate "current session" figure — with one time entry per task now,
  // those used to be the same number rendered twice. Sourced from the
  // task's entries query (not `useActiveTimers`) so it keeps showing the
  // real accumulated time after the entry has been stopped.
  const totalTracked = useTaskTotalTrackedSeconds(timeEntries, clockSkewMs);

  if (!canManageTasks()) return null;

  const isBusy = isStarting || isPausing || isStopping;

  const handleStart = async () => {
    try {
      await startTimer({ taskId });
    } catch {
      toast.error(t("tasks:timer.startError"));
    }
  };

  const handlePause = async () => {
    if (!entry) return;
    try {
      await pauseTimer({ timeEntryId: entry.id, taskId });
    } catch {
      toast.error(t("tasks:timer.pauseError"));
    }
  };

  const handleStop = async () => {
    if (!entry) return;
    try {
      await stopTimer({ timeEntryId: entry.id, taskId });
    } catch {
      toast.error(t("tasks:timer.stopError"));
    }
  };

  if (compact) {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          disabled={isBusy}
          onClick={entry?.isRunning ? handlePause : handleStart}
          className="justify-start h-7 px-1.5"
          aria-label={
            entry?.isRunning
              ? t("tasks:timer.pause")
              : entry
                ? t("tasks:timer.resume")
                : t("tasks:timer.start")
          }
        >
          {entry?.isRunning ? (
            <Pause className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <Play className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </Button>

        {entry && (
          <Button
            variant="ghost"
            size="sm"
            disabled={isBusy}
            onClick={handleStop}
            className="justify-start h-7 px-1.5"
            aria-label={t("tasks:timer.stop")}
          >
            <Square className="w-3.5 h-3.5 text-muted-foreground" />
          </Button>
        )}

        <TaskTotalPopover
          taskId={taskId}
          timeEntryId={myTimeEntryId}
          trackedSeconds={totalTracked}
        >
          <button
            type="button"
            className="text-xs font-semibold font-mono tabular-nums text-muted-foreground px-1 cursor-pointer"
            aria-label={t("tasks:timer.tracked")}
          >
            {formatDuration(totalTracked)}
          </button>
        </TaskTotalPopover>
      </>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {entry?.isRunning ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={isBusy}
          onClick={handlePause}
        >
          <Pause className="h-4 w-4" />
          {t("tasks:timer.pause")}
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          disabled={isBusy}
          onClick={handleStart}
        >
          <Play className="h-4 w-4" />
          {entry ? t("tasks:timer.resume") : t("tasks:timer.start")}
        </Button>
      )}

      {entry && (
        <Button
          size="sm"
          variant="ghost"
          disabled={isBusy}
          onClick={handleStop}
        >
          <Square className="h-4 w-4" />
          {t("tasks:timer.stop")}
        </Button>
      )}

      <TaskTotalPopover
        taskId={taskId}
        timeEntryId={myTimeEntryId}
        trackedSeconds={totalTracked}
      >
        <button
          type="button"
          className="font-mono text-sm tabular-nums cursor-pointer"
          aria-label={t("tasks:timer.tracked")}
        >
          {formatDuration(totalTracked)}
        </button>
      </TaskTotalPopover>
    </div>
  );
}
