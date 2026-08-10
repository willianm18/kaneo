import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const mockSelect = vi.fn();
const mockUpdate = vi.fn();

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: (...args: unknown[]) => mockSelect(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
  },
}));

import pauseTimer from "../../../apps/api/src/time-entry/controllers/pause-timer";

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

describe("pauseTimer", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("acumula o trecho corrente em duration e zera runningSince", async () => {
    const runningSince = new Date(Date.now() - 60_000);
    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "te-1",
          userId: "user-1",
          endTime: null,
          duration: 100,
          runningSince,
        },
      ]),
    );
    const updateChain = makeUpdateMock({ id: "te-1" });
    mockUpdate.mockReturnValue(updateChain);

    await pauseTimer({ timeEntryId: "te-1", userId: "user-1" });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.runningSince).toBeNull();
    expect(set.duration).toBeGreaterThanOrEqual(159);
    expect(set.duration).toBeLessThanOrEqual(161);
  });

  it("nao subtrai de duration quando runningSince esta no futuro", async () => {
    const runningSince = new Date(Date.now() + 60_000);
    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "te-1",
          userId: "user-1",
          endTime: null,
          duration: 100,
          runningSince,
        },
      ]),
    );
    const updateChain = makeUpdateMock({ id: "te-1" });
    mockUpdate.mockReturnValue(updateChain);

    await pauseTimer({ timeEntryId: "te-1", userId: "user-1" });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.duration).toBe(100);
  });

  it("e idempotente quando ja esta pausado", async () => {
    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "te-1",
          userId: "user-1",
          endTime: null,
          duration: 100,
          runningSince: null,
        },
      ]),
    );

    const result = await pauseTimer({ timeEntryId: "te-1", userId: "user-1" });

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result.duration).toBe(100);
  });

  it("rejeita com 409 quando a entrada ja esta encerrada", async () => {
    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "te-1",
          userId: "user-1",
          endTime: new Date("2026-08-10T11:00:00.000Z"),
          duration: 3600,
          runningSince: null,
        },
      ]),
    );

    await expect(
      pauseTimer({ timeEntryId: "te-1", userId: "user-1" }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("rejeita com 404 quando a entrada e de outro usuario", async () => {
    mockSelect.mockReturnValue(makeSelectMock([]));

    await expect(
      pauseTimer({ timeEntryId: "te-1", userId: "user-1" }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("lanca 500 quando o update de pausa nao retorna linha", async () => {
    const runningSince = new Date(Date.now() - 60_000);
    mockSelect.mockReturnValue(
      makeSelectMock([
        {
          id: "te-1",
          userId: "user-1",
          endTime: null,
          duration: 100,
          runningSince,
        },
      ]),
    );
    const returning = vi.fn(() => Promise.resolve([]));
    const where = vi.fn(() => ({ returning }));
    const set = vi.fn(() => ({ where }));
    mockUpdate.mockReturnValue({ set, where, returning });

    await expect(
      pauseTimer({ timeEntryId: "te-1", userId: "user-1" }),
    ).rejects.toMatchObject({ status: 500 });
  });
});
