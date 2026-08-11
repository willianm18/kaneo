import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockInsert = vi.fn();
const mockDelete = vi.fn();

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: (...args: unknown[]) => mockSelect(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
    delete: (...args: unknown[]) => mockDelete(...args),
  },
}));

vi.mock("../../../apps/api/src/events", () => ({
  publishEvent: vi.fn(() => Promise.resolve()),
}));

import startTimer from "../../../apps/api/src/time-entry/controllers/start-timer";

// O chain precisa ser "thenable": `start-timer` faz duas consultas de formatos
// diferentes — uma termina em .orderBy() e a busca do titulo da tarefa termina
// em .where(). Sem o `then`, o await sobre o chain devolveria o proprio objeto
// e o destructuring `const [task] = ...` estouraria.
function makeSelectMock(rows: unknown[]) {
  // biome-ignore lint/suspicious/noExplicitAny: mock de query builder encadeado
  const chain: any = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => Promise.resolve(rows));
  // biome-ignore lint/suspicious/noThenProperty: chain must be thenable so `await db.select()...where()` resolves without .orderBy()
  chain.then = (resolve: (value: unknown) => unknown) => resolve(rows);
  return chain;
}

function makeUpdateMock(updatedRow: unknown) {
  const returning = vi.fn(() => Promise.resolve([updatedRow]));
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  return { set, where, returning };
}

function makeInsertMock(createdRow: unknown) {
  const returning = vi.fn(() => Promise.resolve([createdRow]));
  const values = vi.fn(() => ({ returning }));
  return { values, returning };
}

function makeDeleteMock() {
  const where = vi.fn(() => Promise.resolve());
  return { where };
}

