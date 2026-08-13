import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SendAssistantMessageRequest } from "@/fetchers/assistant/send-message";
import sendAssistantMessage from "@/fetchers/assistant/send-message";

export type SendAssistantMessageVariables = SendAssistantMessageRequest & {
  onProgress?: (toolName: string) => void;
};

function useSendAssistantMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ onProgress, ...payload }: SendAssistantMessageVariables) =>
      sendAssistantMessage(payload, onProgress),
    onSuccess: (data) => {
      // The assistant can call any of its tools (currently 42, and growing)
      // touching tasks, projects, labels, comments, time entries, relations,
      // and more. Enumerating every query key a tool might affect is a
      // losing game: the next tool added would read/write a cache slice we
      // forgot to invalidate here and silently reintroduce a stale-UI bug
      // (this is exactly how the original bug happened — invalidating only
      // ["tasks"] and ["projects"] left ["time-entries", taskId],
      // ["active-timers"], and ["task", id] stale after the assistant logged
      // time). So instead of naming query keys, we key off whether the
      // assistant actually did anything: `actions` lists every tool call it
      // executed. Non-empty means something in the backend changed and the
      // whole cache might be stale, so we invalidate everything with no
      // filter. Empty means the turn was a pure question/answer with no
      // mutation, so we invalidate nothing to avoid a refetch storm on every
      // chat message. Do not "optimize" this back into a narrow list of
      // query keys — that is the bug this fixes.
      // `refetchType: "all"` is required, not decorative: this app sets
      // `refetchOnMount: false` globally (see query-client/index.ts), so a
      // plain invalidate only marks caches stale and a screen that was closed
      // during the assistant's turn serves the stale cache when reopened
      // instead of refetching. That is exactly how a comment the assistant
      // had really created stayed invisible until a full page reload.
      if ((data.actions ?? []).length > 0) {
        queryClient.invalidateQueries({ refetchType: "all" });
      }
    },
  });
}

export default useSendAssistantMessage;
