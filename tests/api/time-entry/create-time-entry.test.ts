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

import createTimeEntry from "../../../apps/api/src/time-entry/controllers/create-time-entry";

// O select de tarefas (para o evento) termina em .where() direto; o select de
// entradas existentes termina em .orderBy(). O chain precisa suportar ambos,
// e ser "thenable" para o caso de nao existir nenhuma entrada previa e o
// `await` recair sobre o proprio encadeamento .where().
function makeSelectMock(rows: unknown[]) {
  // biome-ignore lint/suspicious/noExplicitAny: mock de query builder encadeado
  const chain: any = {};
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.orderBy = vi.fn(() => Promise.resolve(rows));
  // biome-ignore lint/suspicious/noThenProperty: chain deve ser thenable
  chain.then = (resolve: (value: unknown) => unknown) => resolve(rows);
  return chain;
}

function makeInsertMock(createdRow: unknown) {
  const returning = vi.fn(() => Promise.resolve([createdRow]));
  const values = vi.fn(() => ({ returning }));
  return { values, returning };
}

function makeUpdateMock(updatedRow: unknown) {
  const returning = vi.fn(() => Promise.resolve([updatedRow]));
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  return { set, where, returning };
}

function makeDeleteMock() {
  const where = vi.fn(() => Promise.resolve());
  return { where };
}

// Quando nao existe entrada previa, createTimeEntry faz um segundo select
// (busca de userId/title da tarefa) para publicar o evento. Para os testes
// do caminho "sem entrada existente", o primeiro select() (busca de entradas)
// deve devolver [] e o segundo (busca da tarefa) deve devolver a linha da
// tarefa. mockSelect.mockReturnValueOnce encadeado cobre isso.
function stubNoExistingEntry() {
  mockSelect
    .mockReturnValueOnce(makeSelectMock([]))
    .mockReturnValueOnce(
      makeSelectMock([{ userId: "owner-1", title: "Task title" }]),
    );
}

describe("createTimeEntry", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("deriva a duration a partir de startTime/endTime quando duration nao e informada", async () => {
    stubNoExistingEntry();
    const insertChain = makeInsertMock({ id: "te-1" });
    mockInsert.mockReturnValue(insertChain);

    const startTime = new Date("2026-08-12T07:35:00.000Z");
    const endTime = new Date("2026-08-12T12:35:00.000Z");

    await createTimeEntry({
      taskId: "task-1",
      userId: "user-1",
      startTime,
      endTime,
    });

    const values = insertChain.values.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // 5h = 18000s
    expect(values.duration).toBe(18000);
  });

  it("mantem uma duration explicita como autoritativa mesmo com endTime presente", async () => {
    stubNoExistingEntry();
    const insertChain = makeInsertMock({ id: "te-1" });
    mockInsert.mockReturnValue(insertChain);

    const startTime = new Date("2026-08-12T07:35:00.000Z");
    const endTime = new Date("2026-08-12T12:35:00.000Z"); // seria 18000s calculado

    await createTimeEntry({
      taskId: "task-1",
      userId: "user-1",
      startTime,
      endTime,
      duration: 42,
    });

    const values = insertChain.values.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(values.duration).toBe(42);
  });

  it("nao fabrica duration para um timer aberto (sem endTime)", async () => {
    stubNoExistingEntry();
    const insertChain = makeInsertMock({ id: "te-1" });
    mockInsert.mockReturnValue(insertChain);

    await createTimeEntry({
      taskId: "task-1",
      userId: "user-1",
      startTime: new Date("2026-08-12T07:35:00.000Z"),
    });

    const values = insertChain.values.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(values.duration).toBe(0);
    expect(values.endTime).toBeNull();
  });

  it("acumula em uma entrada ja existente da tarefa em vez de inserir uma segunda linha", async () => {
    mockSelect.mockReturnValueOnce(
      makeSelectMock([
        {
          id: "te-existing",
          duration: 1800,
          startTime: new Date("2026-08-11T09:00:00.000Z"),
        },
      ]),
    );
    const updateChain = makeUpdateMock({ id: "te-existing", duration: 3600 });
    mockUpdate.mockReturnValue(updateChain);

    const result = await createTimeEntry({
      taskId: "task-1",
      userId: "user-1",
      startTime: new Date("2026-08-12T07:35:00.000Z"),
      duration: 1800,
    });

    expect(mockInsert).not.toHaveBeenCalled();
    // Soma exata: 1800 (existente) + 1800 (nova) = 3600
    expect(updateChain.set).toHaveBeenCalledWith({ duration: 3600 });
    expect(updateChain.where).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ id: "te-existing", duration: 3600 });
  });

  it("consolida duplicatas pre-existentes e soma a nova duration na mais recente", async () => {
    const mostRecent = {
      id: "te-recent",
      duration: 100,
      startTime: new Date("2026-08-12T12:00:00.000Z"),
    };
    const older = {
      id: "te-older",
      duration: 50,
      startTime: new Date("2026-08-12T09:00:00.000Z"),
    };
    mockSelect.mockReturnValueOnce(makeSelectMock([mostRecent, older]));
    const updateChain = makeUpdateMock({ id: "te-recent", duration: 200 });
    mockUpdate.mockReturnValue(updateChain);
    const deleteChain = makeDeleteMock();
    mockDelete.mockReturnValue(deleteChain);

    await createTimeEntry({
      taskId: "task-1",
      userId: "user-1",
      startTime: new Date("2026-08-12T13:00:00.000Z"),
      duration: 50,
    });

    // Soma exata: 100 + 50 (duplicata) + 50 (nova) = 200
    expect(updateChain.set).toHaveBeenCalledWith({ duration: 200 });
    expect(updateChain.where).toHaveBeenCalledTimes(1);
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(deleteChain.where).toHaveBeenCalledTimes(1);
  });

  it("rejeita duration negativa com 400", async () => {
    await expect(
      createTimeEntry({
        taskId: "task-1",
        userId: "user-1",
        startTime: new Date("2026-08-12T07:35:00.000Z"),
        duration: -1,
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });
});
