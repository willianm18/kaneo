import { useMutation, useQueryClient } from "@tanstack/react-query";
import sendAssistantMessage from "@/fetchers/assistant/send-message";

function useSendAssistantMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: sendAssistantMessage,
    onSuccess: () => {
      // The assistant creates and edits tasks through its own tool calls;
      // without this the board behind the chat would show stale data.
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export default useSendAssistantMessage;
