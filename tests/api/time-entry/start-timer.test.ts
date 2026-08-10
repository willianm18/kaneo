import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSelect = vi.fn();
const mockUpdate = vi.fn();
const mockInsert = vi.fn();

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: (...args: unknown[]) => mockSelect(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    insert: (...args: unknown[]) => mockInsert(...args),
  },
}));

vi.mock("../../../apps/api/src/events", () => ({
  publishEvent: vi.fn(() => Promise.resolve()),
}));

import startTimer from "../../../apps/api/src/time-entry/controllers/start-timer";

// O chain precisa ser "thenable": `start-timer` faz duas consultas de formatos
// diferentes — uma termina em .limit() e a busca do titulo da tarefa termina em
// .where(). Sem o `then`, o await sobre o chain devolveria o proprio objeto e o
// destructuring `const [task] = ...` estouraria.
function makeSelectMock(rows: unknown[]) {
  // biome-ignore lint/suspicious/noExplicitAny: mock de query builder encadeado
  const chain: any = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => Promise.resolve(rows));
  // biome-ignore lint/suspicious/noThenProperty: chain must be thenable so `await db.select()...where()` resolves without .limit()
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

describe("startTimer", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("cria uma entrada rodando quando nao existe entrada aberta", async () => {
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
    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.runningSince).toBeInstanceOf(Date);
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
    expect(result.runningSince).toBe(runningSince);
  });
});
