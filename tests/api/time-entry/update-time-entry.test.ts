import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const mockSelect = vi.fn();
const mockUpdate = vi.fn();

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: (...args: unknown[]) => mockSelect(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

import updateTimeEntry from "../../../apps/api/src/time-entry/controllers/update-time-entry";

function makeSelectMock(rows: unknown[]) {
  const chain: Record<string, Mock> = {
    from: vi.fn(() => chain),
    where: vi.fn(() => Promise.resolve(rows)),
  };
  return chain;
}

function makeUpdateMock(updatedRow: unknown) {
  const returning = vi.fn(() => Promise.resolve([updatedRow]));
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  return { set, where, returning };
}

describe("updateTimeEntry", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("preserva o acumulado de uma entrada cronometrada", async () => {
    const storedStartTime = new Date("2026-08-10T10:00:00.000Z");
    const storedEndTime = new Date("2026-08-10T11:00:00.000Z");
    const nextStartTime = new Date("2026-08-10T10:15:00.000Z");
    const updatedRow = {
      id: "time-entry-1",
      startTime: nextStartTime,
      endTime: storedEndTime,
      duration: 3600,
      description: "renamed",
    };
    const updateChain = makeUpdateMock(updatedRow);

    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "time-entry-1",
          startTime: storedStartTime,
          endTime: storedEndTime,
          duration: 3600,
          runningSince: null,
        },
      ]),
    );
    mockUpdate.mockReturnValue(updateChain);

    await updateTimeEntry({
      timeEntryId: "time-entry-1",
      startTime: nextStartTime,
      description: "renamed",
    });

    expect(updateChain.set).toHaveBeenCalledWith({
      startTime: nextStartTime,
      endTime: storedEndTime,
      duration: 3600,
      description: "renamed",
    });
  });

  it("recalcula duration para uma entrada manual nunca cronometrada", async () => {
    const updatedRow = { id: "time-entry-1" };
    const updateChain = makeUpdateMock(updatedRow);

    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "time-entry-1",
          startTime: new Date("2026-08-10T10:00:00.000Z"),
          endTime: new Date("2026-08-10T11:00:00.000Z"),
          duration: 0,
          runningSince: null,
        },
      ]),
    );
    mockUpdate.mockReturnValue(updateChain);

    await updateTimeEntry({
      timeEntryId: "time-entry-1",
      startTime: new Date("2026-08-10T10:30:00.000Z"),
    });

    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 1800 }),
    );
  });

  // LIMITACAO CONHECIDA (ver comentario acima de `wasTimed` em
  // update-time-entry.ts): a heuristica nao distingue uma entrada realmente
  // cronometrada de uma entrada manual ja editada uma vez. Este teste fixa o
  // comportamento aceito hoje — nao "conserte" sem antes ler a justificativa.
  it("LIMITACAO CONHECIDA: segunda edicao de entrada manual preserva o duration obsoleto", async () => {
    const updatedRow = { id: "time-entry-1" };
    const updateChain = makeUpdateMock(updatedRow);

    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "time-entry-1",
          startTime: new Date("2026-08-10T10:00:00.000Z"),
          endTime: new Date("2026-08-10T11:00:00.000Z"),
          // Nunca foi cronometrada (runningSince null), mas ja foi editada
          // manualmente uma vez, entao duration ja esta persistido como > 0.
          duration: 1800,
          runningSince: null,
        },
      ]),
    );
    mockUpdate.mockReturnValue(updateChain);

    await updateTimeEntry({
      timeEntryId: "time-entry-1",
      startTime: new Date("2026-08-10T10:15:00.000Z"),
    });

    // O intervalo novo (10:15-11:00) recalcularia para 2700s, mas a heuristica
    // classifica a entrada como "cronometrada" e preserva o valor obsoleto.
    expect(updateChain.set).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 1800 }),
    );
  });

  it("rejects a startTime later than the preserved endTime", async () => {
    const updateChain = makeUpdateMock({});

    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "time-entry-1",
          startTime: new Date("2026-08-10T10:00:00.000Z"),
          endTime: new Date("2026-08-10T11:00:00.000Z"),
          duration: 3600,
        },
      ]),
    );
    mockUpdate.mockReturnValue(updateChain);

    await expect(
      updateTimeEntry({
        timeEntryId: "time-entry-1",
        startTime: new Date("2026-08-10T12:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(updateChain.set).not.toHaveBeenCalled();
  });

  it("rejects a startTime later than an endTime supplied in the same update", async () => {
    const updateChain = makeUpdateMock({});

    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "time-entry-1",
          startTime: new Date("2026-08-10T10:00:00.000Z"),
          endTime: null,
          duration: null,
        },
      ]),
    );
    mockUpdate.mockReturnValue(updateChain);

    await expect(
      updateTimeEntry({
        timeEntryId: "time-entry-1",
        startTime: new Date("2026-08-10T12:00:00.000Z"),
        endTime: new Date("2026-08-10T11:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(updateChain.set).not.toHaveBeenCalled();
  });

  it("still allows an open entry to have its startTime moved forward", async () => {
    const nextStartTime = new Date("2026-08-10T12:00:00.000Z");
    const updateChain = makeUpdateMock({ id: "time-entry-1" });

    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "time-entry-1",
          startTime: new Date("2026-08-10T10:00:00.000Z"),
          endTime: null,
          duration: null,
        },
      ]),
    );
    mockUpdate.mockReturnValue(updateChain);

    await updateTimeEntry({
      timeEntryId: "time-entry-1",
      startTime: nextStartTime,
    });

    expect(updateChain.set).toHaveBeenCalledWith({
      startTime: nextStartTime,
      endTime: null,
      duration: null,
    });
  });

  it("sets the accumulated total directly when duration is provided", async () => {
    const storedStartTime = new Date("2026-08-10T10:00:00.000Z");
    const storedEndTime = new Date("2026-08-10T11:00:00.000Z");
    const updateChain = makeUpdateMock({ id: "time-entry-1" });

    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "time-entry-1",
          startTime: storedStartTime,
          endTime: storedEndTime,
          duration: 3600,
          runningSince: null,
        },
      ]),
    );
    mockUpdate.mockReturnValue(updateChain);

    await updateTimeEntry({
      timeEntryId: "time-entry-1",
      duration: 5400,
    });

    // startTime/endTime nao foram enviados: mantem os valores armazenados.
    // duration passa a ser exatamente o que foi pedido, sem heuristica.
    expect(updateChain.set).toHaveBeenCalledWith({
      startTime: storedStartTime,
      endTime: storedEndTime,
      duration: 5400,
    });
  });

  it("rejects a negative duration with 400", async () => {
    const updateChain = makeUpdateMock({});

    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "time-entry-1",
          startTime: new Date("2026-08-10T10:00:00.000Z"),
          endTime: null,
          duration: 100,
          runningSince: null,
        },
      ]),
    );
    mockUpdate.mockReturnValue(updateChain);

    await expect(
      updateTimeEntry({
        timeEntryId: "time-entry-1",
        duration: -1,
      }),
    ).rejects.toMatchObject({ status: 400 });

    expect(updateChain.set).not.toHaveBeenCalled();
  });

  it("resets runningSince to now when editing duration on a running entry, to avoid double counting", async () => {
    const runningSince = new Date("2026-08-10T09:00:00.000Z");
    const updateChain = makeUpdateMock({ id: "time-entry-1" });

    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "time-entry-1",
          startTime: new Date("2026-08-10T08:00:00.000Z"),
          endTime: null,
          duration: 600,
          runningSince,
        },
      ]),
    );
    mockUpdate.mockReturnValue(updateChain);

    const before = Date.now();
    await updateTimeEntry({
      timeEntryId: "time-entry-1",
      duration: 900,
    });
    const after = Date.now();

    const set = updateChain.set.mock.calls[0][0] as {
      duration: number;
      runningSince: Date;
    };
    expect(set.duration).toBe(900);
    expect(set.runningSince).toBeInstanceOf(Date);
    expect(set.runningSince.getTime()).toBeGreaterThanOrEqual(before);
    expect(set.runningSince.getTime()).toBeLessThanOrEqual(after);
    // A entrada nao estava rodando desde antes do rebase — o trecho corrente
    // pre-edicao nao sera somado de novo por cima do valor editado.
    expect(set.runningSince.getTime()).not.toBe(runningSince.getTime());
  });

  it("does not touch runningSince when editing duration on a paused/closed entry", async () => {
    const updateChain = makeUpdateMock({ id: "time-entry-1" });

    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "time-entry-1",
          startTime: new Date("2026-08-10T08:00:00.000Z"),
          endTime: new Date("2026-08-10T09:00:00.000Z"),
          duration: 3600,
          runningSince: null,
        },
      ]),
    );
    mockUpdate.mockReturnValue(updateChain);

    await updateTimeEntry({
      timeEntryId: "time-entry-1",
      duration: 1200,
    });

    expect(updateChain.set).toHaveBeenCalledWith({
      startTime: new Date("2026-08-10T08:00:00.000Z"),
      endTime: new Date("2026-08-10T09:00:00.000Z"),
      duration: 1200,
    });
  });
});
