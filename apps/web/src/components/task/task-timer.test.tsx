import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TaskTimer, { formatDuration } from "./task-timer";

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
  useTranslation: () => ({ t: (key: string) => key }),
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

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canManageTasks: () => true }),
}));

describe("formatDuration", () => {
  it("formata segundos como HH:MM:SS", () => {
    expect(formatDuration(0)).toBe("00:00:00");
    expect(formatDuration(59)).toBe("00:00:59");
    expect(formatDuration(3661)).toBe("01:01:01");
    expect(formatDuration(36000)).toBe("10:00:00");
  });
});

describe("TaskTimer", () => {
  it("mostra apenas iniciar quando nao ha entrada aberta", () => {
    activeData = { entries: [], serverTime: "2026-08-10T12:00:00.000Z" };

    render(<TaskTimer taskId="task-1" />);

    expect(screen.getByText("tasks:timer.start")).toBeInTheDocument();
    expect(screen.queryByText("tasks:timer.stop")).not.toBeInTheDocument();
  });

  it("mostra pausar e encerrar quando a entrada esta rodando", () => {
    activeData = {
      entries: [
        {
          id: "te-1",
          taskId: "task-1",
          duration: 60,
          runningSince: "2026-08-10T12:00:00.000Z",
          isRunning: true,
        },
      ],
      serverTime: "2026-08-10T12:00:00.000Z",
    };

    render(<TaskTimer taskId="task-1" />);

    expect(screen.getByText("tasks:timer.pause")).toBeInTheDocument();
    expect(screen.getByText("tasks:timer.stop")).toBeInTheDocument();
  });

  it("mostra retomar quando a entrada esta pausada", () => {
    activeData = {
      entries: [
        {
          id: "te-1",
          taskId: "task-1",
          duration: 60,
          runningSince: null,
          isRunning: false,
        },
      ],
      serverTime: "2026-08-10T12:00:00.000Z",
    };

    render(<TaskTimer taskId="task-1" />);

    expect(screen.getByText("tasks:timer.resume")).toBeInTheDocument();
    expect(screen.getByText("00:01:00")).toBeInTheDocument();
  });
});
