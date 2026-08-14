import { useMutation, useQueryClient } from "@tanstack/react-query";
import createTimeEntry, {
  type CreateTimeEntryRequest,
} from "@/fetchers/time-entry/create-time-entry";

function useCreateTimeEntry() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateTimeEntryRequest) => createTimeEntry(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["time-entries", variables.taskId],
        refetchType: "all",
      });
      // Creating an entry (e.g. via the assistant or a manual log) can
      // introduce a new open entry, which changes what the active-timers
      // bar shows.
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
      // that isn't currently mounted showing the pre-entry value.
      queryClient.invalidateQueries({
        queryKey: ["tasks"],
        refetchType: "all",
      });
    },
  });
}

export default useCreateTimeEntry;
