# Assistente de IA via OpenRouter — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um chat dentro do Kaneo que abre chamados e responde consultas em linguagem natural, executando as ferramentas que o MCP já expõe.

**Architecture:** O laço do agente vive no backend: um endpoint recebe a conversa, monta as ~40 ferramentas existentes a partir dos schemas Zod de `mcp/tools.ts`, chama a OpenRouter, executa as ferramentas pedidas com o token de sessão de quem conversa, e repete até a resposta final. Exclusões param o laço e exigem confirmação explícita. No front, um único componente de conversa é exibido como bolha ou painel.

**Tech Stack:** Hono, Valibot (rotas), Zod 4.4.3 (`z.toJSONSchema`), OpenRouter (API compatível com OpenAI), React 19, TanStack Query, Vitest.

## Global Constraints

- Spec de referência: `docs/superpowers/specs/2026-08-11-assistente-ia-design.md`.
- Branch de trabalho: `feat/task-timer` (a mesma; o deploy sai em lote com as pendências do timer).
- **Não alterar `apps/api/src/mcp/tools.ts`.** As ferramentas são reaproveitadas através da interface `McpToolRegistrar`, que já existe e basta. Se parecer necessário mudar aquele arquivo, pare e reporte.
- **Uma única implementação de conversa.** Bolha e painel são invólucros do mesmo `AssistantChat`. Duplicar o chat é proibido por este design.
- Permissões nunca são reimplementadas: cada ferramenta executa com o **token de sessão do usuário**, via o `ApiClient` que `registerMcpTools` já cria.
- Ferramentas destrutivas: `delete_task`, `delete_label`, `delete_task_comment`, `delete_task_relation`. Nunca executam sem o `toolCallId` correspondente em `confirmations`.
- Limite de **8 voltas** no laço.
- Sem `OPENROUTER_API_KEY`, o recurso não existe: o endpoint recusa e o botão não aparece.
- Conversa efêmera: nenhuma tabela, nenhuma migração.
- Convenções do `CLAUDE.md`: rota fina, lógica em controllers, Valibot na entrada, `HTTPException`, aspas duplas, ponto e vírgula, `type` em vez de `interface`.
- **Nenhuma string literal na UI**: i18next. Chaves em `i18n/en-US.json` e `i18n/pt-BR.json`, depois `pnpm i18n:check:fix` e `pnpm i18n:schema`.
- **Ambiente local** (não subir servidores; o controller os mantém): API `http://localhost:1337/api/health`, web `http://localhost:5173`, Postgres `localhost:5433`.
- Testes API: `pnpm --filter @kaneo/api exec vitest run --config vitest.config.ts ../../tests/api/`
- Testes web: `pnpm --filter @kaneo/web exec vitest run src/components/`
- Typecheck: `pnpm --filter @kaneo/api exec tsc --noEmit` e `pnpm --filter @kaneo/web exec tsc --noEmit`
- Antes de cada commit: `pnpm exec biome ci .` deve dizer `Found 0 errors` (77 warnings são baseline pré-existente).
- O pre-commit roda biome mais build completo (~20s). Deixe terminar.

## File Structure

**API — criar:**
- `apps/api/src/assistant/collect-tools.ts` — captura as ferramentas do MCP e converte para o formato da OpenRouter
- `apps/api/src/assistant/openrouter.ts` — cliente HTTP da OpenRouter, com tradução de erros
- `apps/api/src/assistant/controllers/run-assistant.ts` — o laço do agente e a regra de confirmação
- `apps/api/src/assistant/index.ts` — a rota
- `apps/api/src/assistant/config.ts` — leitura das variáveis de ambiente

**API — modificar:**
- `apps/api/src/utils/get-settings.ts` — expõe `hasAssistant`
- `apps/api/src/index.ts` — monta a rota `/assistant`

**Web — criar:**
- `apps/web/src/fetchers/assistant/send-message.ts`
- `apps/web/src/hooks/mutations/assistant/use-send-assistant-message.ts`
- `apps/web/src/components/assistant/assistant-chat.tsx` — a conversa (implementação única)
- `apps/web/src/components/assistant/assistant-launcher.tsx` — botão flutuante e os dois modos

**Web — modificar:**
- `apps/web/src/components/common/layout.tsx` — monta o launcher
- `i18n/en-US.json`, `i18n/pt-BR.json`

**Testes — criar:**
- `tests/api/assistant/collect-tools.test.ts`
- `tests/api/assistant/run-assistant.test.ts`
- `apps/web/src/components/assistant/assistant-chat.test.tsx`

