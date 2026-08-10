# Timer de apontamento e campos de tempo da tarefa — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir iniciar, pausar, retomar e encerrar um cronômetro por tarefa, e registrar na tarefa a data real de conclusão e a estimativa de horas.

**Architecture:** A coluna `running_since` em `time_entry` transforma os campos existentes numa máquina de três estados (rodando, pausado, encerrado), com `duration` virando o acumulado autoritativo em segundos. Três endpoints de transição (start/pause/stop) mais um de leitura alimentam um componente na página da tarefa e uma barra global. Na tarefa, `completed_at` e `estimated_seconds` entram no `update-task` existente.

**Tech Stack:** Hono + hono-openapi, Drizzle ORM, Valibot, PostgreSQL, Vitest (API), React 19 + TanStack Query + Tailwind 4 + Radix (web), i18next.

## Global Constraints

- Spec de referência: `docs/superpowers/specs/2026-08-10-task-timer-design.md`.
- Branch de trabalho: `feat/task-timer`. Já contém os commits `ecc73819` e `ff2f60e3`.
- `duration` e `estimatedSeconds` são **sempre em segundos**.
- O horário gravado é **sempre o do servidor** (`new Date()` no controller). O cliente nunca envia "agora".
- Toda operação de transição é **idempotente**, exceto `pause` em entrada encerrada, que retorna 409.
- Convenções obrigatórias do `CLAUDE.md`: controller fino em `{feature}/controllers/`, rota com `describeRoute`, entrada validada com Valibot, `HTTPException` no backend, toast (`sonner`) no frontend, aspas duplas, ponto e vírgula, `type` em vez de `interface`.
- **Nenhuma string literal na UI**: todo texto usa `useTranslation()` com chave i18n. Após adicionar chaves em `i18n/en-US.json` e `i18n/pt-BR.json`, rodar `pnpm i18n:check:fix` (propaga aos 18 idiomas) e `pnpm i18n:schema`.
- **Ambiente local** (ver memória do projeto): subir com `pnpm --filter @kaneo/api dev` e `pnpm --filter @kaneo/web dev` em processos separados — `pnpm dev` via Turbo não sobe a API neste Windows. API em `http://localhost:1337/api/health`, web em `http://localhost:5173`, Postgres em `localhost:5433`.
- **Antes de cada commit**, rodar `pnpm exec biome ci .` — deve terminar com `Found 0 errors` (warnings são aceitáveis e pré-existentes). O pre-commit também roda o build completo (~16s). Se aparecer "File content differs from formatting output" em `apps/site/next-env.d.ts`, converter esse arquivo gerado para LF.
- `tsx watch` recarrega a API a cada mudança em `.ts`, mas **não** em `apps/api/drizzle/*.sql` — após gerar migração, reiniciar a API manualmente.

## File Structure

**API — criar:**
- `apps/api/src/time-entry/controllers/start-timer.ts` — cria ou retoma a entrada aberta da tarefa
- `apps/api/src/time-entry/controllers/pause-timer.ts` — acumula o trecho corrente e pausa
- `apps/api/src/time-entry/controllers/stop-timer.ts` — acumula e encerra
- `apps/api/src/time-entry/controllers/get-active-timers.ts` — lista entradas abertas do usuário

**API — modificar:**
- `apps/api/src/database/schema.ts` — três colunas novas
- `apps/api/src/schemas.ts` — `timeEntrySchema` ganha `runningSince`; novo `activeTimerSchema`
- `apps/api/src/time-entry/index.ts` — quatro rotas novas
- `apps/api/src/time-entry/controllers/update-time-entry.ts` — parar de recalcular `duration`
- `apps/api/src/task/controllers/update-task.ts` — objeto em vez de 11 posicionais; regras de `completedAt`
- `apps/api/src/task/index.ts:378` — chamador de `updateTask`

**Web — criar:**
- `apps/web/src/fetchers/time-entry/{start-timer,pause-timer,stop-timer,get-active-timers}.ts`
- `apps/web/src/hooks/mutations/time-entry/{use-start-timer,use-pause-timer,use-stop-timer}.ts`
- `apps/web/src/hooks/queries/time-entry/use-active-timers.ts`
- `apps/web/src/hooks/use-elapsed-seconds.ts` — contador de 1s com correção de desvio de relógio
- `apps/web/src/components/task/task-timer.tsx`
- `apps/web/src/components/time-entry/active-timers-bar.tsx`
- `apps/web/src/components/task/task-completed-at-popover.tsx`
- `apps/web/src/components/task/task-estimate-popover.tsx`

**Web — modificar:**
- `apps/web/src/components/common/layout.tsx` — montar a barra global
- `apps/web/src/components/task/task-properties-sidebar.tsx` — campos de conclusão e estimativa
- `i18n/en-US.json`, `i18n/pt-BR.json`

**Testes — criar:**
- `tests/api/time-entry/{start-timer,pause-timer,stop-timer}.test.ts`
- `tests/api/task/update-task-completed-at.test.ts`
- `apps/web/src/hooks/use-elapsed-seconds.test.ts`

---

### Task 1: Schema e migração 0038

**Files:**
- Modify: `apps/api/src/database/schema.ts:434-464` (timeEntryTable) e `:373-401` (taskTable)
- Generated: `apps/api/drizzle/0038_*.sql`

**Interfaces:**
- Consumes: nada.
- Produces: colunas `timeEntryTable.runningSince` (`Date | null`), `taskTable.completedAt` (`Date | null`), `taskTable.estimatedSeconds` (`number | null`).

- [ ] **Step 1: Adicionar `runningSince` em `timeEntryTable`**

Em `apps/api/src/database/schema.ts`, dentro de `timeEntryTable`, logo após a linha `duration: integer("duration").default(0),`:

```ts
    runningSince: timestamp("running_since", { mode: "date" }),
```

- [ ] **Step 2: Adicionar `completedAt` e `estimatedSeconds` em `taskTable`**

Em `apps/api/src/database/schema.ts`, dentro de `taskTable`, logo após a linha `dueDate: timestamp("due_date", { mode: "date" }),`:

```ts
    completedAt: timestamp("completed_at", { mode: "date" }),
    estimatedSeconds: integer("estimated_seconds"),
```

- [ ] **Step 3: Gerar a migração**

Run: `pnpm --filter @kaneo/api db:generate`
Expected: cria `apps/api/drizzle/0038_<nome>.sql` e atualiza `apps/api/drizzle/meta/_journal.json`.

- [ ] **Step 4: Conferir o SQL gerado**

Run: `cat apps/api/drizzle/0038_*.sql`
Expected: exatamente três `ALTER TABLE ... ADD COLUMN`, nenhum `DROP`. Se aparecer qualquer `DROP`, pare e investigue — significa que o schema divergiu do banco.

- [ ] **Step 5: Reiniciar a API e confirmar que a migração aplicou**

Reinicie o processo da API (o `tsx watch` não observa `.sql`). Nos logs deve aparecer `✅ Database migrated successfully!`.

Run:
```bash
docker exec kaneo-dev-db psql -U kaneo -d kaneo -tAc "select column_name from information_schema.columns where (table_name='time_entry' and column_name='running_since') or (table_name='task' and column_name in ('completed_at','estimated_seconds')) order by column_name"
```
Expected:
```
completed_at
estimated_seconds
running_since
```

- [ ] **Step 6: Commit**

