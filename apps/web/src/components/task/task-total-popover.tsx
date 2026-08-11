import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import useUpdateTimeEntry from "@/hooks/mutations/time-entry/use-update-time-entry";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";

type TaskTotalPopoverProps = {
  taskId: string;
  timeEntryId: string | undefined;
  trackedSeconds: number;
  children: React.ReactNode;
};

/**
 * Lets the current user correct the accumulated total tracked on their own
 * time entry for this task, in hours + minutes. Mirrors
 * `task-estimate-popover.tsx` exactly. There is nothing to edit until the
 * user has started the timer at least once on this task (single entry per
 * task/user model) — without a `timeEntryId` this renders as a no-op, same
 * as the estimate popover when the user lacks permission.
 */
export default function TaskTotalPopover({
  taskId,
  timeEntryId,
  trackedSeconds,
  children,
}: TaskTotalPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const { mutateAsync: updateTimeEntry } = useUpdateTimeEntry(taskId);
  const { canManageTasks } = useWorkspacePermission();
  const canEdit = canManageTasks() && !!timeEntryId;

  useEffect(() => {
    if (!open) {
      return;
    }

    setHours(String(Math.floor(trackedSeconds / 3600)));
    setMinutes(String(Math.floor((trackedSeconds % 3600) / 60)));
  }, [open, trackedSeconds]);

  const save = async (durationSeconds: number) => {
    if (!timeEntryId) {
      return;
    }

    try {
      await updateTimeEntry({ id: timeEntryId, duration: durationSeconds });
      toast.success(t("tasks:timer.trackedUpdateSuccess"));
      setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:timer.trackedUpdateError"),
      );
    }
  };

  if (!canEdit) return <>{children}</>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64 space-y-3" align="start">
        <div className="flex gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="task-tracked-hours">
              {t("tasks:popover.estimate.hours")}
            </Label>
            <Input
              id="task-tracked-hours"
              type="number"
              min={0}
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
          </div>
          <div className="flex-1 space-y-1">
            <Label htmlFor="task-tracked-minutes">
              {t("tasks:popover.estimate.minutes")}
            </Label>
            <Input
              id="task-tracked-minutes"
              type="number"
              min={0}
              max={59}
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
            />
          </div>
        </div>

        <Button
          size="sm"
          className="w-full"
          onClick={() =>
            save(
              Math.max(0, Number(hours) || 0) * 3600 +
                Math.max(0, Number(minutes) || 0) * 60,
            )
          }
        >
          {t("tasks:popover.estimate.save")}
        </Button>
      </PopoverContent>
    </Popover>
  );
}
