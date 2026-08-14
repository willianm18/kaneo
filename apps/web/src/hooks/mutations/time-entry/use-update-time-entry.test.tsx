import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import updateTimeEntry from "@/fetchers/time-entry/update-time-entry";
import useUpdateTimeEntry from "./use-update-time-entry";

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

vi.mock("@/fetchers/time-entry/update-time-entry", () => ({
  default: vi.fn(),
}));

describe("useUpdateTimeEntry", () => {
  beforeEach(() => {
    mockInvalidateQueries.mockClear();
    vi.mocked(updateTimeEntry).mockReset();
  });

  it("invalidates time-entries, active-timers, task and tasks views with refetchType all", async () => {
    vi.mocked(updateTimeEntry).mockResolvedValue({ id: "entry-1" } as never);

    const { result } = renderHook(() => useUpdateTimeEntry("task-1"));

    await result.current.mutateAsync({
      id: "entry-1",
      duration: 3600,
    } as never);

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