```bash
pnpm exec biome ci .
git add apps/api/src/database/schema.ts apps/api/drizzle
git commit -m "feat(db): adicionar running_since, completed_at e estimated_seconds"
```

---

### Task 2: Controller `startTimer`

**Files:**
- Create: `apps/api/src/time-entry/controllers/start-timer.ts`
- Test: `tests/api/time-entry/start-timer.test.ts`

**Interfaces:**
- Consumes: `timeEntryTable.runningSince` da Task 1.
- Produces: `startTimer({ taskId, userId, description? }): Promise<TimeEntry>`. Export default.

- [ ] **Step 1: Escrever o teste que falha**

Crie `tests/api/time-entry/start-timer.test.ts` (padrão de mock copiado de `update-time-entry.test.ts`):

```ts
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

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

    const values = insertChain.values.mock.calls[0][0] as Record<string, unknown>;
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
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Run: `pnpm --filter @kaneo/api exec vitest run ../../tests/api/time-entry/start-timer.test.ts`
Expected: FAIL — não resolve o módulo `start-timer`.

> Se o caminho relativo não resolver, rode a partir da raiz: `pnpm exec vitest run tests/api/time-entry/start-timer.test.ts --config apps/api/vitest.config.ts`.

- [ ] **Step 3: Implementar o controller**

Crie `apps/api/src/time-entry/controllers/start-timer.ts`:

```ts
import { createId } from "@paralleldrive/cuid2";
import { and, eq, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskTable, timeEntryTable } from "../../database/schema";
import { publishEvent } from "../../events";

async function startTimer({
  taskId,
  userId,
  description,
}: {
  taskId: string;
  userId: string;
  description?: string;
}) {
  const now = new Date();

  const [openEntry] = await db
    .select()
    .from(timeEntryTable)
    .where(
      and(
        eq(timeEntryTable.taskId, taskId),
        eq(timeEntryTable.userId, userId),
        isNull(timeEntryTable.endTime),
      ),
    )
    .limit(1);

  if (openEntry?.runningSince) {
    return openEntry;
  }

  if (openEntry) {
    const [resumed] = await db
      .update(timeEntryTable)
      .set({ runningSince: now })
      .where(eq(timeEntryTable.id, openEntry.id))
      .returning();

    return resumed;
  }

  const [created] = await db
    .insert(timeEntryTable)
    .values({
      id: createId(),
      taskId,
      userId,
      description: description || "",
      startTime: now,
      endTime: null,
      duration: 0,
      runningSince: now,
    })
    .returning();

  if (!created) {
    throw new HTTPException(500, { message: "Failed to start timer" });
  }

  const [task] = await db
    .select({ userId: taskTable.userId, title: taskTable.title })
    .from(taskTable)
    .where(eq(taskTable.id, taskId));

  await publishEvent("time-entry.created", {
    timeEntryId: created.id,
    taskId: created.taskId,
    userId,
    type: "create",
    content: "started time tracking",
    taskOwnerId: task?.userId,
    taskTitle: task?.title,
  });

  return created;
}

export default startTimer;
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

Run: `pnpm exec vitest run tests/api/time-entry/start-timer.test.ts --config apps/api/vitest.config.ts`
Expected: PASS, 3 testes.

> O terceiro teste (`select` do `taskTable` após o insert) usa o mesmo `mockSelect`; como o primeiro `select` retorna `[]` via `limit`, e o segundo termina em `where`, ajuste `makeSelectMock` para que `where` também resolva como Promise se o teste acusar erro de encadeamento.

- [ ] **Step 5: Commit**

```bash
pnpm exec biome ci .
git add apps/api/src/time-entry/controllers/start-timer.ts tests/api/time-entry/start-timer.test.ts
git commit -m "feat(time-entry): controller startTimer com retomada idempotente"
```

---

### Task 3: Controllers `pauseTimer` e `stopTimer`

**Files:**
- Create: `apps/api/src/time-entry/controllers/pause-timer.ts`, `apps/api/src/time-entry/controllers/stop-timer.ts`
- Test: `tests/api/time-entry/pause-timer.test.ts`, `tests/api/time-entry/stop-timer.test.ts`

**Interfaces:**
- Consumes: `timeEntryTable.runningSince`.
- Produces: `pauseTimer({ timeEntryId, userId }): Promise<TimeEntry>` e `stopTimer({ timeEntryId, userId }): Promise<TimeEntry>`. Export default em cada arquivo.

- [ ] **Step 1: Escrever o teste de `pauseTimer`**

Crie `tests/api/time-entry/pause-timer.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm exec vitest run tests/api/time-entry/pause-timer.test.ts --config apps/api/vitest.config.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar `pauseTimer`**

Crie `apps/api/src/time-entry/controllers/pause-timer.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { timeEntryTable } from "../../database/schema";

async function pauseTimer({
  timeEntryId,
  userId,
}: {
  timeEntryId: string;
  userId: string;
}) {
  const [entry] = await db
    .select()
    .from(timeEntryTable)
    .where(
      and(eq(timeEntryTable.id, timeEntryId), eq(timeEntryTable.userId, userId)),
    )
    .limit(1);

  if (!entry) {
    throw new HTTPException(404, { message: "Time entry not found" });
  }

  if (entry.endTime) {
    throw new HTTPException(409, {
      message: "Cannot pause a time entry that is already finished",
    });
  }

  if (!entry.runningSince) {
    return entry;
  }

  const elapsed = Math.floor(
    (Date.now() - entry.runningSince.getTime()) / 1000,
  );

  const [paused] = await db
    .update(timeEntryTable)
    .set({
      duration: (entry.duration ?? 0) + elapsed,
      runningSince: null,
    })
    .where(eq(timeEntryTable.id, timeEntryId))
    .returning();

  return paused;
}

export default pauseTimer;
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm exec vitest run tests/api/time-entry/pause-timer.test.ts --config apps/api/vitest.config.ts`
Expected: PASS, 4 testes.

- [ ] **Step 5: Escrever o teste de `stopTimer`**

Crie `tests/api/time-entry/stop-timer.test.ts` com o mesmo cabeçalho de mocks do Step 1 (copie `mockSelect`, `mockUpdate`, `vi.mock`, `makeSelectMock`, `makeUpdateMock`), trocando o import para:

```ts
import stopTimer from "../../../apps/api/src/time-entry/controllers/stop-timer";
```

E os casos:

```ts
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
});
```

- [ ] **Step 6: Implementar `stopTimer`**

Crie `apps/api/src/time-entry/controllers/stop-timer.ts`:

```ts
import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { timeEntryTable } from "../../database/schema";

async function stopTimer({
  timeEntryId,
  userId,
}: {
  timeEntryId: string;
  userId: string;
}) {
  const [entry] = await db
    .select()
    .from(timeEntryTable)
    .where(
      and(eq(timeEntryTable.id, timeEntryId), eq(timeEntryTable.userId, userId)),
    )
    .limit(1);

  if (!entry) {
    throw new HTTPException(404, { message: "Time entry not found" });
  }

  if (entry.endTime) {
    return entry;
  }

  const now = new Date();
  const elapsed = entry.runningSince
    ? Math.floor((now.getTime() - entry.runningSince.getTime()) / 1000)
    : 0;

  const [stopped] = await db
    .update(timeEntryTable)
    .set({
      duration: (entry.duration ?? 0) + elapsed,
      runningSince: null,
      endTime: now,
    })
    .where(eq(timeEntryTable.id, timeEntryId))
    .returning();

  return stopped;
}

