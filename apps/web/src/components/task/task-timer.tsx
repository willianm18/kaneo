import { Pause, Play, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import usePauseTimer from "@/hooks/mutations/time-entry/use-pause-timer";
import useStartTimer from "@/hooks/mutations/time-entry/use-start-timer";
import useStopTimer from "@/hooks/mutations/time-entry/use-stop-timer";
import useActiveTimers from "@/hooks/queries/time-entry/use-active-timers";
import { useElapsedSeconds } from "@/hooks/use-elapsed-seconds";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";

export function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

export default function TaskTimer({ taskId }: { taskId: string }) {
  const { t } = useTranslation();
  const { data } = useActiveTimers();
  const { mutateAsync: startTimer, isPending: isStarting } = useStartTimer();
  const { mutateAsync: pauseTimer, isPending: isPausing } = usePauseTimer();
  const { mutateAsync: stopTimer, isPending: isStopping } = useStopTimer();
  const { canManageTasks } = useWorkspacePermission();

  const entry = data?.entries.find((item) => item.taskId === taskId);
  const clockSkewMs = data?.serverTime
    ? new Date(data.serverTime).getTime() - Date.now()
    : 0;

  const elapsed = useElapsedSeconds({
    duration: entry?.duration ?? 0,
    runningSince: entry?.runningSince ?? null,
    clockSkewMs,
  });

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

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-sm tabular-nums">
        {formatDuration(elapsed)}
      </span>

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
    </div>
  );
}
