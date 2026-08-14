import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import createTimeEntry from "@/fetchers/time-entry/create-time-entry";
import useCreateTimeEntry from "./use-create-time-entry";

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

vi.mock("@/fetchers/time-entry/create-time-entry", () => ({
  default: vi.fn(),
}));

describe("useCreateTimeEntry", () => {
  beforeEach(() => {
    mockInvalidateQueries.mockClear();
    vi.mocked(createTimeEntry).mockReset();
  });

  it("invalidates time-entries, active-timers, task and tasks views with refetchType all", async () => {
    vi.mocked(createTimeEntry).mockResolvedValue({ id: "entry-1" } as never);

    const { result } = renderHook(() => useCreateTimeEntry());

    await result.current.mutateAsync({
      taskId: "task-1",
      startTime: new Date().toISOString(),
    } as never);

    const calls = mockInvalidateQueries.mock.calls.map((call) => call[0]);

    expect(calls).toContainEqual({ queryKey: ["time-entries", "task-1"] });
    expect(calls).toContainEqual({ queryKey: ["active-timers"] });
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
