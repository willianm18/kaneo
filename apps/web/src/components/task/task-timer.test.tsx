import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TaskTimer, { formatDuration } from "./task-timer";

const mockStart = vi.fn();
const mockPause = vi.fn();
const mockStop = vi.fn();
let activeData: unknown = {
  entries: [],
  serverTime: "2026-08-10T12:00:00.000Z",
};
let timeEntriesData: unknown = [];

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/queries/time-entry/use-active-timers", () => ({
  default: () => ({ data: activeData }),
}));

vi.mock("@/hooks/queries/time-entry/use-get-time-entries", () => ({
  default: () => ({ data: timeEntriesData }),
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

const mockUpdateTimeEntry = vi.fn();
vi.mock("@/hooks/mutations/time-entry/use-update-time-entry", () => ({
  default: () => ({ mutateAsync: mockUpdateTimeEntry, isPending: false }),
}));

vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "user-1" }, isLoading: false }),
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
    timeEntriesData = [];

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
    timeEntriesData = [];

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
    timeEntriesData = [];

    render(<TaskTimer taskId="task-1" />);

    expect(screen.getByText("tasks:timer.resume")).toBeInTheDocument();
    expect(screen.getByText("00:01:00")).toBeInTheDocument();
  });

  it("modo compacto mostra apenas o cronometro e iniciar quando nao ha entrada aberta", () => {
    activeData = { entries: [], serverTime: "2026-08-10T12:00:00.000Z" };
    timeEntriesData = [];

    render(<TaskTimer taskId="task-1" compact />);

    expect(screen.getAllByText("00:00:00")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "tasks:timer.start" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "tasks:timer.stop" }),
    ).not.toBeInTheDocument();
  });

  it("modo compacto mostra encerrar quando a entrada esta rodando", () => {
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
    timeEntriesData = [];

    render(<TaskTimer taskId="task-1" compact />);

    expect(screen.getByText("00:01:00")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "tasks:timer.pause" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "tasks:timer.stop" }),
    ).toBeInTheDocument();
  });

  it("mostra o total apontado somando entradas fechadas mesmo sem timer ativo", () => {
    // Este e' O CRITERIO DE ACEITE: apos parar o timer (nenhuma entrada
    // ativa), o tempo ja apontado continua visivel na tarefa.
    activeData = { entries: [], serverTime: "2026-08-10T12:00:00.000Z" };
    timeEntriesData = [
      {
        id: "te-1",
        taskId: "task-1",
        duration: 125,
        runningSince: null,
        endTime: "2026-08-10T11:00:00.000Z",
      },
      {
        id: "te-2",
        taskId: "task-1",
        duration: 75,
        runningSince: null,
        endTime: "2026-08-10T11:30:00.000Z",
      },
    ];

    render(<TaskTimer taskId="task-1" />);

    expect(screen.getByText("tasks:timer.tracked:")).toBeInTheDocument();
    expect(screen.getByText("00:03:20")).toBeInTheDocument();
  });

  it("modo compacto tambem mostra o total apontado apos parar o timer", () => {
    activeData = { entries: [], serverTime: "2026-08-10T12:00:00.000Z" };
    timeEntriesData = [
      {
        id: "te-1",
        taskId: "task-1",
        duration: 200,
        runningSince: null,
        endTime: "2026-08-10T11:00:00.000Z",
      },
    ];

    render(<TaskTimer taskId="task-1" compact />);

    expect(screen.getByText("tasks:timer.tracked:")).toBeInTheDocument();
    expect(screen.getByText("00:03:20")).toBeInTheDocument();
  });

  it("soma o trecho em andamento de uma entrada aberta ao total apontado", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T12:05:00.000Z"));

    activeData = {
      entries: [
        {
          id: "te-2",
          taskId: "task-1",
          duration: 100,
          runningSince: "2026-08-10T12:00:00.000Z",
          isRunning: true,
        },
      ],
      serverTime: "2026-08-10T12:05:00.000Z",
    };
    timeEntriesData = [
      {
        id: "te-1",
        taskId: "task-1",
        duration: 300,
        runningSince: null,
        endTime: "2026-08-10T11:00:00.000Z",
      },
      {
        id: "te-2",
        taskId: "task-1",
        duration: 100,
        runningSince: "2026-08-10T12:00:00.000Z",
        endTime: null,
      },
    ];

    render(<TaskTimer taskId="task-1" />);

    // Fechadas: 300s + entrada aberta: 100s acumulados + 300s do trecho
    // corrente (12:00 -> 12:05) = 700s = 00:11:40. Apenas o trecho corrente
    // avanca; o restante e' estatico.
    expect(screen.getByText("00:11:40")).toBeInTheDocument();
  });

  it("permite editar o total apontado clicando nele, enviando duration em segundos", async () => {
    activeData = { entries: [], serverTime: "2026-08-10T12:00:00.000Z" };
    timeEntriesData = [
      {
        id: "te-1",
        taskId: "task-1",
        userId: "user-1",
        duration: 3600,
        runningSince: null,
        endTime: "2026-08-10T11:00:00.000Z",
      },
    ];
    mockUpdateTimeEntry.mockResolvedValue({});

    render(<TaskTimer taskId="task-1" />);

    fireEvent.click(screen.getByText("tasks:timer.tracked:"));

    const hoursInput = await screen.findByLabelText(
      "tasks:popover.estimate.hours",
    );
    const minutesInput = screen.getByLabelText(
      "tasks:popover.estimate.minutes",
    );

    expect(hoursInput).toHaveValue(1);
    expect(minutesInput).toHaveValue(0);

    fireEvent.change(minutesInput, { target: { value: "30" } });

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:popover.estimate.save" }),
    );

    expect(mockUpdateTimeEntry).toHaveBeenCalledWith({
      id: "te-1",
      duration: 1 * 3600 + 30 * 60,
    });
  });
});