---

### Task 1: Coletar as ferramentas e traduzi-las

**Files:**
- Create: `apps/api/src/assistant/collect-tools.ts`
- Test: `tests/api/assistant/collect-tools.test.ts`

**Interfaces:**
- Consumes: `registerMcpTools` e o tipo `McpToolRegistrar` de `apps/api/src/mcp/tools.ts`.
- Produces: `collectTools(baseUrl: string, token: string): CollectedTool[]` e `toOpenRouterTools(tools: CollectedTool[]): OpenRouterTool[]`, onde
  `type CollectedTool = { name: string; description: string; inputSchema: z.ZodObject; execute: (args: unknown) => Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }> }`.

- [ ] **Step 1: Escrever o teste que falha**

Crie `tests/api/assistant/collect-tools.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  collectTools,
  toOpenRouterTools,
} from "../../../apps/api/src/assistant/collect-tools";

describe("collectTools", () => {
  it("captura as ferramentas do MCP sem precisar de um servidor MCP", () => {
    const tools = collectTools("http://localhost:1337", "token-fake");

    expect(tools.length).toBeGreaterThan(30);
    const names = tools.map((t) => t.name);
    expect(names).toContain("create_task");
    expect(names).toContain("search");
    expect(names).toContain("whoami");
  });

  it("cada ferramenta traz descricao, schema e um executor", () => {
    const tools = collectTools("http://localhost:1337", "token-fake");
    const createTask = tools.find((t) => t.name === "create_task");

    expect(createTask).toBeDefined();
    expect(createTask?.description.length).toBeGreaterThan(0);
    expect(typeof createTask?.execute).toBe("function");
    expect(createTask?.inputSchema).toBeDefined();
  });
});

describe("toOpenRouterTools", () => {
  it("converte para o formato de function calling", () => {
    const tools = collectTools("http://localhost:1337", "token-fake");
    const converted = toOpenRouterTools(
      tools.filter((t) => t.name === "create_task"),
    );

    expect(converted).toHaveLength(1);
    expect(converted[0].type).toBe("function");
    expect(converted[0].function.name).toBe("create_task");
    expect(converted[0].function.parameters).toMatchObject({
      type: "object",
    });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @kaneo/api exec vitest run --config vitest.config.ts ../../tests/api/assistant/collect-tools.test.ts`
Expected: FAIL — módulo `collect-tools` não existe.

- [ ] **Step 3: Implementar**

Crie `apps/api/src/assistant/collect-tools.ts`:

```ts
import { z } from "zod";
import { registerMcpTools } from "../mcp/tools";

type McpToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

export type CollectedTool = {
  name: string;
  description: string;
  inputSchema: z.ZodObject;
  execute: (args: unknown) => Promise<McpToolResult>;
};

export type OpenRouterTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

/**
 * `registerMcpTools` espera apenas um objeto com `registerTool`. Passamos um
 * coletor no lugar do servidor MCP e ficamos com as mesmas ferramentas que o
 * MCP publica — sem duplicar definicao nem logica.
 */
export function collectTools(baseUrl: string, token: string): CollectedTool[] {
  const tools: CollectedTool[] = [];

  registerMcpTools(
    {
      registerTool: (name, config, callback) => {
        tools.push({
          name,
          description: config.description,
          inputSchema: config.inputSchema,
          execute: (args) => callback(args) as Promise<McpToolResult>,
        });
        return undefined;
      },
    },
    baseUrl,
    token,
  );

  return tools;
}

export function toOpenRouterTools(tools: CollectedTool[]): OpenRouterTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.inputSchema) as Record<string, unknown>,
    },
  }));
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @kaneo/api exec vitest run --config vitest.config.ts ../../tests/api/assistant/collect-tools.test.ts`
Expected: PASS, 3 testes.

> Se `z.toJSONSchema` reclamar de algum schema (por exemplo um `z.any()` sem forma), identifique a ferramenta pelo nome no erro e reporte — não remende o schema em `mcp/tools.ts`.

- [ ] **Step 5: Commit**

```bash
pnpm exec biome ci .
git add apps/api/src/assistant/collect-tools.ts tests/api/assistant/collect-tools.test.ts
git commit -m "feat(assistant): coletar as ferramentas do MCP para o formato OpenRouter"
```

---

### Task 2: Configuração e cliente da OpenRouter

**Files:**
- Create: `apps/api/src/assistant/config.ts`, `apps/api/src/assistant/openrouter.ts`
- Modify: `apps/api/src/utils/get-settings.ts`

