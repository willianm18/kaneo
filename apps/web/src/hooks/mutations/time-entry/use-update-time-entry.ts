import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateTimeEntry, {
  type UpdateTimeEntryRequest,
} from "@/fetchers/time-entry/update-time-entry";

function useUpdateTimeEntry(taskId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateTimeEntryRequest) => updateTimeEntry(data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["time-entries", taskId],
      });
      // Editing an entry's duration can change whether it counts as the
      // user's open/running entry for this task, which the active-timers
      // bar reads.
      queryClient.invalidateQueries({ queryKey: ["active-timers"] });
      queryClient.invalidateQueries({
        queryKey: ["task", taskId],
        refetchType: "all",
      });
      // Board/list cards show tracked time and key off ["tasks", projectId],
      // but this hook only receives taskId. Rather than threading a new
      // projectId argument through every caller, invalidate the whole
      // ["tasks"] prefix so every project's board/list is covered.
      // `refetchType: "all"` matches the fix in
      // use-send-assistant-message.ts: refetchOnMount is disabled globally
      // (query-client/index.ts), so a plain invalidate would leave a screen
      // that isn't currently mounted showing the pre-edit value.
      queryClient.invalidateQueries({
        queryKey: ["tasks"],
        refetchType: "all",
      });
    },
  });
}

export default useUpdateTimeEntry;
