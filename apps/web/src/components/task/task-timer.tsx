import { Pause, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/components/providers/auth-provider/hooks/use-auth";
import { Button } from "@/components/ui/button";
import usePauseTimer from "@/hooks/mutations/time-entry/use-pause-timer";
import useStartTimer from "@/hooks/mutations/time-entry/use-start-timer";
import useGetTimeEntriesByTaskId from "@/hooks/queries/time-entry/use-get-time-entries";
import { useTaskTotalTrackedSeconds } from "@/hooks/use-task-total-tracked-seconds";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { formatDuration, formatDurationCompact } from "@/lib/format-duration";
import { toast } from "@/lib/toast";
import TaskTotalPopover from "./task-total-popover";

export { formatDuration };

type TaskTimerProps = {
  taskId: string;
  compact?: boolean;
};

export default function TaskTimer({ taskId, compact = false }: TaskTimerProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data: timeEntries } = useGetTimeEntriesByTaskId(taskId);
  const { mutateAsync: startTimer, isPending: isStarting } = useStartTimer();
  const { mutateAsync: pauseTimer, isPending: isPausing } = usePauseTimer();
  const { canManageTasks } = useWorkspacePermission();

  // The single-entry-per-(task,user) model means at most one item in
  // `timeEntries` belongs to the current user — open (no `endTime`, either
  // running or paused) or closed. This is the one and only source for the
  // counter, the total, and the toggle's state, so they can't drift apart
  // the way the counter (from `useActiveTimers`) and the total (from this
  // same query) used to.
  const myEntry = user?.id
    ? timeEntries?.find((item) => item.userId === user.id)
    : undefined;
  const isOpen = !!myEntry && myEntry.endTime === null;
  const isRunning = isOpen && !!myEntry?.runningSince;

  const totalTracked = useTaskTotalTrackedSeconds(timeEntries, 0);

  if (!canManageTasks()) return null;

  const isBusy = isStarting || isPausing;

  const handleToggle = async () => {
    try {
      if (isRunning && myEntry) {
        await pauseTimer({ timeEntryId: myEntry.id, taskId });
      } else {
        await startTimer({ taskId });
      }
    } catch {
      toast.error(
        t(isRunning ? "tasks:timer.pauseError" : "tasks:timer.startError"),
      );
    }
  };

  const toggleLabel = isRunning
    ? t("tasks:timer.pause")
    : isOpen
      ? t("tasks:timer.resume")
      : t("tasks:timer.start");

  if (compact) {
    return (
      <>
        <Button
          variant="ghost"
          size="sm"
          disabled={isBusy}
          onClick={handleToggle}
          className="justify-start h-7 px-1.5"
          aria-label={toggleLabel}
        >
          {isRunning ? (
            <Pause className="w-3.5 h-3.5 text-muted-foreground" />
          ) : (
            <Play className="w-3.5 h-3.5 text-muted-foreground" />
          )}
        </Button>

        <TaskTotalPopover
          taskId={taskId}
          timeEntryId={myEntry?.id}
          trackedSeconds={totalTracked}
        >
          <button
            type="button"
            className="text-xs font-semibold font-mono tabular-nums text-muted-foreground px-1 cursor-pointer"
            aria-label={t("tasks:timer.tracked")}
          >
            {isRunning
              ? formatDuration(totalTracked)
              : formatDurationCompact(totalTracked)}
          </button>
        </TaskTotalPopover>
      </>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        disabled={isBusy}
        onClick={handleToggle}
      >
        {isRunning ? (
          <Pause className="h-4 w-4" />
        ) : (
          <Play className="h-4 w-4" />
        )}
        {toggleLabel}
      </Button>

      <TaskTotalPopover
        taskId={taskId}
        timeEntryId={myEntry?.id}
        trackedSeconds={totalTracked}
      >
        <button
          type="button"
          className="font-mono text-sm tabular-nums cursor-pointer"
          aria-label={t("tasks:timer.tracked")}
        >
          {isRunning
            ? formatDuration(totalTracked)
            : formatDurationCompact(totalTracked)}
        </button>
      </TaskTotalPopover>
    </div>
  );
}