**Interfaces:**
- Produces:
  - `isAssistantEnabled(): boolean`, `getAssistantConfig(): { apiKey: string; model: string }`
  - `callOpenRouter(params: { apiKey: string; model: string; messages: OpenRouterMessage[]; tools: OpenRouterTool[] }): Promise<OpenRouterMessage>`
  - `type OpenRouterMessage = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[]; tool_call_id?: string }`
- Consumes: `OpenRouterTool` da Task 1.

- [ ] **Step 1: Escolher o modelo padrão**

A spec deliberadamente não fixa o modelo. Consulte o catálogo da OpenRouter (https://openrouter.ai/models) e escolha por: **suporte confirmado a tool calling**, custo baixo por token, latência aceitável. Os candidatos indicados pelo dono são DeepSeek e GPT-4o-mini.

Anote no relatório qual escolheu e por quê. Use o identificador exato do catálogo (formato `fornecedor/modelo`).

- [ ] **Step 2: Implementar a configuração**

Crie `apps/api/src/assistant/config.ts`:

```ts
import { config } from "dotenv-mono";

config();

const DEFAULT_MODEL = "<identificador escolhido no Step 1>";

export function isAssistantEnabled(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

export function getAssistantConfig(): { apiKey: string; model: string } {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  return {
    apiKey,
    model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
  };
}
```

- [ ] **Step 3: Expor o flag para o frontend**

Em `apps/api/src/utils/get-settings.ts`, importe `isAssistantEnabled` de `../assistant/config` e acrescente ao objeto retornado, ao lado de `billingEnabled`:

```ts
    hasAssistant: isAssistantEnabled(),
```

- [ ] **Step 4: Implementar o cliente**

Crie `apps/api/src/assistant/openrouter.ts`:

```ts
import { HTTPException } from "hono/http-exception";
import type { OpenRouterTool } from "./collect-tools";

export type OpenRouterToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type OpenRouterMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenRouterToolCall[];
  tool_call_id?: string;
};

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

export async function callOpenRouter({
  apiKey,
  model,
  messages,
  tools,
}: {
  apiKey: string;
  model: string;
  messages: OpenRouterMessage[];
  tools: OpenRouterTool[];
}): Promise<OpenRouterMessage> {
  let response: Response;

  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, messages, tools, tool_choice: "auto" }),
    });
  } catch {
    throw new HTTPException(503, {
      message: "Assistant provider is unreachable",
    });
  }

  if (response.status === 401 || response.status === 403) {
    throw new HTTPException(500, {
      message: "Assistant credentials are invalid",
    });
  }

  if (response.status === 402) {
    throw new HTTPException(500, {
      message: "Assistant provider reported insufficient credit",
    });
  }

  if (!response.ok) {
    throw new HTTPException(503, {
      message: "Assistant provider returned an error",
    });
  }

  const data = (await response.json()) as {
    choices?: { message?: OpenRouterMessage }[];
  };

  const message = data.choices?.[0]?.message;

  if (!message) {
    throw new HTTPException(503, {
      message: "Assistant provider returned an empty response",
    });
  }

  return message;
}
```

- [ ] **Step 5: Typecheck e commit**

```bash
pnpm --filter @kaneo/api exec tsc --noEmit
pnpm exec biome ci .
git add apps/api/src/assistant apps/api/src/utils/get-settings.ts
git commit -m "feat(assistant): configuracao e cliente da OpenRouter"
```

---

### Task 3: O laço do agente e a confirmação de exclusões

**Files:**
- Create: `apps/api/src/assistant/controllers/run-assistant.ts`
- Test: `tests/api/assistant/run-assistant.test.ts`

**Interfaces:**
- Consumes: `collectTools`, `toOpenRouterTools` (Task 1); `callOpenRouter`, `OpenRouterMessage` (Task 2).
- Produces: `runAssistant(params): Promise<AssistantResult>` como export default, onde:

```ts
type RunAssistantParams = {
  messages: { role: "user" | "assistant"; content: string }[];
  token: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  workspaceId?: string;
  projectId?: string;
  confirmations?: string[];
};

type AssistantResult = {
  reply: string;
  actions: { tool: string; summary: string }[];
  pendingConfirmation?: { toolCallId: string; tool: string; description: string };
};
```

- [ ] **Step 1: Escrever os testes que falham**

Crie `tests/api/assistant/run-assistant.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCall = vi.fn();

vi.mock("../../../apps/api/src/assistant/openrouter", () => ({
  callOpenRouter: (...args: unknown[]) => mockCall(...args),
}));

const mockExecute = vi.fn();

vi.mock("../../../apps/api/src/assistant/collect-tools", () => ({
  collectTools: () => [
    {
      name: "create_task",
      description: "Create a task",
      inputSchema: {},
      execute: mockExecute,
    },
    {
      name: "delete_task",
      description: "Delete a task",
      inputSchema: {},
      execute: mockExecute,
    },
  ],
  toOpenRouterTools: () => [],
}));

import runAssistant from "../../../apps/api/src/assistant/controllers/run-assistant";

const base = {
  token: "t",
  baseUrl: "http://localhost:1337",
  apiKey: "k",
  model: "m",
  messages: [{ role: "user" as const, content: "oi" }],
};

function assistantText(content: string) {
  return { role: "assistant", content };
}

function assistantToolCall(id: string, name: string, args = "{}") {
  return {
    role: "assistant",
    content: null,
    tool_calls: [{ id, type: "function", function: { name, arguments: args } }],
  };
}

describe("runAssistant", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockExecute.mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
  });

  it("responde direto quando o modelo nao pede ferramenta", async () => {
    mockCall.mockResolvedValueOnce(assistantText("tudo certo"));

    const result = await runAssistant(base);

    expect(result.reply).toBe("tudo certo");
    expect(result.actions).toHaveLength(0);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it("executa a ferramenta e devolve a resposta final", async () => {
    mockCall
      .mockResolvedValueOnce(assistantToolCall("c1", "create_task"))
      .mockResolvedValueOnce(assistantText("criei a tarefa"));

    const result = await runAssistant(base);

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(result.reply).toBe("criei a tarefa");
    expect(result.actions).toEqual([
      expect.objectContaining({ tool: "create_task" }),
    ]);
  });

  it("NAO executa exclusao sem confirmacao e devolve pendingConfirmation", async () => {
    mockCall.mockResolvedValueOnce(assistantToolCall("c9", "delete_task"));

    const result = await runAssistant(base);

    expect(mockExecute).not.toHaveBeenCalled();
    expect(result.pendingConfirmation).toMatchObject({
      toolCallId: "c9",
      tool: "delete_task",
    });
  });

  it("executa a exclusao quando o toolCallId correto e confirmado", async () => {
    mockCall
      .mockResolvedValueOnce(assistantToolCall("c9", "delete_task"))
      .mockResolvedValueOnce(assistantText("apaguei"));

    const result = await runAssistant({ ...base, confirmations: ["c9"] });

    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(result.reply).toBe("apaguei");
  });

  it("NAO executa a exclusao quando o toolCallId confirmado e outro", async () => {
    mockCall.mockResolvedValueOnce(assistantToolCall("c9", "delete_task"));

    const result = await runAssistant({ ...base, confirmations: ["outro"] });

    expect(mockExecute).not.toHaveBeenCalled();
    expect(result.pendingConfirmation?.toolCallId).toBe("c9");
  });

  it("para no limite de 8 voltas", async () => {
    mockCall.mockResolvedValue(assistantToolCall("c1", "create_task"));

    const result = await runAssistant(base);

    expect(mockCall).toHaveBeenCalledTimes(8);
    expect(result.reply.length).toBeGreaterThan(0);
  });

  it("devolve o erro da ferramenta ao modelo em vez de estourar", async () => {
    mockExecute.mockResolvedValue({
      content: [{ type: "text", text: "permission denied" }],
      isError: true,
    });
    mockCall
      .mockResolvedValueOnce(assistantToolCall("c1", "create_task"))
      .mockResolvedValueOnce(assistantText("nao consegui: sem permissao"));

    const result = await runAssistant(base);

    expect(result.reply).toContain("sem permissao");
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `pnpm --filter @kaneo/api exec vitest run --config vitest.config.ts ../../tests/api/assistant/run-assistant.test.ts`
Expected: FAIL — módulo `run-assistant` não existe.

- [ ] **Step 3: Implementar o laço**

Crie `apps/api/src/assistant/controllers/run-assistant.ts`:

```ts
import { collectTools, toOpenRouterTools } from "../collect-tools";
import { callOpenRouter, type OpenRouterMessage } from "../openrouter";

const DESTRUCTIVE_TOOLS = new Set([
  "delete_task",
  "delete_label",
  "delete_task_comment",
  "delete_task_relation",
]);

const MAX_TURNS = 8;

export type RunAssistantParams = {
  messages: { role: "user" | "assistant"; content: string }[];
  token: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  workspaceId?: string;
  projectId?: string;
  confirmations?: string[];
};

export type AssistantResult = {
  reply: string;
  actions: { tool: string; summary: string }[];
  pendingConfirmation?: {
    toolCallId: string;
    tool: string;
    description: string;
  };
};

function buildSystemPrompt(workspaceId?: string, projectId?: string): string {
  const context = [
    workspaceId ? `Current workspace id: ${workspaceId}.` : null,
    projectId ? `Current project id: ${projectId}.` : null,
  ]
    .filter(Boolean)
    .join(" ");

  return [
    "You are the Kaneo assistant. You help the user manage tasks by calling the available tools.",
    "Prefer acting over asking: if the user asks to open a ticket, create the task with the information given.",
    "When the user does not name a project, use the current one from the context below.",
    "Answer in the same language the user writes in.",
    context,
  ]
    .filter(Boolean)
    .join(" ");
}

function toolResultText(result: {
  content: { type: "text"; text: string }[];
}): string {
  return result.content.map((part) => part.text).join("\n");
}

async function runAssistant({
  messages,
  token,
  baseUrl,
  apiKey,
  model,
  workspaceId,
  projectId,
  confirmations = [],
}: RunAssistantParams): Promise<AssistantResult> {
  const tools = collectTools(baseUrl, token);
  const toolDefinitions = toOpenRouterTools(tools);
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const conversation: OpenRouterMessage[] = [
    { role: "system", content: buildSystemPrompt(workspaceId, projectId) },
    ...messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];

  const actions: { tool: string; summary: string }[] = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const message = await callOpenRouter({
      apiKey,
      model,
      messages: conversation,
      tools: toolDefinitions,
    });

    if (!message.tool_calls?.length) {
      return { reply: message.content ?? "", actions };
    }

    conversation.push(message);

    for (const call of message.tool_calls) {
      const tool = byName.get(call.function.name);

      if (!tool) {
        conversation.push({
          role: "tool",
          tool_call_id: call.id,
          content: `Unknown tool: ${call.function.name}`,
        });
        continue;
      }

      if (
        DESTRUCTIVE_TOOLS.has(tool.name) &&
        !confirmations.includes(call.id)
      ) {
        return {
          reply: "",
          actions,
          pendingConfirmation: {
            toolCallId: call.id,
            tool: tool.name,
            description: `${tool.name} ${call.function.arguments}`,
          },
        };
      }

      let args: unknown = {};
      try {
        args = JSON.parse(call.function.arguments || "{}");
      } catch {
        conversation.push({
          role: "tool",
          tool_call_id: call.id,
          content: "Invalid tool arguments: not valid JSON",
        });
        continue;
      }

      const result = await tool.execute(args);
      const text = toolResultText(result);

      if (!result.isError) {
        actions.push({ tool: tool.name, summary: text.slice(0, 200) });
      }

      conversation.push({
        role: "tool",
        tool_call_id: call.id,
        content: text,
      });
    }
  }

  return {
    reply:
      "Nao consegui concluir dentro do limite de passos. Tente dividir o pedido em partes menores.",
    actions,
  };
}

