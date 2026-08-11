import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const mockSelect = vi.fn();
const mockUpdate = vi.fn();

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: (...args: unknown[]) => mockSelect(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    query: {
      columnTable: { findFirst: vi.fn(() => Promise.resolve(undefined)) },
    },
  },
}));

vi.mock("../../../apps/api/src/events", () => ({
  publishEvent: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../../apps/api/src/task/validate-task-fields", () => ({
  assertValidTaskStatus: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../../apps/api/src/storage/cleanup-assets", () => ({
  deleteOrphanedAssets: vi.fn(),
}));

import updateTask from "../../../apps/api/src/task/controllers/update-task";

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

const base = {
  id: "task-1",
  title: "Ajustar rele",
  projectId: "project-1",
  description: "",
  priority: "low",
  position: 0,
};

function existing(status: string, completedAt: Date | null) {
  return {
    id: "task-1",
    description: "",
    status,
    projectId: "project-1",
    completedAt,
  };
}

describe("updateTask — completedAt", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("preenche completedAt ao entrar em done quando estava vazio", async () => {
    mockSelect.mockReturnValue(makeSelectMock([existing("in-progress", null)]));
    const updateChain = makeUpdateMock({
      id: "task-1",
      projectId: "project-1",
    });
    mockUpdate.mockReturnValue(updateChain);

    await updateTask({ ...base, status: "done" });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.completedAt).toBeInstanceOf(Date);
  });

  it("nao sobrescreve um completedAt ja definido", async () => {
    const manual = new Date("2026-08-08T12:00:00.000Z");
    mockSelect.mockReturnValue(
      makeSelectMock([existing("in-progress", manual)]),
    );
    const updateChain = makeUpdateMock({
      id: "task-1",
      projectId: "project-1",
    });
    mockUpdate.mockReturnValue(updateChain);

    await updateTask({ ...base, status: "done" });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.completedAt).toBe(manual);
  });

  it("limpa completedAt ao sair de done", async () => {
    mockSelect.mockReturnValue(
      makeSelectMock([existing("done", new Date("2026-08-08T12:00:00.000Z"))]),
    );
    const updateChain = makeUpdateMock({
      id: "task-1",
      projectId: "project-1",
    });
    mockUpdate.mockReturnValue(updateChain);

    await updateTask({ ...base, status: "in-progress" });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.completedAt).toBeNull();
  });

  it("aceita completedAt explicito no passado", async () => {
    const manual = new Date("2026-08-08T12:00:00.000Z");
    mockSelect.mockReturnValue(makeSelectMock([existing("done", null)]));
    const updateChain = makeUpdateMock({
      id: "task-1",
      projectId: "project-1",
    });
    mockUpdate.mockReturnValue(updateChain);

    await updateTask({ ...base, status: "done", completedAt: manual });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.completedAt).toBe(manual);
  });

  it("rejeita completedAt no futuro com 400", async () => {
    mockSelect.mockReturnValue(makeSelectMock([existing("done", null)]));
    mockUpdate.mockReturnValue(makeUpdateMock({}));

    await expect(
      updateTask({
        ...base,
        status: "done",
        completedAt: new Date(Date.now() + 86_400_000),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejeita estimatedSeconds negativo com 400", async () => {
    mockSelect.mockReturnValue(makeSelectMock([existing("to-do", null)]));
    mockUpdate.mockReturnValue(makeUpdateMock({}));

    await expect(
      updateTask({ ...base, status: "to-do", estimatedSeconds: -1 }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("rejeita completedAt invalido (Invalid Date) com 400", async () => {
    mockSelect.mockReturnValue(makeSelectMock([existing("done", null)]));
    mockUpdate.mockReturnValue(makeUpdateMock({}));

    await expect(
      updateTask({
        ...base,
        status: "done",
        completedAt: new Date(Number.NaN),
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("nao mexe em completedAt numa mudanca de status que nao envolve done", async () => {
    mockSelect.mockReturnValue(makeSelectMock([existing("to-do", null)]));
    const updateChain = makeUpdateMock({
      id: "task-1",
      projectId: "project-1",
    });
    mockUpdate.mockReturnValue(updateChain);

    await updateTask({ ...base, status: "in-progress" });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.completedAt).toBeNull();
  });
});
