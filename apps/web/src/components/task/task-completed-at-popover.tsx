import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useUpdateTaskCompletedAt } from "@/hooks/mutations/task/use-update-task-completed-at";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";

type TaskCompletedAtPopoverProps = {
  task: Task;
  children: React.ReactNode;
};

export default function TaskCompletedAtPopover({
  task,
  children,
}: TaskCompletedAtPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { mutateAsync: updateTaskCompletedAt } = useUpdateTaskCompletedAt();
  const { canManageTasks } = useWorkspacePermission();
  const canEdit = canManageTasks();

  const handleDateChange = async (date: Date | undefined) => {
    try {
      await updateTaskCompletedAt({
        ...task,
        completedAt: date?.toISOString() || null,
      });
      toast.success(t("tasks:popover.completedAt.updateSuccess"));
      setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:popover.completedAt.updateError"),
      );
    }
  };

  if (!canEdit) return <>{children}</>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="p-0" align="start">
        <Calendar
          mode="single"
          selected={task.completedAt ? new Date(task.completedAt) : undefined}
          onSelect={handleDateChange}
          disabled={{ after: new Date() }}
          className="w-full bg-popover"
        />
        {task.completedAt && (
          <div className="pt-2 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
              onClick={() => handleDateChange(undefined)}
            >
              <X className="h-4 w-4" />
              {t("tasks:popover.completedAt.clear")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
