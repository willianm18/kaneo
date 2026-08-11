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
      });
      queryClient.invalidateQueries({ queryKey: ["active-timers"] });
    },
  });
}

export default useStopTimer;
