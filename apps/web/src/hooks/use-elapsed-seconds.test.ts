import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useElapsedSeconds } from "./use-elapsed-seconds";

describe("useElapsedSeconds", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retorna apenas o acumulado quando pausado", () => {
    const { result } = renderHook(() =>
      useElapsedSeconds({ duration: 120, runningSince: null, clockSkewMs: 0 }),
    );

    expect(result.current).toBe(120);
  });

  it("soma o trecho corrente quando rodando", () => {
    const { result } = renderHook(() =>
      useElapsedSeconds({
        duration: 100,
        runningSince: "2026-08-10T11:59:30.000Z",
        clockSkewMs: 0,
      }),
    );

    expect(result.current).toBe(130);
  });

  it("aplica o desvio de relogio informado", () => {
    const { result } = renderHook(() =>
      useElapsedSeconds({
        duration: 0,
        runningSince: "2026-08-10T12:00:00.000Z",
        clockSkewMs: 10_000,
      }),
    );

    expect(result.current).toBe(10);
  });
});
