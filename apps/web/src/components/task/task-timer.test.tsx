import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import TaskTimer, { formatDuration } from "./task-timer";

const mockStart = vi.fn();
const mockPause = vi.fn();
let timeEntriesData: unknown = [];

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.useRealTimers();
});

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
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
    timeEntriesData = [];

    render(<TaskTimer taskId="task-1" />);

    expect(screen.getByText("tasks:timer.start")).toBeInTheDocument();
    expect(screen.queryByText("tasks:timer.pause")).not.toBeInTheDocument();
  });

  it("mostra pausar (unico botao) quando a entrada esta rodando", () => {
    timeEntriesData = [
      {
        id: "te-1",
        taskId: "task-1",
        userId: "user-1",
        duration: 60,
        runningSince: "2026-08-10T12:00:00.000Z",
        endTime: null,
      },
    ];

    render(<TaskTimer taskId="task-1" />);

    expect(screen.getByText("tasks:timer.pause")).toBeInTheDocument();
    expect(screen.queryByText("tasks:timer.stop")).not.toBeInTheDocument();
    expect(screen.queryByText("tasks:timer.start")).not.toBeInTheDocument();
  });

  it("mostra retomar quando a entrada esta pausada", () => {
    timeEntriesData = [
      {
        id: "te-1",
        taskId: "task-1",
        userId: "user-1",
        duration: 60,
        runningSince: null,
        endTime: null,
      },
    ];

    render(<TaskTimer taskId="task-1" />);

    expect(screen.getByText("tasks:timer.resume")).toBeInTheDocument();
    expect(screen.getByText("00:01:00")).toBeInTheDocument();
  });

  it("clicar no botao unico pausa uma entrada rodando", () => {
    timeEntriesData = [
      {
        id: "te-1",
        taskId: "task-1",
        userId: "user-1",
        duration: 60,
        runningSince: "2026-08-10T12:00:00.000Z",
        endTime: null,
      },
    ];

    render(<TaskTimer taskId="task-1" />);

    fireEvent.click(screen.getByRole("button", { name: "tasks:timer.pause" }));

    expect(mockPause).toHaveBeenCalledWith({
      timeEntryId: "te-1",
      taskId: "task-1",
    });
  });

  it("clicar no botao unico inicia quando nao ha entrada aberta", () => {
    timeEntriesData = [];

    render(<TaskTimer taskId="task-1" />);

    fireEvent.click(screen.getByRole("button", { name: "tasks:timer.start" }));

    expect(mockStart).toHaveBeenCalledWith({ taskId: "task-1" });
  });

  it("nao existe mais acao de encerrar (finish) em nenhuma variante", () => {
    timeEntriesData = [
      {
        id: "te-1",
        taskId: "task-1",
        userId: "user-1",
        duration: 60,
        runningSince: "2026-08-10T12:00:00.000Z",
        endTime: null,
      },
    ];

    const { rerender } = render(<TaskTimer taskId="task-1" />);
    expect(screen.queryByText("tasks:timer.stop")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "tasks:timer.stop" }),
    ).not.toBeInTheDocument();

    rerender(<TaskTimer taskId="task-1" compact />);
    expect(
      screen.queryByRole("button", { name: "tasks:timer.stop" }),
    ).not.toBeInTheDocument();
  });

  it("modo compacto mostra apenas o cronometro e iniciar quando nao ha entrada aberta", () => {
    timeEntriesData = [];

    render(<TaskTimer taskId="task-1" compact />);

    // Um unico numero na tela: o total apontado da tarefa.
    expect(screen.getAllByText("00:00:00")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "tasks:timer.start" }),
    ).toBeInTheDocument();
  });

  it("modo compacto mostra pausar quando a entrada esta rodando", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T12:00:00.000Z"));

    timeEntriesData = [
      {
        id: "te-1",
        taskId: "task-1",
        userId: "user-1",
        duration: 60,
        runningSince: "2026-08-10T12:00:00.000Z",
        endTime: null,
      },
    ];

    render(<TaskTimer taskId="task-1" compact />);

    expect(screen.getByText("00:01:00")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "tasks:timer.pause" }),
    ).toBeInTheDocument();
  });

  it("mostra o total apontado somando entradas fechadas mesmo sem timer ativo", () => {
    // Este e' O CRITERIO DE ACEITE: apos pausar o timer (nenhuma entrada
    // rodando), o tempo ja apontado continua visivel na tarefa, como o unico
    // numero exibido.
    timeEntriesData = [
      {
        id: "te-1",
        taskId: "task-1",
        userId: "user-1",
        duration: 125,
        runningSince: null,
        endTime: "2026-08-10T11:00:00.000Z",
      },
      {
        id: "te-2",
        taskId: "task-1",
        userId: "user-2",
        duration: 75,
        runningSince: null,
        endTime: "2026-08-10T11:30:00.000Z",
      },
    ];

    render(<TaskTimer taskId="task-1" />);

    expect(screen.getByText("00:03:20")).toBeInTheDocument();
  });

  it("modo compacto tambem mostra o total apontado apos pausar o timer", () => {
    timeEntriesData = [
      {
        id: "te-1",
        taskId: "task-1",
        userId: "user-1",
        duration: 200,
        runningSince: null,
        endTime: "2026-08-10T11:00:00.000Z",
      },
    ];

    render(<TaskTimer taskId="task-1" compact />);

    expect(screen.getByText("00:03:20")).toBeInTheDocument();
  });

  it("soma o trecho em andamento de uma entrada aberta ao total apontado", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T12:05:00.000Z"));

    timeEntriesData = [
      {
        id: "te-1",
        taskId: "task-1",
        userId: "user-2",
        duration: 300,
        runningSince: null,
        endTime: "2026-08-10T11:00:00.000Z",
      },
      {
        id: "te-2",
        taskId: "task-1",
        userId: "user-1",
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

    fireEvent.click(screen.getByText("01:00:00"));

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

  it("o contador e o total vem da mesma (unica) consulta de dados", () => {
    // So mockamos useGetTimeEntriesByTaskId — se o componente ainda
    // dependesse de useActiveTimers para o contador, este teste falharia por
    // falta de dados (a query nao mockada retornaria undefined).
    timeEntriesData = [
      {
        id: "te-1",
        taskId: "task-1",
        userId: "user-1",
        duration: 42,
        runningSince: null,
        endTime: null,
      },
    ];

    render(<TaskTimer taskId="task-1" />);

    expect(screen.getByText("tasks:timer.resume")).toBeInTheDocument();
    expect(screen.getByText("00:00:42")).toBeInTheDocument();
  });
});