export default stopTimer;
```

- [ ] **Step 7: Rodar todos os testes de time-entry**

Run: `pnpm exec vitest run tests/api/time-entry --config apps/api/vitest.config.ts`
Expected: PASS em todos os arquivos, incluindo o `update-time-entry.test.ts` pré-existente.

- [ ] **Step 8: Commit**

```bash
pnpm exec biome ci .
git add apps/api/src/time-entry/controllers/pause-timer.ts apps/api/src/time-entry/controllers/stop-timer.ts tests/api/time-entry
git commit -m "feat(time-entry): controllers pauseTimer e stopTimer"
```

---

### Task 4: Leitura de timers ativos, rotas e correção do `duration`

**Files:**
- Create: `apps/api/src/time-entry/controllers/get-active-timers.ts`
- Modify: `apps/api/src/time-entry/index.ts`, `apps/api/src/schemas.ts`, `apps/api/src/time-entry/controllers/update-time-entry.ts:36-49`

**Interfaces:**
- Consumes: `startTimer`, `pauseTimer`, `stopTimer` das Tasks 2 e 3.
- Produces: rotas `POST /time-entry/task/:taskId/start`, `POST /time-entry/:id/pause`, `POST /time-entry/:id/stop`, `GET /time-entry/active`. A rota `active` retorna `{ entries: ActiveTimer[], serverTime: string }`, onde `ActiveTimer` tem `id`, `taskId`, `taskTitle`, `projectId`, `workspaceId`, `duration`, `runningSince`, `isRunning`.

- [ ] **Step 1: Corrigir `update-time-entry` para não sobrescrever o acumulado**

Em `apps/api/src/time-entry/controllers/update-time-entry.ts`, substitua o bloco das linhas 36-41:

```ts
  let duration: number | null = null;
  if (effectiveEndTime) {
    duration = Math.floor(
      (effectiveEndTime.getTime() - startTime.getTime()) / 1000,
    ); // duration in seconds
  }
```

por:

```ts
  // O timer mantem `duration` como acumulado autoritativo em segundos, entao so
  // recalculamos a partir do intervalo quando a entrada nunca foi cronometrada.
  const wasTimed =
    existingTimeEntry.runningSince !== null ||
    (existingTimeEntry.duration ?? 0) > 0;

  let duration: number | null = existingTimeEntry.duration ?? null;
  if (!wasTimed && effectiveEndTime) {
    duration = Math.floor(
      (effectiveEndTime.getTime() - startTime.getTime()) / 1000,
    );
  }
```

- [ ] **Step 2: Rodar os testes existentes de `update-time-entry`**

Run: `pnpm exec vitest run tests/api/time-entry/update-time-entry.test.ts --config apps/api/vitest.config.ts`
Expected: PASS. O teste "preserves a stored endTime and duration when endTime is omitted" espera `duration: 2700`; com `duration: 3600` armazenado e `runningSince` ausente no mock, `wasTimed` é `true` e o valor preservado passa a ser `3600`. **Atualize esse teste** para reconhecer o novo contrato: mude a expectativa para `duration: 3600` e renomeie para `"preserva o acumulado de uma entrada cronometrada"`. Adicione um caso novo cobrindo o lançamento manual:

```ts
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
```

- [ ] **Step 3: Implementar `getActiveTimers`**

Crie `apps/api/src/time-entry/controllers/get-active-timers.ts`:

```ts
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import db from "../../database";
import { projectTable, taskTable, timeEntryTable } from "../../database/schema";

async function getActiveTimers(userId: string) {
  const rows = await db
    .select({
      id: timeEntryTable.id,
      taskId: timeEntryTable.taskId,
      taskTitle: taskTable.title,
      projectId: taskTable.projectId,
      workspaceId: projectTable.workspaceId,
      duration: timeEntryTable.duration,
      runningSince: timeEntryTable.runningSince,
    })
    .from(timeEntryTable)
    .innerJoin(taskTable, eq(timeEntryTable.taskId, taskTable.id))
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        eq(timeEntryTable.userId, userId),
        isNull(timeEntryTable.endTime),
        isNotNull(timeEntryTable.startTime),
      ),
    );

  return rows.map((row) => ({
    ...row,
    isRunning: row.runningSince !== null,
  }));
}

export default getActiveTimers;
```

> Antes de escrever, confirme o nome da coluna de workspace em `projectTable` com
> `grep -n "workspaceId" apps/api/src/database/schema.ts | head -3` e ajuste se divergir.

- [ ] **Step 4: Adicionar `runningSince` ao `timeEntrySchema` e criar `activeTimerSchema`**

Em `apps/api/src/schemas.ts`, dentro de `timeEntrySchema` (linha ~71), após `duration: v.nullable(v.number()),`:

```ts
  runningSince: v.nullable(v.date()),
```

E logo após o `timeEntrySchema`, adicione:

```ts
export const activeTimerSchema = v.object({
  id: v.string(),
  taskId: v.string(),
  taskTitle: v.string(),
  projectId: v.string(),
  workspaceId: v.string(),
  duration: v.nullable(v.number()),
  runningSince: v.nullable(v.date()),
  isRunning: v.boolean(),
});