export default runAssistant;
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `pnpm --filter @kaneo/api exec vitest run --config vitest.config.ts ../../tests/api/assistant/run-assistant.test.ts`
Expected: PASS, 7 testes.

- [ ] **Step 5: Commit**

```bash
pnpm --filter @kaneo/api exec tsc --noEmit
pnpm exec biome ci .
git add apps/api/src/assistant tests/api/assistant
git commit -m "feat(assistant): laco do agente com confirmacao de exclusoes"
```

---

### Task 4: A rota

**Files:**
- Create: `apps/api/src/assistant/index.ts`
- Modify: `apps/api/src/index.ts`

**Interfaces:**
- Consumes: `runAssistant` (Task 3), `isAssistantEnabled`/`getAssistantConfig` (Task 2).
- Produces: `POST /api/assistant/chat`.

- [ ] **Step 1: Descobrir como obter o token de sessão**

O `ApiClient` das ferramentas autentica com `Authorization: Bearer <token>`, e o Better Auth tem o plugin `bearer()` ativo (`apps/api/src/auth.ts:474`), então o **token de sessão** serve como Bearer.

Antes de escrever a rota, descubra como obtê-lo no contexto Hono: veja o que `c.get("session")` carrega (`apps/api/src/utils/authenticate-api-request.ts` faz `c.set("session", ...)`) e confirme se há um campo `token`. Se o token não estiver disponível ali, **pare e reporte** — não invente uma credencial alternativa nem use um token de outro usuário; isso quebraria o modelo de permissões que sustenta todo o design.

