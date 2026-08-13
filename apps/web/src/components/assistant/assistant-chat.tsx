import { Link } from "@tanstack/react-router";
import { Mic, Square } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type sendAssistantMessage from "@/fetchers/assistant/send-message";
import type { AssistantMessage } from "@/fetchers/assistant/send-message";
import { AssistantRequestError } from "@/fetchers/assistant/send-message";
import transcribeAudio from "@/fetchers/assistant/transcribe";
import useSendAssistantMessage from "@/hooks/mutations/assistant/use-send-assistant-message";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import { cn } from "@/lib/cn";
import { toast } from "@/lib/toast";

type AssistantChatResponse = Awaited<ReturnType<typeof sendAssistantMessage>>;
type PendingConfirmation = NonNullable<
  AssistantChatResponse["pendingConfirmation"]
>;
type ConversationState = NonNullable<
  AssistantChatResponse["conversationState"]
>;
type ExecutedAction = AssistantChatResponse["actions"][number];

type DisplayMessage = AssistantMessage & {
  id: number;
  actions?: ExecutedAction[];
  isError?: boolean;
};

type AssistantChatProps = {
  workspaceId?: string;
  projectId?: string;
  className?: string;
};

// Best-effort extraction of a task id from a tool result summary, e.g.
// `{"id": "abc123", "title": ...}` (JSON.stringify of the task, truncated
// to 200 chars server-side). Not every tool result includes one.
function extractTaskId(summary: string): string | null {
  return /"id"\s*:\s*"([^"]+)"/.exec(summary)?.[1] ?? null;
}

// One generic "something went wrong" used to cover every failure, including
// a connection that simply dropped mid-stream after the work had already
// been applied — which invited the user to retry and duplicate it. Now we
// tell three cases apart: the assistant genuinely failing (already logged
// server-side), the connection dropping before anything ran (safe to
// retry), and the connection dropping after at least one tool had already
// started (must not invite a blind retry).
function failureMessageKey(error: unknown): string {
  if (error instanceof AssistantRequestError) {
    if (error.kind === "assistant") return "assistant:error";
    return error.partial
      ? "assistant:connectionErrorPartial"
      : "assistant:connectionError";
  }
  return "assistant:error";
}

