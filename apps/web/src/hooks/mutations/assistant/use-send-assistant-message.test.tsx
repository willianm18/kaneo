import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SendAssistantMessageResponse } from "@/fetchers/assistant/send-message";
import sendAssistantMessage from "@/fetchers/assistant/send-message";
import useSendAssistantMessage from "./use-send-assistant-message";

const mockInvalidateQueries = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
  useMutation: (options: {
    mutationFn: (variables: unknown) => Promise<unknown>;
    onSuccess?: (data: unknown) => void;
  }) => ({
    mutateAsync: async (variables: unknown) => {
      const data = await options.mutationFn(variables);
      await options.onSuccess?.(data);
      return data;
    },
    isPending: false,
  }),
}));

vi.mock("@/fetchers/assistant/send-message", () => ({
  default: vi.fn(),
}));

describe("useSendAssistantMessage", () => {
  beforeEach(() => {
    mockInvalidateQueries.mockClear();
    vi.mocked(sendAssistantMessage).mockReset();
  });

  it("invalidates the entire cache when the response carries executed actions", async () => {
    vi.mocked(sendAssistantMessage).mockResolvedValue({
      reply: "Marquei 2h de estimativa e registrei 1h no tempo.",
      actions: [
        { tool: "update_task", summary: '{"estimatedSeconds":7200}' },
        { tool: "create_time_entry", summary: '{"duration":3600}' },
      ],
    });

    const { result } = renderHook(() => useSendAssistantMessage());

    await result.current.mutateAsync({ messages: [] });

    // No query-key filter: the assistant can call any of its tools, which
    // touch tasks, projects, labels, comments, time entries, relations, and
    // more, so a targeted list of keys would inevitably miss one (this is
    // the original bug). A non-empty `actions` means the backend changed
    // something, so the whole cache is invalidated unconditionally.
    expect(mockInvalidateQueries).toHaveBeenCalledTimes(1);
    expect(mockInvalidateQueries).toHaveBeenCalledWith();
  });

  it("invalidates nothing when the response has no executed actions", async () => {
    vi.mocked(sendAssistantMessage).mockResolvedValue({
      reply: "Voce tem 3 tarefas em andamento.",
      actions: [],
    });

    const { result } = renderHook(() => useSendAssistantMessage());

    await result.current.mutateAsync({ messages: [] });

    // A pure question never mutated anything, so refetching every query on
    // every chat turn would just be a refetch storm with no upside.
    expect(mockInvalidateQueries).not.toHaveBeenCalled();
  });

  it("treats a missing actions field the same as an empty array", async () => {
    // Simulates a response shape where `actions` was omitted entirely
    // rather than sent as [], to prove the hook doesn't assume the field is
    // always present.
    vi.mocked(sendAssistantMessage).mockResolvedValue({
      reply: "Ola!",
    } as unknown as SendAssistantMessageResponse);

    const { result } = renderHook(() => useSendAssistantMessage());

    await result.current.mutateAsync({ messages: [] });

    expect(mockInvalidateQueries).not.toHaveBeenCalled();
  });
});