- [ ] **Step 2: Implementar a rota**

Crie `apps/api/src/assistant/index.ts`, seguindo o padrão das outras features (`describeRoute`, `validator`):

```ts
import { Hono } from "hono";
import { describeRoute, validator } from "hono-openapi";
import { HTTPException } from "hono/http-exception";
import * as v from "valibot";
import { getAssistantConfig, isAssistantEnabled } from "./config";
import runAssistant from "./controllers/run-assistant";

const assistant = new Hono<{
  Variables: { userId: string; session: unknown };
}>().post(
  "/chat",
  describeRoute({
    operationId: "assistantChat",
    tags: ["Assistant"],
    description: "Send a message to the Kaneo assistant",
    responses: {
      200: { description: "Assistant reply" },
    },
  }),
  validator(
    "json",
    v.object({
      messages: v.array(
        v.object({
          role: v.picklist(["user", "assistant"]),
          content: v.string(),
        }),
      ),
      workspaceId: v.optional(v.string()),
      projectId: v.optional(v.string()),
      confirmations: v.optional(v.array(v.string())),
    }),
  ),
  async (c) => {
    if (!isAssistantEnabled()) {
      throw new HTTPException(404, { message: "Assistant is not enabled" });
    }

    const { messages, workspaceId, projectId, confirmations } =
      c.req.valid("json");
    const { apiKey, model } = getAssistantConfig();

    const token = "<obtido conforme o Step 1>";

    const result = await runAssistant({
      messages,
      token,
      baseUrl: process.env.KANEO_API_URL || "http://localhost:1337",
      apiKey,
      model,
      workspaceId,
      projectId,
      confirmations,
    });

    return c.json(result);
  },
);

export default assistant;
```

