import { useMutation, useQueryClient } from "@tanstack/react-query";
import stopTimer from "@/fetchers/time-entry/stop-timer";

function useStopTimer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ timeEntryId }: { timeEntryId: string; taskId: string }) =>
      stopTimer(timeEntryId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["time-entries", variables.taskId],
        refetchType: "all",
      });
      queryClient.invalidateQueries({
        queryKey: ["active-timers"],
        refetchType: "all",
      });
      queryClient.invalidateQueries({
        queryKey: ["task", variables.taskId],
        refetchType: "all",
      });
      // Board/list cards show tracked time and key off ["tasks", projectId],
      // but this hook only receives taskId. Rather than threading a new
      // projectId argument through every caller, invalidate the whole
      // ["tasks"] prefix so every project's board/list is covered.
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

export default useStopTimer;