function AssistantChat({
  workspaceId,
  projectId,
  className,
}: AssistantChatProps) {
  const { t } = useTranslation();
  const nextMessageId = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingConfirmation | null>(null);
  const [conversationState, setConversationState] =
    useState<ConversationState | null>(null);
  const [conversationSignature, setConversationSignature] = useState<
    string | null
  >(null);
  const [progressTool, setProgressTool] = useState<string | null>(null);

  const { mutateAsync, isPending } = useSendAssistantMessage();
  const { data: config } = useGetConfig();
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);

  const stopRecording = () => {
    recorderRef.current?.stop();
  };

  const startRecording = async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      toast.error(t("assistant:micDenied"));
      return;
    }

    const recorder = new MediaRecorder(stream);
    const chunks: Blob[] = [];
    recorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };

    recorder.onstop = async () => {
      for (const track of stream.getTracks()) track.stop();
      setIsRecording(false);
      recorderRef.current = null;

      if (chunks.length === 0) return;

      setIsTranscribing(true);
      try {
        const { text } = await transcribeAudio(
          new Blob(chunks, { type: recorder.mimeType }),
        );
        // O texto entra no campo para revisao: transcricao erra nomes de
        // maquina e siglas, e um chamado errado custa mais que um clique.
        setDraft((current) => (current ? `${current} ${text}` : text));
        textareaRef.current?.focus();
      } catch (error) {
        toast.error(
          error instanceof Error && error.message
            ? error.message
            : t("assistant:transcribeError"),
        );
      } finally {
        setIsTranscribing(false);
      }
    };

    recorder.start();
    setIsRecording(true);
  };

  const handleMicClick = () => {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      toast.error(t("assistant:micUnavailable"));
      return;
    }

    if (isRecording) {
      stopRecording();
      return;
    }

    void startRecording();
  };

  const appendMessage = (
    message: AssistantMessage & {
      actions?: ExecutedAction[];
      isError?: boolean;
    },
  ) => {
    const id = nextMessageId.current++;
    setMessages((prev) => [...prev, { ...message, id }]);
  };

  const clearPendingConfirmation = () => {
    setPending(null);
    setConversationState(null);
    setConversationSignature(null);
  };

  const applyResult = (result: AssistantChatResponse) => {
    if (
      result.pendingConfirmation &&
      result.conversationState &&
      result.conversationSignature
    ) {
      setPending(result.pendingConfirmation);
      setConversationState(result.conversationState);
      setConversationSignature(result.conversationSignature);
      return;
    }

    clearPendingConfirmation();
    appendMessage({
      role: "assistant",
      content: result.reply,
      actions: result.actions.length > 0 ? result.actions : undefined,
    });
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || isPending || pending) return;

    const history: AssistantMessage[] = [
      ...messages.map(({ role, content }) => ({ role, content })),
      { role: "user", content: text },
    ];
    appendMessage({ role: "user", content: text });
    setDraft("");
    setProgressTool(null);

    try {
      const result = await mutateAsync({
        messages: history,
        workspaceId,
        projectId,
        onProgress: setProgressTool,
      });
      applyResult(result);
    } catch (error) {
      appendMessage({
        role: "assistant",
        content: t(failureMessageKey(error)),
        isError: true,
      });
    } finally {
      setProgressTool(null);
    }
  };

  const handleConfirm = async () => {
    if (!pending || !conversationState || !conversationSignature) return;

    setProgressTool(null);
    try {
      const result = await mutateAsync({
        messages: messages.map(({ role, content }) => ({ role, content })),
        workspaceId,
        projectId,
        confirmations: [pending.toolCallId],
        resumeFrom: conversationState,
        conversationSignature,
        onProgress: setProgressTool,
      });
      applyResult(result);
    } catch (error) {
      clearPendingConfirmation();
      appendMessage({
        role: "assistant",
        content: t(failureMessageKey(error)),
        isError: true,
      });
    } finally {
      setProgressTool(null);
    }
  };

  const handleCancel = () => {
    clearPendingConfirmation();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col", className)}>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {messages.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {t("assistant:empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((message) => (
              <li
                key={message.id}
                className={cn(
                  "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                  message.role === "user"
                    ? "ml-auto bg-primary text-primary-foreground"
                    : "mr-auto bg-muted text-foreground",
                  message.isError && "bg-destructive/10 text-destructive",
                )}
              >
                <p className="whitespace-pre-wrap">{message.content}</p>
                {message.actions && message.actions.length > 0 && (
                  <div className="mt-2 border-border/50 border-t pt-2 text-xs">
                    <p className="font-medium">{t("assistant:actionsTitle")}</p>
                    <ul className="mt-1 flex flex-col gap-1">
                      {message.actions.map((action) => {
                        const taskId = extractTaskId(action.summary);
                        return (
                          <li
                            key={`${message.id}-${action.tool}-${action.summary}`}
                            className="flex items-center gap-1.5"
                          >
                            <span>{action.tool}</span>
                            {taskId && workspaceId && projectId && (
                              <Link
                                to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
                                params={{ workspaceId, projectId, taskId }}
                                className="text-primary underline underline-offset-2"
                              >
                                {t("assistant:viewTask")}
                              </Link>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {pending && (
          <div className="mt-3 rounded-lg border border-border bg-card p-3 text-sm">
            <p className="font-medium">{t("assistant:confirmTitle")}</p>
            <p className="mt-1 text-muted-foreground">{pending.description}</p>
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={handleCancel}>
                {t("assistant:cancel")}
              </Button>
              <Button size="sm" loading={isPending} onClick={handleConfirm}>
                {t("assistant:confirm")}
              </Button>
            </div>
          </div>
        )}

        {isPending && !pending && (
          <p className="mt-3 text-muted-foreground text-sm">
            {progressTool
              ? t("assistant:workingOn", { tool: progressTool })
              : t("assistant:thinking")}
          </p>
        )}
      </div>

      <div className="flex items-end gap-2 border-border border-t p-3">
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isTranscribing
              ? t("assistant:transcribing")
              : isRecording
                ? t("assistant:recording")
                : t("assistant:placeholder")
          }
          aria-label={t("assistant:placeholder")}
          disabled={isPending || !!pending}
        />
        {config?.hasVoiceInput && (
          <Button
            variant={isRecording ? "destructive" : "ghost"}
            size="icon"
            onClick={handleMicClick}
            disabled={isPending || !!pending || isTranscribing}
            aria-label={
              isRecording ? t("assistant:stopRecording") : t("assistant:record")
            }
            title={
              isRecording ? t("assistant:stopRecording") : t("assistant:record")
            }
          >
            {isRecording ? (
              <Square className="h-4 w-4" />
            ) : (
              <Mic className="h-4 w-4" />
            )}
          </Button>
        )}
        <Button
          onClick={() => void handleSend()}
          disabled={isPending || !!pending || !draft.trim()}
        >
          {t("assistant:send")}
        </Button>
      </div>
    </div>
  );
}

export default AssistantChat;