export const activeTimersResponseSchema = v.object({
  entries: v.array(activeTimerSchema),
  serverTime: v.string(),
});
```

- [ ] **Step 5: Adicionar as quatro rotas**

Em `apps/api/src/time-entry/index.ts`, ajuste os imports do topo:

```ts
import { activeTimersResponseSchema, timeEntrySchema } from "../schemas";
import getActiveTimers from "./controllers/get-active-timers";
import pauseTimer from "./controllers/pause-timer";
import startTimer from "./controllers/start-timer";
import stopTimer from "./controllers/stop-timer";
```

Encadeie as rotas **antes** de `.get("/:id", ...)` — caso contrário `/active` seria capturado como um `:id`:

```ts
  .get(
    "/active",
    describeRoute({
      operationId: "getActiveTimers",
      tags: ["Time Entries"],
      description: "List the current user's open time entries",
      responses: {
        200: {
          description: "Open time entries plus the server clock",
          content: {
            "application/json": {
              schema: resolver(activeTimersResponseSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const userId = c.get("userId");
      const entries = await getActiveTimers(userId);
      return c.json({ entries, serverTime: new Date().toISOString() });
    },
  )
```

E, após a rota `.put("/:id", ...)`, encadeie as três transições:

```ts
  .post(
    "/task/:taskId/start",
    describeRoute({
      operationId: "startTimer",
      tags: ["Time Entries"],
      description: "Start or resume the timer for a task",
      responses: {
        200: {
          description: "Timer started",
          content: {
            "application/json": { schema: resolver(timeEntrySchema) },
          },
        },
      },
    }),
    validator("param", v.object({ taskId: v.string() })),
    validator("json", v.object({ description: v.optional(v.string()) })),
    workspaceAccess.fromTaskId(),
    requireWorkspacePermission({ task: ["update"] }),
    async (c) => {
      const { taskId } = c.req.valid("param");
      const { description } = c.req.valid("json");
      const userId = c.get("userId");
      const timeEntry = await startTimer({ taskId, userId, description });
      return c.json(timeEntry);
    },
  )
  .post(
    "/:id/pause",
    describeRoute({
      operationId: "pauseTimer",
      tags: ["Time Entries"],
      description: "Pause a running timer",
      responses: {
        200: {
          description: "Timer paused",
          content: {
            "application/json": { schema: resolver(timeEntrySchema) },
          },
        },
      },
    }),
    validator("param", v.object({ id: v.string() })),
    workspaceAccess.fromTimeEntry(),
    requireWorkspacePermission({ task: ["update"] }),
    async (c) => {
      const { id } = c.req.valid("param");
      const userId = c.get("userId");
      const timeEntry = await pauseTimer({ timeEntryId: id, userId });
      return c.json(timeEntry);
    },
  )
  .post(
    "/:id/stop",
    describeRoute({
      operationId: "stopTimer",
      tags: ["Time Entries"],
      description: "Stop a timer and close the entry",
      responses: {
        200: {
          description: "Timer stopped",
          content: {
            "application/json": { schema: resolver(timeEntrySchema) },
          },
        },
      },
    }),
    validator("param", v.object({ id: v.string() })),
    workspaceAccess.fromTimeEntry(),
    requireWorkspacePermission({ task: ["update"] }),
    async (c) => {
      const { id } = c.req.valid("param");
      const userId = c.get("userId");
      const timeEntry = await stopTimer({ timeEntryId: id, userId });
      return c.json(timeEntry);
    },
  );
```

- [ ] **Step 6: Verificar as rotas contra a API rodando**

Com a API no ar, autentique-se no navegador e confirme via console (ou use um token de API):

Run: `curl -s -o /dev/null -w "%{http_code}\n" http://localhost:1337/api/time-entry/active`
Expected: `401` sem sessão (a rota existe e exige autenticação). Um `404` significa que a rota não foi registrada — reveja a ordem do encadeamento.

- [ ] **Step 7: Commit**

```bash
pnpm exec biome ci .
pnpm --filter @kaneo/api exec tsc --noEmit
git add apps/api/src/time-entry apps/api/src/schemas.ts tests/api/time-entry
git commit -m "feat(time-entry): rotas start, pause, stop e active"
```

---

### Task 5: `completedAt` e `estimatedSeconds` na tarefa

**Files:**
- Modify: `apps/api/src/task/controllers/update-task.ts`, `apps/api/src/task/index.ts:378`
- Test: `tests/api/task/update-task-completed-at.test.ts`

**Interfaces:**
- Consumes: colunas da Task 1.
- Produces: `updateTask(params: UpdateTaskParams)` recebendo **um objeto** com os campos `id`, `title`, `status`, `startDate`, `dueDate`, `projectId`, `description`, `priority`, `position`, `userId?`, `currentUserId?`, `completedAt?`, `estimatedSeconds?`.

- [ ] **Step 1: Escrever o teste**

Crie `tests/api/task/update-task-completed-at.test.ts`:

```ts
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

const mockSelect = vi.fn();
const mockUpdate = vi.fn();

vi.mock("../../../apps/api/src/database", () => ({
  default: {
    select: (...args: unknown[]) => mockSelect(...args),
    update: (...args: unknown[]) => mockUpdate(...args),
    query: { columnTable: { findFirst: vi.fn(() => Promise.resolve(undefined)) } },
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
    const updateChain = makeUpdateMock({ id: "task-1", projectId: "project-1" });
    mockUpdate.mockReturnValue(updateChain);

    await updateTask({ ...base, status: "done" });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.completedAt).toBeInstanceOf(Date);
  });

  it("nao sobrescreve um completedAt ja definido", async () => {
    const manual = new Date("2026-08-08T12:00:00.000Z");
    mockSelect.mockReturnValue(makeSelectMock([existing("in-progress", manual)]));
    const updateChain = makeUpdateMock({ id: "task-1", projectId: "project-1" });
    mockUpdate.mockReturnValue(updateChain);

    await updateTask({ ...base, status: "done" });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.completedAt).toBe(manual);
  });

  it("limpa completedAt ao sair de done", async () => {
    mockSelect.mockReturnValue(
      makeSelectMock([existing("done", new Date("2026-08-08T12:00:00.000Z"))]),
    );
    const updateChain = makeUpdateMock({ id: "task-1", projectId: "project-1" });
    mockUpdate.mockReturnValue(updateChain);

    await updateTask({ ...base, status: "in-progress" });

    const set = updateChain.set.mock.calls[0][0] as Record<string, unknown>;
    expect(set.completedAt).toBeNull();
  });

  it("aceita completedAt explicito no passado", async () => {
    const manual = new Date("2026-08-08T12:00:00.000Z");
    mockSelect.mockReturnValue(makeSelectMock([existing("done", null)]));
    const updateChain = makeUpdateMock({ id: "task-1", projectId: "project-1" });
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
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm exec vitest run tests/api/task/update-task-completed-at.test.ts --config apps/api/vitest.config.ts`
Expected: FAIL — `updateTask` ainda recebe parâmetros posicionais.

- [ ] **Step 3: Refatorar a assinatura e implementar as regras**

Em `apps/api/src/task/controllers/update-task.ts`, substitua a assinatura (linhas 9-21) por:

```ts
type UpdateTaskParams = {
  id: string;
  title: string;
  status: string;
  startDate?: Date;
  dueDate?: Date;
  projectId: string;
  description: string;
  priority: string;
  position: number;
  userId?: string;
  currentUserId?: string;
  completedAt?: Date | null;
  estimatedSeconds?: number | null;
};

async function updateTask({
  id,
  title,
  status,
  startDate,
  dueDate,
  projectId,
  description,
  priority,
  position,
  userId,
  currentUserId,
  completedAt,
  estimatedSeconds,
}: UpdateTaskParams) {
```

Adicione `completedAt: taskTable.completedAt,` ao `select` de `existingTask` (linhas 23-28).

Após o bloco `assertValidTaskStatus` (linha 45), insira as validações e a resolução do valor:

```ts
  if (completedAt && completedAt.getTime() > Date.now()) {
    throw new HTTPException(400, {
      message: "Completion date cannot be in the future",
    });
  }

  if (estimatedSeconds !== undefined && estimatedSeconds !== null && estimatedSeconds < 0) {
    throw new HTTPException(400, {
      message: "Estimate cannot be negative",
    });
  }

  const wasDone = existingTask.status === "done";
  const isDone = status === "done";

  let resolvedCompletedAt: Date | null;
  if (completedAt !== undefined) {
    resolvedCompletedAt = completedAt;
  } else if (isDone) {
    resolvedCompletedAt = existingTask.completedAt ?? new Date();
  } else if (wasDone) {
    resolvedCompletedAt = null;
  } else {
    resolvedCompletedAt = existingTask.completedAt ?? null;
  }
```

No `.set({ ... })` (linhas 56-67), acrescente:

```ts
      completedAt: resolvedCompletedAt,
      ...(estimatedSeconds !== undefined && { estimatedSeconds }),
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm exec vitest run tests/api/task/update-task-completed-at.test.ts --config apps/api/vitest.config.ts`
Expected: PASS, 6 testes.

- [ ] **Step 5: Atualizar o único chamador**

Em `apps/api/src/task/index.ts:378`, troque a chamada posicional pela forma de objeto, mantendo exatamente os mesmos valores já passados e acrescentando os dois campos novos vindos do payload validado. Adicione ao validador `json` dessa rota:

```ts
        completedAt: v.optional(v.nullable(v.string())),
        estimatedSeconds: v.optional(v.nullable(v.number())),
```

E na chamada:

```ts
      const task = await updateTask({
        id,
        title,
        status,
        startDate: startDate ? new Date(startDate) : undefined,
        dueDate: dueDate ? new Date(dueDate) : undefined,
        projectId,
        description,
        priority,
        position,
        userId,
        currentUserId: c.get("userId"),
        completedAt:
          completedAt === undefined
            ? undefined
            : completedAt === null
              ? null
              : new Date(completedAt),
        estimatedSeconds,
      });
```

> Leia as linhas 340-400 de `apps/api/src/task/index.ts` antes de editar e preserve os nomes das variáveis já desestruturadas ali; os valores acima devem espelhar o que a rota já passava posicionalmente.

- [ ] **Step 6: Typecheck e testes completos**

Run: `pnpm --filter @kaneo/api exec tsc --noEmit`
Expected: sem erros.

Run: `pnpm exec vitest run tests/api --config apps/api/vitest.config.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
pnpm exec biome ci .
git add apps/api/src/task tests/api/task
git commit -m "feat(task): completedAt automatico e editavel, mais estimativa"
```

---

### Task 6: Fetchers, hooks e contador do frontend

**Files:**
- Create: `apps/web/src/fetchers/time-entry/{start-timer,pause-timer,stop-timer,get-active-timers}.ts`
- Create: `apps/web/src/hooks/mutations/time-entry/{use-start-timer,use-pause-timer,use-stop-timer}.ts`
- Create: `apps/web/src/hooks/queries/time-entry/use-active-timers.ts`
- Create: `apps/web/src/hooks/use-elapsed-seconds.ts`
- Test: `apps/web/src/hooks/use-elapsed-seconds.test.ts`

**Interfaces:**
- Consumes: as rotas da Task 4 (tipos chegam automaticamente pelo cliente Hono RPC em `@kaneo/libs`).
- Produces: `useStartTimer()`, `usePauseTimer()`, `useStopTimer()` (mutations), `useActiveTimers()` (query, `queryKey: ["active-timers"]`), e `useElapsedSeconds({ duration, runningSince, clockSkewMs })`.

- [ ] **Step 1: Escrever o teste do contador**

Crie `apps/web/src/hooks/use-elapsed-seconds.test.ts`:

```ts
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useElapsedSeconds } from "./use-elapsed-seconds";

describe("useElapsedSeconds", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retorna apenas o acumulado quando pausado", () => {
    const { result } = renderHook(() =>
      useElapsedSeconds({ duration: 120, runningSince: null, clockSkewMs: 0 }),
    );

    expect(result.current).toBe(120);
  });

  it("soma o trecho corrente quando rodando", () => {
    const { result } = renderHook(() =>
      useElapsedSeconds({
        duration: 100,
        runningSince: "2026-08-10T11:59:30.000Z",
        clockSkewMs: 0,
      }),
    );

    expect(result.current).toBe(130);
  });

  it("aplica o desvio de relogio informado", () => {
    const { result } = renderHook(() =>
      useElapsedSeconds({
        duration: 0,
        runningSince: "2026-08-10T12:00:00.000Z",
        clockSkewMs: 10_000,
      }),
    );

    expect(result.current).toBe(10);
  });
});
```

- [ ] **Step 2: Rodar e confirmar falha**

Run: `pnpm --filter @kaneo/web exec vitest run src/hooks/use-elapsed-seconds.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar o contador**

Crie `apps/web/src/hooks/use-elapsed-seconds.ts`:

```ts
import { useEffect, useState } from "react";

type UseElapsedSecondsParams = {
  duration: number | null;
  runningSince: string | null;
  clockSkewMs: number;
};

function compute({
  duration,
  runningSince,
  clockSkewMs,
}: UseElapsedSecondsParams) {
  const accumulated = duration ?? 0;

  if (!runningSince) {
    return accumulated;
  }

  const serverNow = Date.now() + clockSkewMs;
  const elapsed = Math.floor(
    (serverNow - new Date(runningSince).getTime()) / 1000,
  );

  return accumulated + Math.max(0, elapsed);
}

export function useElapsedSeconds(params: UseElapsedSecondsParams) {
  const [seconds, setSeconds] = useState(() => compute(params));

  useEffect(() => {
    setSeconds(compute(params));

    if (!params.runningSince) {
      return;
    }

    const interval = setInterval(() => {
      setSeconds(compute(params));
    }, 1000);

    return () => clearInterval(interval);
  }, [params.duration, params.runningSince, params.clockSkewMs]);

  return seconds;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @kaneo/web exec vitest run src/hooks/use-elapsed-seconds.test.ts`
Expected: PASS, 3 testes.

- [ ] **Step 5: Criar os fetchers**

`apps/web/src/fetchers/time-entry/start-timer.ts`:

```ts
import { client } from "@kaneo/libs";

async function startTimer({
  taskId,
  description,
}: {
  taskId: string;
  description?: string;
}) {
  const response = await client["time-entry"].task[":taskId"].start.$post({
    param: { taskId },
    json: { description },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return await response.json();
}

export default startTimer;
```

`apps/web/src/fetchers/time-entry/pause-timer.ts`:

```ts
import { client } from "@kaneo/libs";

async function pauseTimer(timeEntryId: string) {
  const response = await client["time-entry"][":id"].pause.$post({
    param: { id: timeEntryId },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return await response.json();
}

export default pauseTimer;
```

`apps/web/src/fetchers/time-entry/stop-timer.ts`: o código completo está no Step 6, junto do hook que o consome.

`apps/web/src/fetchers/time-entry/get-active-timers.ts`:

```ts
import { client } from "@kaneo/libs";

async function getActiveTimers() {
  const response = await client["time-entry"].active.$get();

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return await response.json();
}

export default getActiveTimers;
```

> Se o TypeScript reclamar do caminho encadeado, confirme a forma exata do cliente RPC
> inspecionando um fetcher existente e o tipo exportado por `@kaneo/libs`.

- [ ] **Step 6: Criar os hooks**

`apps/web/src/hooks/queries/time-entry/use-active-timers.ts`:

```ts
import { useQuery } from "@tanstack/react-query";
import getActiveTimers from "@/fetchers/time-entry/get-active-timers";

export function useActiveTimers() {
  return useQuery({
    queryKey: ["active-timers"],
    queryFn: getActiveTimers,
    refetchOnWindowFocus: true,
  });
}

export default useActiveTimers;
```

`apps/web/src/hooks/mutations/time-entry/use-start-timer.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import startTimer from "@/fetchers/time-entry/start-timer";

function useStartTimer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { taskId: string; description?: string }) =>
      startTimer(data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["time-entries", variables.taskId],
      });
      queryClient.invalidateQueries({ queryKey: ["active-timers"] });
    },
  });
}

export default useStartTimer;
```

`apps/web/src/hooks/mutations/time-entry/use-pause-timer.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import pauseTimer from "@/fetchers/time-entry/pause-timer";

function usePauseTimer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ timeEntryId }: { timeEntryId: string; taskId: string }) =>
      pauseTimer(timeEntryId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["time-entries", variables.taskId],
      });
      queryClient.invalidateQueries({ queryKey: ["active-timers"] });
    },
  });
}

