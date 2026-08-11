import { useMutation, useQueryClient } from "@tanstack/react-query";
import pauseTimer from "@/fetchers/time-entry/pause-timer";

function usePauseTimer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ timeEntryId }: { timeEntryId: string; taskId: string }) =>
      pauseTimer(timeEntryId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["time-entries", variables.taskId],
      });
      queryClient.invalidateQueries({ queryKey: ["active-timers"] });
    },
  });
}

export default usePauseTimer;
