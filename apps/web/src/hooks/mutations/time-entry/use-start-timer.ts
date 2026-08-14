import { useMutation, useQueryClient } from "@tanstack/react-query";
import startTimer from "@/fetchers/time-entry/start-timer";

function useStartTimer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { taskId: string; description?: string }) =>
      startTimer(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["time-entries", variables.taskId],
      });
      queryClient.invalidateQueries({ queryKey: ["active-timers"] });
      queryClient.invalidateQueries({
        queryKey: ["task", variables.taskId],
        refetchType: "all",
      });
      // Board/list cards show tracked time and key off ["tasks", projectId],
      // but this hook only receives taskId. Rather than threading a new
      // projectId argument through every caller (TaskTimer, ActiveTimerRow,
      // TaskTotalPopover), invalidate the whole ["tasks"] prefix so every
      // project's board/list is covered regardless of which one is open.
      // `refetchType: "all"` matches the fix in
      // use-send-assistant-message.ts: refetchOnMount is disabled globally
      // (query-client/index.ts), so a plain invalidate would leave a screen
      // that isn't currently mounted showing the pre-timer value.
      queryClient.invalidateQueries({
        queryKey: ["tasks"],
        refetchType: "all",
      });
    },
  });
}

export default useStartTimer;
