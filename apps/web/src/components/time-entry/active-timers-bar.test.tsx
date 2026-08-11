import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ActiveTimersBar from "./active-timers-bar";

const mockStart = vi.fn();
const mockPause = vi.fn();
const mockStop = vi.fn();
let activeData: unknown = {
  entries: [],
  serverTime: "2026-08-10T12:00:00.000Z",
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) =>
      opts?.count !== undefined ? `${key}:${opts.count}` : key,
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

vi.mock("@/hooks/queries/time-entry/use-active-timers", () => ({
  default: () => ({ data: activeData }),
}));

vi.mock("@/hooks/mutations/time-entry/use-start-timer", () => ({
  default: () => ({ mutateAsync: mockStart, isPending: false }),
}));

vi.mock("@/hooks/mutations/time-entry/use-pause-timer", () => ({
  default: () => ({ mutateAsync: mockPause, isPending: false }),
}));

vi.mock("@/hooks/mutations/time-entry/use-stop-timer", () => ({
  default: () => ({ mutateAsync: mockStop, isPending: false }),
}));

function entry(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "te-1",
    taskId: "task-1",
    taskTitle: "Ajustar rele",
    projectId: "project-1",
    workspaceId: "workspace-1",
    duration: 60,
    runningSince: null,
    isRunning: false,
    ...overrides,
  };
}

describe("ActiveTimersBar", () => {
  it("nao renderiza nada quando nao ha entradas ativas", () => {
    activeData = { entries: [], serverTime: "2026-08-10T12:00:00.000Z" };

    const { container } = render(<ActiveTimersBar />);

    expect(container).toBeEmptyDOMElement();
  });

  it("mostra apenas a contagem de rodando quando nao ha pausados", () => {
    activeData = {
      entries: [
        entry({
          id: "te-1",
          isRunning: true,
          runningSince: "2026-08-10T12:00:00.000Z",
        }),
        entry({
          id: "te-2",
          isRunning: true,
          runningSince: "2026-08-10T12:00:00.000Z",
        }),
      ],
      serverTime: "2026-08-10T12:00:00.000Z",
    };

    render(<ActiveTimersBar />);

    expect(screen.getByText("tasks:timer.runningCount:2")).toBeInTheDocument();
    expect(
      screen.queryByText(/tasks:timer.pausedCount/),
    ).not.toBeInTheDocument();
  });

  it("mostra apenas a contagem de pausados quando nao ha rodando", () => {
    activeData = {
      entries: [entry({ id: "te-1", isRunning: false })],
      serverTime: "2026-08-10T12:00:00.000Z",
    };

    render(<ActiveTimersBar />);

    expect(screen.getByText("tasks:timer.pausedCount:1")).toBeInTheDocument();
    expect(
      screen.queryByText(/tasks:timer.runningCount/),
    ).not.toBeInTheDocument();
  });

  it("mostra as duas contagens separadamente quando ha rodando e pausado", () => {
    activeData = {
      entries: [
        entry({
          id: "te-1",
          isRunning: true,
          runningSince: "2026-08-10T12:00:00.000Z",
        }),
        entry({ id: "te-2", isRunning: false }),
        entry({ id: "te-3", isRunning: false }),
      ],
      serverTime: "2026-08-10T12:00:00.000Z",
    };

    render(<ActiveTimersBar />);

    expect(screen.getByText("tasks:timer.runningCount:1")).toBeInTheDocument();
    expect(screen.getByText("tasks:timer.pausedCount:2")).toBeInTheDocument();
  });
});
