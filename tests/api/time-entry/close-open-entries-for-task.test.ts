import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const mockSelect = vi.fn();
const mockUpdate = vi.fn();

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: (...args: unknown[]) => mockSelect(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

import closeOpenEntriesForTask from "../../../apps/api/src/time-entry/controllers/close-open-entries-for-task";

function makeSelectMock(rows: unknown[]) {
  const chain: Record<string, Mock> = {
    from: vi.fn(() => chain),
    where: vi.fn(() => Promise.resolve(rows)),
  };
  return chain;
}

function makeUpdateMock() {
  const where = vi.fn(() => Promise.resolve(undefined));
  const set = vi.fn(() => ({ where }));
  return { set, where };
}

describe("closeOpenEntriesForTask", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("fecha uma entrada rodando acumulando o trecho corrente", async () => {
    const now = new Date("2026-08-10T12:00:30.000Z");
    const runningSince = new Date("2026-08-10T12:00:00.000Z");
    mockSelect.mockReturnValue(
      makeSelectMock([{ id: "te-1", duration: 100, runningSince }]),
    );
    const updateChain = makeUpdateMock();
    mockUpdate.mockReturnValue(updateChain);

    const closed = await closeOpenEntriesForTask("task-1", now);

    expect(closed).toBe(1);
    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.duration).toBe(130);
    expect(set.runningSince).toBeNull();
    expect(set.endTime).toBe(now);
  });

  it("fecha uma entrada pausada sem alterar duration", async () => {
    const now = new Date("2026-08-10T12:00:30.000Z");
    mockSelect.mockReturnValue(
      makeSelectMock([{ id: "te-1", duration: 500, runningSince: null }]),
    );
    const updateChain = makeUpdateMock();
    mockUpdate.mockReturnValue(updateChain);

    const closed = await closeOpenEntriesForTask("task-1", now);

    expect(closed).toBe(1);
    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.duration).toBe(500);
    expect(set.endTime).toBe(now);
  });

  it("fecha multiplas entradas abertas da mesma tarefa", async () => {
    const now = new Date("2026-08-10T12:00:30.000Z");
    mockSelect.mockReturnValue(
      makeSelectMock([
        { id: "te-1", duration: 100, runningSince: null },
        {
          id: "te-2",
          duration: 0,
          runningSince: new Date("2026-08-10T12:00:00.000Z"),
        },
      ]),
    );
    const updateChain = makeUpdateMock();
    mockUpdate.mockReturnValue(updateChain);

    const closed = await closeOpenEntriesForTask("task-1", now);

    expect(closed).toBe(2);
    expect(mockUpdate).toHaveBeenCalledTimes(2);
  });

  it("nao chama update quando nao ha entradas abertas", async () => {
    mockSelect.mockReturnValue(makeSelectMock([]));

    const closed = await closeOpenEntriesForTask("task-1", new Date());

    expect(closed).toBe(0);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("nao subtrai duration quando runningSince esta no futuro", async () => {
    const now = new Date("2026-08-10T12:00:00.000Z");
    const runningSince = new Date("2026-08-10T12:05:00.000Z");
    mockSelect.mockReturnValue(
      makeSelectMock([{ id: "te-1", duration: 20, runningSince }]),
    );
    const updateChain = makeUpdateMock();
    mockUpdate.mockReturnValue(updateChain);

    await closeOpenEntriesForTask("task-1", now);

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.duration).toBe(20);
  });
});
