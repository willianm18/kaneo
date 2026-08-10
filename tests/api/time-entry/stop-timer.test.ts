import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const mockSelect = vi.fn();
const mockUpdate = vi.fn();

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: (...args: unknown[]) => mockSelect(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

import stopTimer from "../../../apps/api/src/time-entry/controllers/stop-timer";

function makeSelectMock(rows: unknown[]) {
  const chain: Record<string, Mock> = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    limit: vi.fn(() => Promise.resolve(rows)),
  };
  return chain;
}

function makeUpdateMock(updatedRow: unknown) {
  const returning = vi.fn(() => Promise.resolve([updatedRow]));
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn(() => ({ where }));
  return { set, where, returning };
}

describe("stopTimer", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("acumula o trecho corrente e grava endTime quando rodando", async () => {
    const runningSince = new Date(Date.now() - 30_000);
    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "te-1",
          userId: "user-1",
          endTime: null,
          duration: 10,
          runningSince,
        },
      ]),
    );
    const updateChain = makeUpdateMock({ id: "te-1" });
    mockUpdate.mockReturnValue(updateChain);

    await stopTimer({ timeEntryId: "te-1", userId: "user-1" });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.runningSince).toBeNull();
    expect(set.endTime).toBeInstanceOf(Date);
    expect(set.duration).toBeGreaterThanOrEqual(39);
    expect(set.duration).toBeLessThanOrEqual(41);
  });

  it("nao subtrai de duration quando runningSince esta no futuro", async () => {
    const runningSince = new Date(Date.now() + 30_000);
    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "te-1",
          userId: "user-1",
          endTime: null,
          duration: 10,
          runningSince,
        },
      ]),
    );
    const updateChain = makeUpdateMock({ id: "te-1" });
    mockUpdate.mockReturnValue(updateChain);

    await stopTimer({ timeEntryId: "te-1", userId: "user-1" });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.duration).toBe(10);
  });

  it("apenas grava endTime quando pausado, sem alterar duration", async () => {
    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "te-1",
          userId: "user-1",
          endTime: null,
          duration: 500,
          runningSince: null,
        },
      ]),
    );
    const updateChain = makeUpdateMock({ id: "te-1" });
    mockUpdate.mockReturnValue(updateChain);

    await stopTimer({ timeEntryId: "te-1", userId: "user-1" });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.duration).toBe(500);
    expect(set.endTime).toBeInstanceOf(Date);
  });

  it("e idempotente quando ja esta encerrada", async () => {
    const endTime = new Date("2026-08-10T11:00:00.000Z");
    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "te-1",
          userId: "user-1",
          endTime,
          duration: 3600,
          runningSince: null,
        },
      ]),
    );

    const result = await stopTimer({ timeEntryId: "te-1", userId: "user-1" });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result.endTime).toBe(endTime);
  });

  it("rejeita com 404 quando a entrada e de outro usuario", async () => {
    mockSelect.mockReturnValue(makeSelectMock([]));

    await expect(
      stopTimer({ timeEntryId: "te-1", userId: "user-1" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("lanca 500 quando o update de encerramento nao retorna linha", async () => {
    const runningSince = new Date(Date.now() - 30_000);
    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "te-1",
          userId: "user-1",
          endTime: null,
          duration: 10,
          runningSince,
        },
      ]),
    );
    const returning = vi.fn(() => Promise.resolve([]));
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    mockUpdate.mockReturnValue({ set, where, returning });

    await expect(
      stopTimer({ timeEntryId: "te-1", userId: "user-1" }),
    ).rejects.toMatchObject({ status: 500 });
  });
});
