import { X } from "lucide-react";
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
import { useUpdateTask } from "@/hooks/mutations/task/use-update-task";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";

type TaskEstimatePopoverProps = {
  task: Task;
  children: React.ReactNode;
};

export default function TaskEstimatePopover({
  task,
  children,
}: TaskEstimatePopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState("");
  const [minutes, setMinutes] = useState("");
  const { mutateAsync: updateTask } = useUpdateTask();
  const { canManageTasks } = useWorkspacePermission();
  const canEdit = canManageTasks();

  useEffect(() => {
    if (!open) {
      return;
    }

    if (task.estimatedSeconds) {
      setHours(String(Math.floor(task.estimatedSeconds / 3600)));
      setMinutes(String(Math.floor((task.estimatedSeconds % 3600) / 60)));
    } else {
      setHours("");
      setMinutes("");
    }
  }, [open, task.estimatedSeconds]);

  const save = async (estimatedSeconds: number | null) => {
    try {
      await updateTask({ ...task, estimatedSeconds });
      toast.success(t("tasks:popover.estimate.updateSuccess"));
      setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:popover.estimate.updateError"),
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
            <Label htmlFor="task-estimate-hours">
              {t("tasks:popover.estimate.hours")}
            </Label>
            <Input
              id="task-estimate-hours"
              type="number"
              min={0}
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
          </div>
          <div className="flex-1 space-y-1">
            <Label htmlFor="task-estimate-minutes">
              {t("tasks:popover.estimate.minutes")}
            </Label>
            <Input
              id="task-estimate-minutes"
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

        {task.estimatedSeconds !== null && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
            onClick={() => save(null)}
          >
            <X className="h-4 w-4" />
            {t("tasks:popover.estimate.clear")}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
