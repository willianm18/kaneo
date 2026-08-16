import type sendAssistantMessage from "@/fetchers/assistant/send-message";
import type { AssistantMessage } from "@/fetchers/assistant/send-message";

type AssistantChatResponse = Awaited<ReturnType<typeof sendAssistantMessage>>;
type ExecutedAction = AssistantChatResponse["actions"][number];

// The settled message shape the chat renders. Kept in sync with the
// `DisplayMessage` type in assistant-chat.tsx — only fields that describe a
// finished message are persisted (never a pending confirmation or in-flight
// state, which would be confusing to restore).
export type StoredMessage = AssistantMessage & {
  id: number;
  actions?: ExecutedAction[];
  isError?: boolean;
};

// Cap the persisted history so localStorage cannot grow unbounded across long
// sessions. We keep the most recent messages.
export const MAX_STORED_MESSAGES = 50;

const KEY_PREFIX = "kaneo:assistant-conversation";

// Key the conversation by its context so each project restores its own
// history instead of a global mix. Falls back to a stable global key when
// there is no project context (e.g. the assistant opened outside a project).
export function conversationStorageKey(
  workspaceId?: string,
  projectId?: string,
): string {
  if (workspaceId && projectId) {
    return `${KEY_PREFIX}:${workspaceId}:${projectId}`;
  }
  return `${KEY_PREFIX}:global`;
}

function isStoredMessage(value: unknown): value is StoredMessage {
  if (!value || typeof value !== "object") {
    return false;
  }
  const message = value as Record<string, unknown>;
  return (
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    typeof message.id === "number"
  );
}

export function loadConversation(key: string): StoredMessage[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isStoredMessage).slice(-MAX_STORED_MESSAGES);
  } catch {
    return [];
  }
}

export function saveConversation(key: string, messages: StoredMessage[]): void {
  try {
    if (messages.length === 0) {
      window.localStorage.removeItem(key);
      return;
    }
    window.localStorage.setItem(
      key,
      JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)),
    );
  } catch {
    // localStorage can be unavailable (private browsing, quota) — the
    // conversation just won't survive a reload, which is not worth failing
    // over.
  }
}
