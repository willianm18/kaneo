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
    },
  });
}

export default useStartTimer;
