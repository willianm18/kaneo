import { Clock, Timer } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatEstimate } from "@/lib/format";
import { formatDuration } from "../task/task-timer";

type TaskTimeChipsProps = {
  trackedSeconds: number | null | undefined;
  estimatedSeconds: number | null | undefined;
  className?: string;
};

/**
 * Compact tracked-time / estimate chips shared by the kanban card and the
 * list row. Each chip renders only when its value is present and non-zero —
 * a task with neither must look exactly as it did before this feature.
 */
export function TaskTimeChips({
  trackedSeconds,
  estimatedSeconds,
  className = "",
}: TaskTimeChipsProps) {
  const { t } = useTranslation();

  if (!trackedSeconds && !estimatedSeconds) {
    return null;
  }

  return (
    <>
      {!!trackedSeconds && (
        <div
          className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-border/70 bg-muted/55 text-muted-foreground ${className}`}
          title={t("tasks:timer.tracked")}
        >
          <Timer className="w-3 h-3" />
          <span className="font-mono tabular-nums">
            {formatDuration(trackedSeconds)}
          </span>
        </div>
      )}

      {!!estimatedSeconds && (
        <div
          className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded border border-border/70 bg-muted/55 text-muted-foreground ${className}`}
          title={t("tasks:popover.estimate.label")}
        >
          <Clock className="w-3 h-3" />
          <span>{formatEstimate(estimatedSeconds)}</span>
        </div>
      )}
    </>
  );
}

export default TaskTimeChips;