Substitua `"<obtido conforme o Step 1>"` pela forma real descoberta. Confirme também qual variável de ambiente o projeto já usa para a própria URL da API — `apps/api/src/mcp/index.ts` monta esse valor para o MCP; **reutilize a mesma fonte** em vez de inventar outra.

- [ ] **Step 3: Montar a rota**

Em `apps/api/src/index.ts`, junto das outras (`api.route("/time-entry", timeEntry)` e vizinhas), acrescente o import e:

```ts
  const assistantApi = api.route("/assistant", assistant);
```

Siga exatamente o padrão das linhas ao redor, inclusive quanto ao encadeamento de tipos que o arquivo usa para o cliente RPC.

- [ ] **Step 4: Verificar contra a API rodando**

Run: `curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:1337/api/assistant/chat -H "Content-Type: application/json" -d '{"messages":[]}'`
Expected: `401` sem sessão (rota existe e exige autenticação). `404` significa que não foi montada.

- [ ] **Step 5: Commit**

```bash
pnpm --filter @kaneo/api exec tsc --noEmit
pnpm exec biome ci .
git add apps/api/src/assistant apps/api/src/index.ts
git commit -m "feat(assistant): rota POST /assistant/chat"
```

---

### Task 5: A conversa no frontend

**Files:**
- Create: `apps/web/src/fetchers/assistant/send-message.ts`, `apps/web/src/hooks/mutations/assistant/use-send-assistant-message.ts`, `apps/web/src/components/assistant/assistant-chat.tsx`
- Test: `apps/web/src/components/assistant/assistant-chat.test.tsx`
- Modify: `i18n/en-US.json`, `i18n/pt-BR.json`

**Interfaces:**
- Consumes: `POST /api/assistant/chat` (Task 4).
- Produces: `AssistantChat`, export default, sem props obrigatórias além de `workspaceId?` e `projectId?`. **É a única implementação de conversa** — a Task 6 apenas a posiciona.

- [ ] **Step 1: Adicionar as chaves i18n**

Em `i18n/en-US.json`, dentro do objeto de nível superior apropriado (siga onde `tasks` e `common` vivem), adicione um bloco `assistant`:

```json
"assistant": {
  "title": "Assistant",
  "placeholder": "Ask or describe what you need...",
  "send": "Send",
  "empty": "Ask me to open a ticket or check what is due.",
  "thinking": "Thinking...",
  "expand": "Expand",
  "collapse": "Collapse",
  "close": "Close",
  "confirmTitle": "Confirm deletion",
  "confirm": "Confirm",
  "cancel": "Cancel",
  "error": "Could not talk to the assistant"
}
```

