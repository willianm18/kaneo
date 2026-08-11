import { useParams } from "@tanstack/react-router";
import { Maximize2, MessageCircle, Minimize2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import AssistantChat from "@/components/assistant/assistant-chat";
import { Button } from "@/components/ui/button";
import useGetConfig from "@/hooks/queries/config/use-get-config";
import { cn } from "@/lib/cn";

type AssistantMode = "bubble" | "panel";

const STORAGE_KEY = "kaneo:assistant-mode";

function readStoredMode(): AssistantMode {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "panel"
      ? "panel"
      : "bubble";
  } catch {
    return "bubble";
  }
}

function writeStoredMode(mode: AssistantMode) {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // localStorage can be unavailable (private browsing, etc.) — the mode
    // just won't survive a reload, which is not worth failing over.
  }
}

function AssistantLauncher() {
  const { t } = useTranslation();
  const { data: config } = useGetConfig();
  const { workspaceId, projectId } = useParams({ strict: false });

  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<AssistantMode>(readStoredMode);

  useEffect(() => {
    writeStoredMode(mode);
  }, [mode]);

  if (!config?.hasAssistant) {
    return null;
  }

  if (!isOpen) {
    return (
      <Button
        size="icon-lg"
        onClick={() => setIsOpen(true)}
        aria-label={t("assistant:open")}
        className="fixed right-4 bottom-4 z-40 rounded-full shadow-lg"
      >
        <MessageCircle className="size-5" />
      </Button>
    );
  }

  // A single wrapper element hosts `AssistantChat` for both modes: only its
  // className changes between "bubble" and "panel". Because it stays the
  // same element at the same position in the tree, React updates it in
  // place instead of unmounting/remounting `AssistantChat` — which would
  // wipe the conversation the user is in the middle of. Do not split this
  // into two branches that each render their own `AssistantChat`.
  return (
    <div
      className={cn(
        "fixed z-40 flex flex-col overflow-hidden border border-border bg-card shadow-xl",
        mode === "bubble"
          ? "right-4 bottom-4 h-[min(600px,calc(100vh-2rem))] w-[min(380px,calc(100vw-2rem))] rounded-xl"
          : "inset-y-0 right-0 w-full rounded-none border-y-0 border-r-0 sm:w-105 sm:border-l",
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-border border-b px-3 py-2">
        <MessageCircle
          className="size-4 text-muted-foreground"
          aria-hidden="true"
        />
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() =>
              setMode((prev) => (prev === "bubble" ? "panel" : "bubble"))
            }
            aria-label={t(
              mode === "bubble" ? "assistant:expand" : "assistant:collapse",
            )}
          >
            {mode === "bubble" ? (
              <Maximize2 className="size-4" />
            ) : (
              <Minimize2 className="size-4" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setIsOpen(false)}
            aria-label={t("assistant:close")}
          >
            <X className="size-4" />
          </Button>
        </div>
      </div>

      <AssistantChat
        workspaceId={workspaceId}
        projectId={projectId}
        className="min-h-0 flex-1"
      />
    </div>
  );
}

export default AssistantLauncher;
