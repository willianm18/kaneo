import type { ChangeEvent, ClipboardEvent, KeyboardEvent } from "react";
import { useCallback, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";

import { Form, FormField } from "@/components/ui/form";
import { useUpdateTaskTitle } from "@/hooks/mutations/task/use-update-task-title";
import useGetTask from "@/hooks/queries/task/use-get-task";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import debounce from "@/lib/debounce";

type TaskTitleProps = {
  taskId: string;
};

export default function TaskTitle({ taskId }: TaskTitleProps) {
  const { t } = useTranslation();
  const { data: task } = useGetTask(taskId);
  const { mutateAsync: updateTaskTitle } = useUpdateTaskTitle();
  const { canManageTasks } = useWorkspacePermission();
  const canEdit = canManageTasks();
  const isInitializedRef = useRef(false);
  const taskRef = useRef(task);
  const updateTaskRef = useRef(updateTaskTitle);

  useEffect(() => {
    taskRef.current = task;
    updateTaskRef.current = updateTaskTitle;
  }, [task, updateTaskTitle]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: taskId is not needed here
  useEffect(() => {
    isInitializedRef.current = false;
  }, [taskId]);

  const form = useForm<{
    title: string;
  }>({
    values: {
      title: task?.title || "",
    },
  });

  useEffect(() => {
    if (task?.title !== undefined) isInitializedRef.current = true;
  }, [task?.title]);

  const debouncedUpdate = useCallback(
    debounce(async (title: string) => {
      if (!isInitializedRef.current) return;

      const currentTask = taskRef.current;
      const updateTaskFn = updateTaskRef.current;

      if (!currentTask || !updateTaskFn) return;

      try {
        await updateTaskFn({
          ...currentTask,
          title,
        });
      } catch (error) {
        console.error("Failed to update title:", error);
      }
    }, 800),
    [],
  );

  const handleTitleChange = useCallback(
    (value: string) => {
      if (!isInitializedRef.current) return;

      debouncedUpdate(value);
    },
    [debouncedUpdate],
  );

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const resizeTextarea = useCallback((element: HTMLTextAreaElement | null) => {
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: task?.title triggers resize when a different task loads
  useEffect(() => {
    resizeTextarea(textareaRef.current);
  }, [task?.title, resizeTextarea]);

  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="title"
        render={({ field }) => (
          <textarea
            {...field}
            ref={(element) => {
              field.ref(element);
              textareaRef.current = element;
            }}
            rows={1}
            placeholder={t("tasks:detail.titlePlaceholder")}
            readOnly={!canEdit}
            className="block h-auto w-full resize-none appearance-none overflow-hidden border-0 bg-transparent p-0 font-heading text-[2rem] leading-[1.15] font-semibold tracking-[-0.02em] text-foreground outline-none placeholder:text-foreground/45"
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => {
              field.onChange(e);
              resizeTextarea(e.target);
              handleTitleChange(e.target.value);
            }}
            onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            onPaste={(e: ClipboardEvent<HTMLTextAreaElement>) => {
              const text = e.clipboardData.getData("text");
              if (!text.includes("\n") && !text.includes("\r")) return;
              e.preventDefault();

              const sanitized = text.replace(/[\r\n]+/g, " ");
              const element = e.currentTarget;
              const start = element.selectionStart ?? element.value.length;
              const end = element.selectionEnd ?? element.value.length;
              const newValue =
                element.value.slice(0, start) +
                sanitized +
                element.value.slice(end);

              const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype,
                "value",
              )?.set;
              nativeInputValueSetter?.call(element, newValue);

              const cursor = start + sanitized.length;
              element.selectionStart = cursor;
              element.selectionEnd = cursor;

              const inputEvent = new Event("input", { bubbles: true });
              element.dispatchEvent(inputEvent);
            }}
          />
        )}
      />
    </Form>
  );
}