Em `i18n/pt-BR.json`, no mesmo caminho: "Assistente", "Pergunte ou descreva o que precisa...", "Enviar", "Peça para abrir um chamado ou consultar o que vence.", "Pensando...", "Expandir", "Recolher", "Fechar", "Confirmar exclusão", "Confirmar", "Cancelar", "Não foi possível falar com o assistente".

Run: `pnpm i18n:check:fix && pnpm i18n:schema`

- [ ] **Step 2: Criar o fetcher**

Crie `apps/web/src/fetchers/assistant/send-message.ts`, seguindo o padrão dos fetchers existentes (cliente Hono RPC de `@kaneo/libs`; confira a forma exata em `apps/web/src/fetchers/time-entry/get-active-timers.ts`):

```ts
import { client } from "@kaneo/libs";

export type AssistantMessage = { role: "user" | "assistant"; content: string };

async function sendAssistantMessage(payload: {
  messages: AssistantMessage[];
  workspaceId?: string;
  projectId?: string;
  confirmations?: string[];
}) {
  const response = await client.assistant.chat.$post({ json: payload });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return await response.json();
}

export default sendAssistantMessage;
```

Se o TypeScript discordar da forma `client.assistant.chat.$post`, confie no tipo real do cliente e ajuste — reporte o desvio.

- [ ] **Step 3: Criar o hook**

Crie `apps/web/src/hooks/mutations/assistant/use-send-assistant-message.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import sendAssistantMessage from "@/fetchers/assistant/send-message";

function useSendAssistantMessage() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: sendAssistantMessage,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
  });
}

export default useSendAssistantMessage;
```

A invalidação existe porque o assistente cria e altera tarefas: sem ela, o quadro atrás do chat mostraria dados velhos.

- [ ] **Step 4: Implementar a conversa**

Crie `apps/web/src/components/assistant/assistant-chat.tsx`. Requisitos concretos:

- Estado local com a lista de mensagens (`AssistantMessage[]`) e o texto em digitação.
- Enviar acrescenta a mensagem do usuário, chama o hook com o histórico completo, e acrescenta a resposta.
- Enquanto a mutação está pendente, exibir `assistant.thinking`.
- Quando a resposta trouxer `pendingConfirmation`, renderizar um bloco com `assistant.confirmTitle`, a `description` recebida, e os botões `assistant.confirm` / `assistant.cancel`. Confirmar reenvia **a mesma conversa** com `confirmations: [toolCallId]`; cancelar apenas descarta o bloco.
- Quando a resposta trouxer `actions`, listar cada uma abaixo da mensagem.
- Erro da mutação: exibir `assistant.error` na conversa (não um toast, para não sumir).
- Sem mensagens: exibir `assistant.empty`.
- O componente **não** decide onde aparece: nada de posicionamento fixo, largura de tela ou z-index aqui. Ele preenche o contêiner que o pai der.

- [ ] **Step 5: Escrever o teste do fluxo de confirmação**

Crie `apps/web/src/components/assistant/assistant-chat.test.tsx`, mockando `use-send-assistant-message` (padrão de `task-timer.test.tsx`, incluindo `afterEach(cleanup)`), cobrindo:

1. Digitar e enviar exibe a resposta do assistente.
2. Uma resposta com `pendingConfirmation` renderiza o bloco de confirmação e **não** mostra resposta final.
3. Clicar em confirmar chama a mutação de novo incluindo `confirmations` com o `toolCallId` recebido.

