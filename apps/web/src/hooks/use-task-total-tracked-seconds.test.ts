import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  computeTaskTotalTrackedSeconds,
  useTaskTotalTrackedSeconds,
} from "./use-task-total-tracked-seconds";

describe("computeTaskTotalTrackedSeconds", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("soma apenas as entradas fechadas quando nenhuma esta rodando", () => {
    const total = computeTaskTotalTrackedSeconds(
      [
        { duration: 120, runningSince: null },
        { duration: 300, runningSince: null },
      ],
      0,
    );

    expect(total).toBe(420);
  });

  it("soma o trecho em andamento de uma entrada aberta", () => {
    const total = computeTaskTotalTrackedSeconds(
      [
        { duration: 100, runningSince: null },
        { duration: 50, runningSince: "2026-08-10T11:59:30.000Z" },
      ],
      0,
    );

    expect(total).toBe(180);
  });

  it("aplica o desvio de relogio informado", () => {
    const total = computeTaskTotalTrackedSeconds(
      [{ duration: 0, runningSince: "2026-08-10T12:00:00.000Z" }],
      10_000,
    );

    expect(total).toBe(10);
  });

  it("nao subtrai quando runningSince esta no futuro", () => {
    const total = computeTaskTotalTrackedSeconds(
      [{ duration: 40, runningSince: "2026-08-10T12:05:00.000Z" }],
      0,
    );

    expect(total).toBe(40);
  });

  it("retorna zero para lista vazia", () => {
    expect(computeTaskTotalTrackedSeconds([], 0)).toBe(0);
  });
});

describe("useTaskTotalTrackedSeconds", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("nao ticka quando nenhuma entrada esta rodando", () => {
    const { result } = renderHook(() =>
      useTaskTotalTrackedSeconds([{ duration: 100, runningSince: null }], 0),
    );

    expect(result.current).toBe(100);

    vi.advanceTimersByTime(5_000);

    expect(result.current).toBe(100);
  });

  it("ticka o total quando ha entrada rodando", () => {
    const { result } = renderHook(() =>
      useTaskTotalTrackedSeconds(
        [
          { duration: 100, runningSince: null },
          { duration: 0, runningSince: "2026-08-10T12:00:00.000Z" },
        ],
        0,
      ),
    );

    expect(result.current).toBe(100);

    act(() => {
      vi.advanceTimersByTime(5_000);
    });

    expect(result.current).toBe(105);
  });

  it("retorna zero quando entries e undefined", () => {
    const { result } = renderHook(() =>
      useTaskTotalTrackedSeconds(undefined, 0),
    );

    expect(result.current).toBe(0);
  });
});