export default usePauseTimer;
```

`apps/web/src/hooks/mutations/time-entry/use-stop-timer.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import stopTimer from "@/fetchers/time-entry/stop-timer";

function useStopTimer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ timeEntryId }: { timeEntryId: string; taskId: string }) =>
      stopTimer(timeEntryId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["time-entries", variables.taskId],
      });
      queryClient.invalidateQueries({ queryKey: ["active-timers"] });
    },
  });
}

export default useStopTimer;
```

`apps/web/src/fetchers/time-entry/stop-timer.ts`:

```ts
import { client } from "@kaneo/libs";

async function stopTimer(timeEntryId: string) {
  const response = await client["time-entry"][":id"].stop.$post({
    param: { id: timeEntryId },
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return await response.json();
}

export default stopTimer;
```

- [ ] **Step 7: Typecheck e commit**

```bash
pnpm --filter @kaneo/web exec tsc --noEmit
pnpm exec biome ci .
git add apps/web/src/fetchers/time-entry apps/web/src/hooks
git commit -m "feat(web): fetchers, hooks e contador do timer"
```

---

### Task 7: Componente `TaskTimer`

**Files:**
- Create: `apps/web/src/components/task/task-timer.tsx`
- Modify: `apps/web/src/components/task/task-properties-sidebar.tsx`, `i18n/en-US.json`, `i18n/pt-BR.json`

**Interfaces:**
- Consumes: hooks da Task 6.
- Produces: componente `TaskTimer({ taskId }: { taskId: string })`, export default.

- [ ] **Step 1: Adicionar as chaves i18n**

Em `i18n/en-US.json`, dentro do objeto `tasks`, adicione o bloco `timer`:

```json
"timer": {
  "start": "Start",
  "pause": "Pause",
  "resume": "Resume",
  "stop": "Finish",
  "tracked": "Tracked",
  "running": "Running",
  "startError": "Could not start the timer",
  "pauseError": "Could not pause the timer",
  "stopError": "Could not finish the timer"
}
```

Em `i18n/pt-BR.json`, no mesmo caminho:

```json
"timer": {
  "start": "Iniciar",
  "pause": "Pausar",
  "resume": "Retomar",
  "stop": "Encerrar",
  "tracked": "Apontado",
  "running": "Em andamento",
  "startError": "Não foi possível iniciar o timer",
  "pauseError": "Não foi possível pausar o timer",
  "stopError": "Não foi possível encerrar o timer"
}
```

Run: `pnpm i18n:check:fix && pnpm i18n:schema`
Expected: os 18 idiomas passam a conter as chaves; `i18n/schema.json` é regenerado.

- [ ] **Step 2: Implementar o componente**

Crie `apps/web/src/components/task/task-timer.tsx`:

```ts
import { Pause, Play, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import usePauseTimer from "@/hooks/mutations/time-entry/use-pause-timer";
import useStartTimer from "@/hooks/mutations/time-entry/use-start-timer";
import useStopTimer from "@/hooks/mutations/time-entry/use-stop-timer";
import useActiveTimers from "@/hooks/queries/time-entry/use-active-timers";
import { useElapsedSeconds } from "@/hooks/use-elapsed-seconds";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";

export function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

export default function TaskTimer({ taskId }: { taskId: string }) {
  const { t } = useTranslation();
  const { data } = useActiveTimers();
  const { mutateAsync: startTimer, isPending: isStarting } = useStartTimer();
  const { mutateAsync: pauseTimer, isPending: isPausing } = usePauseTimer();
  const { mutateAsync: stopTimer, isPending: isStopping } = useStopTimer();
  const { canManageTasks } = useWorkspacePermission();

  const entry = data?.entries.find((item) => item.taskId === taskId);
  const clockSkewMs = data?.serverTime
    ? new Date(data.serverTime).getTime() - Date.now()
    : 0;

  const elapsed = useElapsedSeconds({
    duration: entry?.duration ?? 0,
    runningSince: entry?.runningSince ?? null,
    clockSkewMs,
  });

  if (!canManageTasks()) return null;

  const isBusy = isStarting || isPausing || isStopping;

  const handleStart = async () => {
    try {
      await startTimer({ taskId });
    } catch {
      toast.error(t("tasks:timer.startError"));
    }
  };

  const handlePause = async () => {
    if (!entry) return;
    try {
      await pauseTimer({ timeEntryId: entry.id, taskId });
    } catch {
      toast.error(t("tasks:timer.pauseError"));
    }
  };

  const handleStop = async () => {
    if (!entry) return;
    try {
      await stopTimer({ timeEntryId: entry.id, taskId });
    } catch {
      toast.error(t("tasks:timer.stopError"));
    }
  };

  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-sm tabular-nums">
        {formatDuration(elapsed)}
      </span>

      {entry?.isRunning ? (
        <Button size="sm" variant="ghost" disabled={isBusy} onClick={handlePause}>
          <Pause className="h-4 w-4" />
          {t("tasks:timer.pause")}
        </Button>
      ) : (
        <Button size="sm" variant="ghost" disabled={isBusy} onClick={handleStart}>
          <Play className="h-4 w-4" />
          {entry ? t("tasks:timer.resume") : t("tasks:timer.start")}
        </Button>
      )}

      {entry && (
        <Button size="sm" variant="ghost" disabled={isBusy} onClick={handleStop}>
          <Square className="h-4 w-4" />
          {t("tasks:timer.stop")}
        </Button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Escrever o teste de componente**

Crie `apps/web/src/components/task/task-timer.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TaskTimer, { formatDuration } from "./task-timer";

const mockStart = vi.fn();
const mockPause = vi.fn();
const mockStop = vi.fn();
let activeData: unknown = { entries: [], serverTime: "2026-08-10T12:00:00.000Z" };

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/hooks/queries/time-entry/use-active-timers", () => ({
  default: () => ({ data: activeData }),
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

    render(<TaskTimer taskId="task-1" />);

    expect(screen.getByText("tasks:timer.resume")).toBeInTheDocument();
    expect(screen.getByText("00:01:00")).toBeInTheDocument();
  });
});
```

Run: `pnpm --filter @kaneo/web exec vitest run src/components/task/task-timer.test.tsx`
Expected: PASS, 4 testes.

- [ ] **Step 4: Montar na sidebar de propriedades**

Leia `apps/web/src/components/task/task-properties-sidebar.tsx` e insira `<TaskTimer taskId={task.id} />` como uma linha de propriedade, seguindo exatamente o padrão de rótulo e espaçamento usado pelas linhas vizinhas (assignee, due date, priority).

- [ ] **Step 5: Verificar no navegador**

Com API e web no ar, abra uma tarefa em `http://localhost:5173`. Confirme, nesta ordem: o contador aparece em `00:00:00`; **Iniciar** faz o número correr de segundo em segundo; **Pausar** congela; **Retomar** volta a correr do ponto em que parou; recarregar a página (F5) mantém o tempo correto; **Encerrar** zera o controle para aquela tarefa.

- [ ] **Step 6: Commit**

```bash
pnpm --filter @kaneo/web exec vitest run src/components/task/task-timer.test.tsx
pnpm --filter @kaneo/web exec tsc --noEmit
pnpm exec biome ci .
git add apps/web/src/components/task i18n
git commit -m "feat(web): componente TaskTimer na pagina da tarefa"
```

---

### Task 8: Barra global de timers abertos

**Files:**
- Create: `apps/web/src/components/time-entry/active-timers-bar.tsx`
- Modify: `apps/web/src/components/common/layout.tsx:70-71`, `i18n/en-US.json`, `i18n/pt-BR.json`

**Interfaces:**
- Consumes: `useActiveTimers`, `useElapsedSeconds`, `formatDuration` (exportada de `task-timer.tsx` na Task 7), e os hooks de pause/stop.
- Produces: componente `ActiveTimersBar`, export default. Sem props.

- [ ] **Step 1: Adicionar a chave i18n**

Em `i18n/en-US.json`, dentro de `tasks.timer`: `"activeCount": "{{count}} open timer(s)"`.
Em `i18n/pt-BR.json`: `"activeCount": "{{count}} timer(s) aberto(s)"`.

Run: `pnpm i18n:check:fix && pnpm i18n:schema`

- [ ] **Step 2: Implementar a barra**

Crie `apps/web/src/components/time-entry/active-timers-bar.tsx`:

```ts
import { Link } from "@tanstack/react-router";
import { Pause, Play, Square } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDuration } from "@/components/task/task-timer";
import { Button } from "@/components/ui/button";
import usePauseTimer from "@/hooks/mutations/time-entry/use-pause-timer";
import useStartTimer from "@/hooks/mutations/time-entry/use-start-timer";
import useStopTimer from "@/hooks/mutations/time-entry/use-stop-timer";
import useActiveTimers from "@/hooks/queries/time-entry/use-active-timers";
import { useElapsedSeconds } from "@/hooks/use-elapsed-seconds";

type ActiveTimerRowProps = {
  entry: {
    id: string;
    taskId: string;
    taskTitle: string;
    projectId: string;
    workspaceId: string;
    duration: number | null;
    runningSince: string | null;
    isRunning: boolean;
  };
  clockSkewMs: number;
};

function ActiveTimerRow({ entry, clockSkewMs }: ActiveTimerRowProps) {
  const { mutateAsync: startTimer } = useStartTimer();
  const { mutateAsync: pauseTimer } = usePauseTimer();
  const { mutateAsync: stopTimer } = useStopTimer();

  const elapsed = useElapsedSeconds({
    duration: entry.duration,
    runningSince: entry.runningSince,
    clockSkewMs,
  });

  return (
    <div className="flex items-center gap-2">
      <Link
        to="/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId"
        params={{
          workspaceId: entry.workspaceId,
          projectId: entry.projectId,
          taskId: entry.taskId,
        }}
        className="max-w-40 truncate text-sm hover:underline"
      >
        {entry.taskTitle}
      </Link>

      <span className="font-mono text-sm tabular-nums">
        {formatDuration(elapsed)}
      </span>

      {entry.isRunning ? (
        <Button
          size="icon"
          variant="ghost"
          onClick={() => pauseTimer({ timeEntryId: entry.id, taskId: entry.taskId })}
        >
          <Pause className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          size="icon"
          variant="ghost"
          onClick={() => startTimer({ taskId: entry.taskId })}
        >
          <Play className="h-4 w-4" />
        </Button>
      )}

      <Button
        size="icon"
        variant="ghost"
        onClick={() => stopTimer({ timeEntryId: entry.id, taskId: entry.taskId })}
      >
        <Square className="h-4 w-4" />
      </Button>
    </div>
  );
}

export default function ActiveTimersBar() {
  const { t } = useTranslation();
  const { data } = useActiveTimers();

  const entries = data?.entries ?? [];

  if (entries.length === 0) {
    return null;
  }

  const clockSkewMs = data?.serverTime
    ? new Date(data.serverTime).getTime() - Date.now()
    : 0;

  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-border bg-card px-3 py-1.5">
      <span className="text-xs text-muted-foreground">
        {t("tasks:timer.activeCount", { count: entries.length })}
      </span>

      {entries.map((entry) => (
        <ActiveTimerRow
          key={entry.id}
          entry={entry}
          clockSkewMs={clockSkewMs}
        />
      ))}
    </div>
  );
}
```

> Confirme a rota exata do link comparando com `apps/web/src/routes/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/task/$taskId_.tsx`; o `to` deve casar com a rota tipada gerada em `routeTree.gen.ts`.

- [ ] **Step 3: Montar no layout**

Em `apps/web/src/components/common/layout.tsx`, importe o componente e renderize-o logo após `{isDemoMode && <DemoAlert />}` (linha 70):

```ts
          {isDemoMode && <DemoAlert />}
          <ActiveTimersBar />
          {children}
```

- [ ] **Step 4: Verificar no navegador**

Inicie timers em **duas tarefas diferentes**. Confirme: a barra aparece com os dois, ambos correndo em paralelo; navegar entre telas mantém a barra e os contadores; pausar pela barra mantém a linha visível com botão de retomar; encerrar remove a linha; com nenhum timer aberto a barra **desaparece por completo**.

- [ ] **Step 5: Commit**

```bash
pnpm --filter @kaneo/web exec tsc --noEmit
pnpm exec biome ci .
git add apps/web/src/components i18n
git commit -m "feat(web): barra global de timers abertos"
```

---

### Task 9: Campos de conclusão e estimativa na tarefa

**Files:**
- Create: `apps/web/src/components/task/task-completed-at-popover.tsx`, `apps/web/src/components/task/task-estimate-popover.tsx`
- Modify: `apps/web/src/components/task/task-properties-sidebar.tsx`, `i18n/en-US.json`, `i18n/pt-BR.json`

**Interfaces:**
- Consumes: os campos `completedAt` e `estimatedSeconds` expostos pela Task 5.
- Produces: dois componentes de popover, ambos export default, com a mesma forma de `TaskDueDatePopover` (recebem `{ task, children }`).

- [ ] **Step 1: Adicionar as chaves i18n**

Em `i18n/en-US.json`, dentro de `tasks.popover`:

```json
"completedAt": {
  "label": "Completed at",
  "empty": "Not completed",
  "clear": "Clear date",
  "updateSuccess": "Completion date updated",
  "updateError": "Could not update the completion date",
  "futureError": "Completion date cannot be in the future"
},
"estimate": {
  "label": "Estimate",
  "empty": "No estimate",
  "hours": "Hours",
  "minutes": "Minutes",
  "save": "Save",
  "clear": "Clear estimate",
  "updateSuccess": "Estimate updated",
  "updateError": "Could not update the estimate"
}
```

Em `i18n/pt-BR.json`, no mesmo caminho, com: "Concluída em", "Não concluída", "Limpar data", "Data de conclusão atualizada", "Não foi possível atualizar a data de conclusão", "A data de conclusão não pode estar no futuro"; e "Estimativa", "Sem estimativa", "Horas", "Minutos", "Salvar", "Limpar estimativa", "Estimativa atualizada", "Não foi possível atualizar a estimativa".

Run: `pnpm i18n:check:fix && pnpm i18n:schema`

- [ ] **Step 2: Estender o tipo `Task` do frontend**

Em `apps/web/src/types/task/index.ts`, dentro do `type Task`, após `dueDate: string | null;`:

```ts
  completedAt: string | null;
  estimatedSeconds: number | null;
```

- [ ] **Step 3: Implementar o popover de conclusão**

Crie `apps/web/src/components/task/task-completed-at-popover.tsx`:

```tsx
import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useUpdateTask } from "@/hooks/mutations/task/use-update-task";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";

type TaskCompletedAtPopoverProps = {
  task: Task;
  children: React.ReactNode;
};

export default function TaskCompletedAtPopover({
  task,
  children,
}: TaskCompletedAtPopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const { mutateAsync: updateTask } = useUpdateTask();
  const { canManageTasks } = useWorkspacePermission();

  const handleDateChange = async (date: Date | undefined) => {
    try {
      await updateTask({
        ...task,
        completedAt: date?.toISOString() || null,
      });
      toast.success(t("tasks:popover.completedAt.updateSuccess"));
      setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:popover.completedAt.updateError"),
      );
    }
  };

  if (!canManageTasks()) return <>{children}</>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="p-0" align="start">
        <Calendar
          mode="single"
          selected={task.completedAt ? new Date(task.completedAt) : undefined}
          onSelect={handleDateChange}
          disabled={{ after: new Date() }}
          className="w-full bg-popover"
        />
        {task.completedAt && (
          <div className="pt-2 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
              onClick={() => handleDateChange(undefined)}
            >
              <X className="h-4 w-4" />
              {t("tasks:popover.completedAt.clear")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

O `disabled={{ after: new Date() }}` bloqueia datas futuras já na interface; a validação 400 do servidor (Task 5) continua sendo a garantia real.

- [ ] **Step 4: Implementar o popover de estimativa**

Crie `apps/web/src/components/task/task-estimate-popover.tsx`:

```tsx
import { X } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useUpdateTask } from "@/hooks/mutations/task/use-update-task";
import { useWorkspacePermission } from "@/hooks/use-workspace-permission";
import { toast } from "@/lib/toast";
import type Task from "@/types/task";

type TaskEstimatePopoverProps = {
  task: Task;
  children: React.ReactNode;
};

export default function TaskEstimatePopover({
  task,
  children,
}: TaskEstimatePopoverProps) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const total = task.estimatedSeconds ?? 0;
  const [hours, setHours] = useState(String(Math.floor(total / 3600)));
  const [minutes, setMinutes] = useState(
    String(Math.floor((total % 3600) / 60)),
  );
  const { mutateAsync: updateTask } = useUpdateTask();
  const { canManageTasks } = useWorkspacePermission();

  const save = async (estimatedSeconds: number | null) => {
    try {
      await updateTask({ ...task, estimatedSeconds });
      toast.success(t("tasks:popover.estimate.updateSuccess"));
      setOpen(false);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("tasks:popover.estimate.updateError"),
      );
    }
  };

  if (!canManageTasks()) return <>{children}</>;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64 space-y-3" align="start">
        <div className="flex gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="estimate-hours">
              {t("tasks:popover.estimate.hours")}
            </Label>
            <Input
              id="estimate-hours"
              type="number"
              min={0}
              value={hours}
              onChange={(event) => setHours(event.target.value)}
            />
          </div>
          <div className="flex-1 space-y-1">
            <Label htmlFor="estimate-minutes">
              {t("tasks:popover.estimate.minutes")}
            </Label>
            <Input
              id="estimate-minutes"
              type="number"
              min={0}
              max={59}
              value={minutes}
              onChange={(event) => setMinutes(event.target.value)}
            />
          </div>
        </div>

        <Button
          size="sm"
          className="w-full"
          onClick={() =>
            save(
              Math.max(0, Number(hours) || 0) * 3600 +
                Math.max(0, Number(minutes) || 0) * 60,
            )
          }
        >
          {t("tasks:popover.estimate.save")}
        </Button>

        {task.estimatedSeconds !== null && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 text-muted-foreground hover:text-foreground"
            onClick={() => save(null)}
          >
            <X className="h-4 w-4" />
            {t("tasks:popover.estimate.clear")}
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

> Confirme que `Input` e `Label` existem em `apps/web/src/components/ui/`; se os nomes divergirem, use os componentes equivalentes já usados em outro formulário do projeto.

- [ ] **Step 5: Montar ambos na sidebar**

Em `apps/web/src/components/task/task-properties-sidebar.tsx`, adicione duas linhas de propriedade seguindo o padrão das existentes: uma para conclusão (exibindo a data ou `tasks:popover.completedAt.empty`) e outra para estimativa (exibindo `Xh Ym` ou `tasks:popover.estimate.empty`), ao lado do total apontado pelo timer.

- [ ] **Step 6: Verificar no navegador**

Confirme, nesta ordem: mover a tarefa para **done** preenche a data de conclusão sozinha; editar essa data manualmente para um dia anterior persiste após recarregar; mover a tarefa de volta para *in-progress* limpa a data; concluir de novo preenche com a data atual; o calendário não permite selecionar datas futuras; salvar uma estimativa de 2h30 exibe `2h 30m` e sobrevive ao reload; limpar a estimativa volta para o texto vazio.

- [ ] **Step 7: Rodar a suíte completa e commitar**

```bash
pnpm exec vitest run tests/api --config apps/api/vitest.config.ts
pnpm --filter @kaneo/web exec vitest run
pnpm --filter @kaneo/web exec tsc --noEmit
pnpm exec biome ci .
git add apps/web/src/components/task apps/web/src/types/task i18n
git commit -m "feat(web): campos de data de conclusao e estimativa na tarefa"
```

---

### Task 10: Deploy do fork em produção

**Files:** nenhum arquivo do repositório.

**Interfaces:**
- Consumes: a branch `feat/task-timer` completa.
- Produces: `kaneo-fork:latest` rodando em `kaneo.willianramthun.store`.

- [ ] **Step 1: Publicar a branch**

```bash
git push -u origin feat/task-timer
```

- [ ] **Step 2: Fazer backup do banco de produção**

```bash
ssh coolify 'C=postgres-a11gy6lnp60jnss2elsv0h64; docker exec $C sh -c "pg_dump -U \$POSTGRES_USER -d \$POSTGRES_DB" | gzip > /root/backups/kaneo-pre-timer-$(date +%Y%m%d-%H%M).sql.gz; ls -lh /root/backups/ | tail -2'
```

- [ ] **Step 3: Buildar a imagem na VPS a partir da branch**

```bash
ssh coolify 'setsid nohup /root/build-kaneo-fork.sh feat/task-timer > /root/kaneo-build.log 2>&1 < /dev/null &'
```

Acompanhe com `ssh coolify 'tail -5 /root/kaneo-build.log'` até aparecer `BUILD OK` (~2 min).

- [ ] **Step 4: Apontar o compose para a imagem do fork**

No painel do Coolify, no service `kaneo` do projeto `gestao-projetos`, editar o Docker Compose: trocar `image: 'ghcr.io/usekaneo/kaneo:2.17.1'` por `image: 'kaneo-fork:latest'` e adicionar, no mesmo serviço, `pull_policy: never` (impede o Coolify de tentar puxar do registry uma tag que só existe localmente). Salvar e redeployar.

- [ ] **Step 5: Verificar o deploy**

```bash
ssh coolify 'docker inspect kaneo-a11gy6lnp60jnss2elsv0h64 --format "{{.Config.Image}} | {{.State.Health.Status}} | restarts={{.RestartCount}}"'
ssh coolify 'docker logs kaneo-a11gy6lnp60jnss2elsv0h64 --since 5m 2>&1 | grep -iE "migrat|error" | head'
ssh coolify 'docker exec postgres-a11gy6lnp60jnss2elsv0h64 sh -c "psql -U \$POSTGRES_USER -d \$POSTGRES_DB -tAc \"select count(*) from drizzle.__drizzle_migrations\""'
```

Expected: imagem `kaneo-fork:latest`, `healthy`, sem erros nos logs, contagem de migrações **39** (era 38), e `https://kaneo.willianramthun.store` respondendo com o timer visível.

---

## Notas de rollback

Se o deploy falhar, voltar o compose para `image: 'ghcr.io/usekaneo/kaneo:2.17.1'` e redeployar. As três colunas novas são aditivas e nuláveis: a versão 2.17.1 as ignora e continua funcionando com os dados intactos. Restaurar o dump só é necessário se houver corrupção de dados, o que nenhuma operação deste plano provoca.