describe("startTimer", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("cria uma entrada rodando quando nao existe nenhuma entrada", async () => {
    mockSelect.mockReturnValue(makeSelectMock([]));
    const insertChain = makeInsertMock({ id: "te-1" });
    mockInsert.mockReturnValue(insertChain);

    await startTimer({ taskId: "task-1", userId: "user-1" });

    const values = insertChain.values.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(values.taskId).toBe("task-1");
    expect(values.userId).toBe("user-1");
    expect(values.duration).toBe(0);
    expect(values.endTime).toBeNull();
    expect(values.runningSince).toBeInstanceOf(Date);
    expect(values.startTime).toBeInstanceOf(Date);
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("retoma a entrada pausada sem criar outra e sem reescrever startTime", async () => {
    const storedStartTime = new Date("2026-08-10T09:00:00.000Z");
    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "te-1",
          startTime: storedStartTime,
          endTime: null,
          duration: 1800,
          runningSince: null,
        },
      ]),
    );
    const updateChain = makeUpdateMock({ id: "te-1" });
    mockUpdate.mockReturnValue(updateChain);

    await startTimer({ taskId: "task-1", userId: "user-1" });

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.runningSince).toBeInstanceOf(Date);
    expect(set.duration).toBe(1800);
    expect(set.endTime).toBeNull();
    expect(set.startTime).toBeUndefined();
  });

  it("lanca 500 quando o update de retomada nao retorna linha", async () => {
    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "te-1",
          startTime: new Date("2026-08-10T09:00:00.000Z"),
          endTime: null,
          duration: 1800,
          runningSince: null,
        },
      ]),
    );
    const returning = vi.fn(() => Promise.resolve([]));
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    mockUpdate.mockReturnValue({ set, where, returning });

    await expect(
      startTimer({ taskId: "task-1", userId: "user-1" }),
    ).rejects.toMatchObject({ status: 500 });
  });

  it("e idempotente quando a entrada ja esta rodando", async () => {
    const runningSince = new Date("2026-08-10T09:30:00.000Z");
    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "te-1",
          startTime: new Date("2026-08-10T09:00:00.000Z"),
          endTime: null,
          duration: 0,
          runningSince,
        },
      ]),
    );

    const result = await startTimer({ taskId: "task-1", userId: "user-1" });

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(result.runningSince).toBe(runningSince);
  });

  it("reabre uma entrada encerrada em vez de criar uma segunda, preservando duration", async () => {
    const storedStartTime = new Date("2026-08-10T09:00:00.000Z");
    const storedEndTime = new Date("2026-08-10T10:00:00.000Z");
    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "te-1",
          startTime: storedStartTime,
          endTime: storedEndTime,
          duration: 3600,
          runningSince: null,
        },
      ]),
    );
    const updateChain = makeUpdateMock({ id: "te-1" });
    mockUpdate.mockReturnValue(updateChain);

    await startTimer({ taskId: "task-1", userId: "user-1" });

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.endTime).toBeNull();
    expect(set.runningSince).toBeInstanceOf(Date);
    // duration (o tempo ja acumulado) nunca e' tocado ao reabrir
    expect(set.duration).toBe(3600);
  });

  it("consolida multiplas entradas pre-existentes na mais recente, somando duration sem perder segundos", async () => {
    const mostRecentStart = new Date("2026-08-10T12:00:00.000Z");
    const olderStart = new Date("2026-08-10T09:00:00.000Z");
    const oldestStart = new Date("2026-08-10T06:00:00.000Z");

    // orderBy(desc(startTime)) -> mais recente primeiro
    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "te-recent",
          startTime: mostRecentStart,
          endTime: new Date("2026-08-10T12:30:00.000Z"),
          duration: 1800,
          runningSince: null,
        },
        {
          id: "te-older",
          startTime: olderStart,
          endTime: new Date("2026-08-10T09:20:00.000Z"),
          duration: 1200,
          runningSince: null,
        },
        {
          id: "te-oldest",
          startTime: oldestStart,
          endTime: new Date("2026-08-10T06:10:00.000Z"),
          duration: 600,
          runningSince: null,
        },
      ]),
    );
    const updateChain = makeUpdateMock({ id: "te-recent" });
    mockUpdate.mockReturnValue(updateChain);
    const deleteChain = makeDeleteMock();
    mockDelete.mockReturnValue(deleteChain);

    await startTimer({ taskId: "task-1", userId: "user-1" });

    // A entrada alvo e' sempre a mais recente (te-recent); as demais sao
    // somadas nela e apagadas. Soma exata: 1800 + 1200 + 600 = 3600.
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.duration).toBe(3600);
    expect(set.endTime).toBeNull();
    expect(set.runningSince).toBeInstanceOf(Date);

    expect(mockDelete).toHaveBeenCalledTimes(1);
    const deletedIds = mockDelete.mock.calls[0]; // db.delete(table) — args ignored, inspect where()
    expect(deletedIds).toBeDefined();
    expect(deleteChain.where).toHaveBeenCalledTimes(1);
  });

  it("consolida entradas mesmo quando a mais recente ja esta rodando", async () => {
    const runningSince = new Date("2026-08-10T12:10:00.000Z");
    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "te-recent",
          startTime: new Date("2026-08-10T12:00:00.000Z"),
          endTime: null,
          duration: 100,
          runningSince,
        },
        {
          id: "te-older",
          startTime: new Date("2026-08-10T09:00:00.000Z"),
          endTime: new Date("2026-08-10T09:20:00.000Z"),
          duration: 1200,
          runningSince: null,
        },
      ]),
    );
    const updateChain = makeUpdateMock({ id: "te-recent" });
    mockUpdate.mockReturnValue(updateChain);
    const deleteChain = makeDeleteMock();
    mockDelete.mockReturnValue(deleteChain);

    await startTimer({ taskId: "task-1", userId: "user-1" });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    // Soma exata: 100 + 1200 = 1300. O trecho corrente nao e' antecipado
    // aqui — ele so e' dobrado em duration quando pausado/encerrado.
    expect(set.duration).toBe(1300);
    // Entrada ja rodando: runningSince nao e' resetado.
    expect(set.runningSince).toBe(runningSince);
    expect(mockDelete).toHaveBeenCalledTimes(1);
  });
});
