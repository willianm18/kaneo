import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import startTimer from "@/fetchers/time-entry/start-timer";
import useStartTimer from "./use-start-timer";

const mockInvalidateQueries = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: mockInvalidateQueries,
  }),
  useMutation: (options: {
    mutationFn: (variables: unknown) => Promise<unknown>;
    onSuccess?: (data: unknown, variables: unknown) => void;
  }) => ({
    mutateAsync: async (variables: unknown) => {
      const data = await options.mutationFn(variables);
      await options.onSuccess?.(data, variables);
      return data;
    },
    isPending: false,
  }),
}));

vi.mock("@/fetchers/time-entry/start-timer", () => ({
  default: vi.fn(),
}));

describe("useStartTimer", () => {
  beforeEach(() => {
    mockInvalidateQueries.mockClear();
    vi.mocked(startTimer).mockReset();
  });

  it("invalidates time-entries, active-timers, task and tasks views with refetchType all", async () => {
    vi.mocked(startTimer).mockResolvedValue({ id: "entry-1" } as never);

    const { result } = renderHook(() => useStartTimer());

    await result.current.mutateAsync({ taskId: "task-1" });

    const calls = mockInvalidateQueries.mock.calls.map((call) => call[0]);

    expect(calls).toContainEqual({
      queryKey: ["time-entries", "task-1"],
      refetchType: "all",
    });
    expect(calls).toContainEqual({
      queryKey: ["active-timers"],
      refetchType: "all",
    });
    expect(calls).toContainEqual({
      queryKey: ["task", "task-1"],
      refetchType: "all",
    });
    expect(calls).toContainEqual({
      queryKey: ["tasks"],
      refetchType: "all",
    });
  });
});