Run: `pnpm --filter @kaneo/web exec vitest run src/components/assistant/`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
pnpm --filter @kaneo/web exec tsc --noEmit
pnpm exec biome ci .
git add apps/web/src/fetchers/assistant apps/web/src/hooks/mutations/assistant apps/web/src/components/assistant i18n
git commit -m "feat(web): conversa do assistente"
```

---

### Task 6: Bolha, painel e o botão de alternar

**Files:**
- Create: `apps/web/src/components/assistant/assistant-launcher.tsx`
- Modify: `apps/web/src/components/common/layout.tsx`
- Test: acrescentar ao `apps/web/src/components/assistant/assistant-chat.test.tsx`

**Interfaces:**
- Consumes: `AssistantChat` (Task 5), `useGetConfig` (hook existente em `apps/web/src/hooks/queries/`, que lê `/api/config`).
- Produces: `AssistantLauncher`, export default, sem props.

- [ ] **Step 1: Implementar o launcher**

Crie `apps/web/src/components/assistant/assistant-launcher.tsx`. Requisitos concretos:

- Lê a configuração da instância e **não renderiza nada** quando `hasAssistant` for falso.
- Botão flutuante no canto inferior direito quando fechado.
- Aberto, renderiza `AssistantChat` dentro de um de dois invólucros:
  - **bolha**: caixa no canto inferior direito, altura limitada
  - **painel**: coluna à direita, ocupando a altura da tela
- Um botão no cabeçalho alterna entre os modos (`assistant.expand` / `assistant.collapse`), e outro fecha (`assistant.close`).
- O modo é lido e gravado em `localStorage` na chave `kaneo:assistant-mode`, com valores `"bubble"` e `"panel"`; ausente ou inválido significa `"bubble"`.
- **Crítico:** `AssistantChat` é montado UMA vez e apenas reposicionado. Não renderize uma instância por modo, nem desmonte ao alternar — isso apagaria a conversa. Se a estrutura de estilos exigir árvores diferentes, eleve o estado da conversa em vez de duplicar o componente.

- [ ] **Step 2: Montar no layout**

Em `apps/web/src/components/common/layout.tsx`, renderize `<AssistantLauncher />` ao lado de `<ActiveTimersBar />`, dentro do mesmo contêiner do conteúdo autenticado.

- [ ] **Step 3: Testar que alternar preserva a conversa**

Acrescente ao arquivo de teste um caso que: renderiza o launcher aberto, envia uma mensagem, alterna o modo, e verifica que **a mensagem continua na tela**. Este teste é a garantia de que existe um único componente sendo reposicionado.

Run: `pnpm --filter @kaneo/web exec vitest run src/components/assistant/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
pnpm --filter @kaneo/web exec tsc --noEmit
pnpm exec biome ci .
git add apps/web/src/components/assistant apps/web/src/components/common/layout.tsx
git commit -m "feat(web): bolha e painel do assistente com alternancia"
```

---

### Task 7: Verificação de ponta a ponta

**Files:** nenhum arquivo do repositório (a menos que a verificação revele defeito).

**Interfaces:**
- Consumes: tudo das tasks anteriores.

- [ ] **Step 1: Configurar a chave**

Peça ao dono uma chave da OpenRouter e acrescente ao `.env` na raiz (ele é git-ignored):

```
OPENROUTER_API_KEY=<chave>
OPENROUTER_MODEL=<modelo escolhido na Task 2>
```

Reinicie a API para carregar as variáveis — **peça ao controller**, que é quem gerencia o processo.

- [ ] **Step 2: Confirmar que o recurso ligou**

Run: `curl -s http://localhost:1337/api/config | grep -o '"hasAssistant":[a-z]*'`
Expected: `"hasAssistant":true`

- [ ] **Step 3: Exercitar no navegador**

Confirme, nesta ordem, em `http://localhost:5173`:

1. O botão flutuante aparece
2. "abre um chamado de teste sobre a prensa" cria uma tarefa, e a ação aparece com link
3. A tarefa nasce no projeto que estava aberto (o contexto funcionou)
4. "quais tarefas estão em aberto?" responde consultando
5. Alternar entre bolha e painel **mantém** a conversa
6. Pedir para apagar a tarefa de teste **para na confirmação**; cancelar não apaga; confirmar apaga
7. Recarregar a página zera a conversa (efêmera, como especificado)

- [ ] **Step 4: Registrar o resultado**

Anote no relatório: o modelo usado, quantas voltas os pedidos consumiram, o custo aproximado das interações, e qualquer caso em que o modelo tenha errado os argumentos das ferramentas — isso indica se o modelo escolhido serve ou se vale testar outro (basta trocar a variável).

---

## Notas

**Deploy:** fica para o próximo lote, junto das pendências do timer, pelo fluxo já estabelecido: `push` → `/root/build-kaneo-fork.sh feat/task-timer` (publica no GHCR) → Redeploy no Coolify. Lembrar de definir `OPENROUTER_API_KEY` e `OPENROUTER_MODEL` nas variáveis do serviço no Coolify — sem elas o assistente simplesmente não aparece em produção, sem quebrar nada.

**Custo:** cada mensagem consome tokens proporcionais ao histórico mais as ~40 definições de ferramentas, que não são pequenas. Se o custo incomodar, o caminho é reduzir o conjunto de ferramentas enviado por chamada (por exemplo, filtrando por intenção) — mas só depois de medir, não antes.
