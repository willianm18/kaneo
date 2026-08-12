import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ActiveTimersBar from "./active-timers-bar";

const mockPause = vi.fn();
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

vi.mock("@/hooks/mutations/time-entry/use-pause-timer", () => ({
  default: () => ({ mutateAsync: mockPause, isPending: false }),
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

  it("nao renderiza nada quando so ha entradas pausadas", () => {
    // A API /time-entry/active devolve entradas rodando e pausadas (tudo com
    // endTime nulo); a barra so mostra o que esta contando.
    activeData = {
      entries: [entry({ id: "te-1", isRunning: false })],
      serverTime: "2026-08-10T12:00:00.000Z",
    };

    const { container } = render(<ActiveTimersBar />);

    expect(container).toBeEmptyDOMElement();
  });

  it("uma entrada pausada nao aparece na barra; uma rodando aparece", () => {
    activeData = {
      entries: [
        entry({
          id: "te-1",
          taskTitle: "Rodando",
          isRunning: true,
          runningSince: "2026-08-10T12:00:00.000Z",
        }),
        entry({ id: "te-2", taskTitle: "Pausada", isRunning: false }),
      ],
      serverTime: "2026-08-10T12:00:00.000Z",
    };

    render(<ActiveTimersBar />);

    expect(screen.getByText("Rodando")).toBeInTheDocument();
    expect(screen.queryByText("Pausada")).not.toBeInTheDocument();
  });

  it("mostra a contagem de entradas rodando", () => {
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
        entry({ id: "te-3", isRunning: false }),
      ],
      serverTime: "2026-08-10T12:00:00.000Z",
    };

    render(<ActiveTimersBar />);

    expect(screen.getByText("tasks:timer.runningCount:2")).toBeInTheDocument();
  });

  it("nao existe mais botao de encerrar (finish) na barra", () => {
    activeData = {
      entries: [
        entry({
          id: "te-1",
          isRunning: true,
          runningSince: "2026-08-10T12:00:00.000Z",
        }),
      ],
      serverTime: "2026-08-10T12:00:00.000Z",
    };

    render(<ActiveTimersBar />);

    expect(
      screen.queryByRole("button", { name: "tasks:timer.stop" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "tasks:timer.pause" }),
    ).toBeInTheDocument();
  });

  it("clicar em pausar chama pauseTimer com a entrada", () => {
    activeData = {
      entries: [
        entry({
          id: "te-1",
          isRunning: true,
          runningSince: "2026-08-10T12:00:00.000Z",
        }),
      ],
      serverTime: "2026-08-10T12:00:00.000Z",
    };

    render(<ActiveTimersBar />);

    fireEvent.click(screen.getByRole("button", { name: "tasks:timer.pause" }));

    expect(mockPause).toHaveBeenCalledWith({
      timeEntryId: "te-1",
      taskId: "task-1",
    });
  });
});
