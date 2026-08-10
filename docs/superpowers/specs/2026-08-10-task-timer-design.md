# Timer de apontamento de horas — design

Data: 2026-08-10
Status: aprovado, pronto para plano de implementação

## Problema

Registrar quanto tempo se gasta em cada tarefa exige hoje calcular o intervalo na mão e lançar
um apontamento fechado. Falta o gesto natural: clicar para começar, pausar quando for
interrompido, retomar, e encerrar quando terminar.

## Estado atual do código

O backend já tem quase toda a fundação:

- Tabela `time_entry` com `taskId`, `userId`, `description`, `startTime` (obrigatório),
  `endTime` (nulo permitido), `duration` e timestamps. Índices em `task_id` e `user_id`.
- Controllers `create-time-entry`, `get-time-entries`, `get-time-entry`, `update-time-entry`.
- `create-time-entry` já grava `endTime: endTime || null` — criar uma entrada em aberto já é
  possível hoje.
- `duration` é expresso **em segundos** (`update-time-entry` calcula
  `Math.floor((endTime - startTime) / 1000)`).

O frontend tem fetchers, hooks e tipos em `apps/web/src/{fetchers,hooks,types}/time-entry/`,
mas **nenhuma tela os consome**. Não existe interface de apontamento. Não há dado legado:
a tabela `time_entry` está vazia em produção.

## Decisões

Cada decisão abaixo foi escolhida explicitamente; a alternativa descartada está registrada
para que uma releitura futura não reabra a discussão sem contexto.

**Uma entrada única que acumula, em vez de uma entrada por trecho trabalhado.**
Pausar não fecha o registro: congela o contador. A consequência aceita é que o histórico
não guarda em quais janelas do dia o trabalho aconteceu — sabe-se que deu 3h35, não que
foram 9h–10h30 e 11h15–12h.

**Timers paralelos são permitidos entre tarefas diferentes.**
Processos de chão de fábrica correm sozinhos enquanto outra atividade acontece. A
consequência aceita é que a soma das horas do dia pode ultrapassar as horas reais
trabalhadas — isso é intencional, não um defeito.

**Uma única entrada aberta por tarefa.** O paralelismo vale entre tarefas, nunca dentro da
mesma. Play e pause alternam sempre a mesma entrada até ela ser encerrada.

**O relógio é o do servidor.** O navegador só anima o contador. Toda gravação de tempo usa
o horário do servidor, para que um relógio errado na máquina do usuário não corrompa as horas.

**`duration` passa a ser o acumulado autoritativo** em vez de um valor derivado de
`endTime - startTime`. Viável sem migração de dados porque a tabela está vazia. Evita a
existência de dois totais concorrentes na mesma linha, que seria a origem natural de
relatórios divergentes.

## Fora de escopo

- **Tratamento de timer esquecido rodando** (corte automático após N horas, alerta de
  entrada suspeita). Decidido conscientemente: o problema pode não se manifestar no uso real.
  Se aparecer, entra numa entrega posterior.
- **Histórico das janelas de pausa.** Consequência direta do modelo acumulativo.
- **Relatórios e agregações** por projeto, período ou pessoa.
- **Controle do timer via MCP.** Fica para depois, junto do subsistema de IA.

## Schema

Uma coluna nova em `timeEntryTable` (`apps/api/src/database/schema.ts`), gerando a migração
`0038` via `pnpm --filter @kaneo/api db:generate`:

```ts
runningSince: timestamp("running_since", { mode: "date" }),
```

Os três estados derivam de campos existentes, sem coluna de status:

| Estado    | `running_since` | `end_time` |
| --------- | --------------- | ---------- |
| Rodando   | preenchido      | nulo       |
| Pausado   | nulo            | nulo       |
| Encerrado | nulo            | preenchido |

Tempo total corrente = `duration + (agora − running_since)` quando rodando; `duration`
nos demais casos.

Nenhum índice novo: os existentes em `task_id` e `user_id` atendem as consultas previstas.

`update-time-entry` precisa parar de recalcular `duration` a partir de
`endTime - startTime`, sob pena de sobrescrever o acumulado.

## API

Quatro rotas novas em `apps/api/src/time-entry/`, no padrão do projeto: handler fino,
lógica no controller, validação Valibot, `describeRoute` para OpenAPI. Todas exigem
autenticação e operam apenas sobre entradas do próprio `userId`.

### `POST /time-entry/task/:taskId/start`

Body: `{ description?: string }`

- Não existe entrada aberta para (usuário, tarefa) → cria com `startTime = agora`,
  `runningSince = agora`, `duration = 0`.
- Existe entrada aberta e pausada → grava `runningSince = agora`.
- Existe entrada aberta e já rodando → não faz nada e devolve a entrada (idempotente).

`startTime` registra o primeiro play da entrada e nunca é reescrito ao retomar: ele marca
quando o trabalho na tarefa começou, não quando o trecho atual começou.

Retorna a entrada.

### `POST /time-entry/:id/pause`

- Rodando → `duration += floor((agora − runningSince) / 1000)`, `runningSince = null`.
- Já pausada → não faz nada (idempotente).
- Já encerrada → `HTTPException 409`.

Retorna a entrada.

### `POST /time-entry/:id/stop`

- Rodando → acumula o trecho corrente e grava `endTime = agora`.
- Pausada → grava `endTime = agora`.
- Já encerrada → não faz nada (idempotente).

Retorna a entrada.

### `GET /time-entry/active`

Retorna as entradas **abertas** do usuário — `end_time` nulo, estejam elas rodando ou
pausadas — incluindo `taskId`, título da tarefa e os ids de projeto e workspace necessários
para navegar até ela. Cada item indica se está rodando (`running_since` não nulo).

Rodando e pausado vêm juntos de propósito: se a barra listasse apenas o que roda, pausar um
timer por ela o faria desaparecer, deixando o usuário sem como retomá-lo dali.

A resposta inclui `serverTime` (ISO 8601). O cliente calcula o desvio entre o próprio
relógio e o do servidor e aplica esse desvio ao animar os contadores, para que o tempo
exibido não divirja do que será gravado.

## Frontend

**`TaskTimer`** — na página da tarefa
(`apps/web/src/routes/_layout/_authenticated/.../task/$taskId_.tsx`). Botões Iniciar,
Pausar e Encerrar conforme o estado, contador de segundo em segundo e o total acumulado.
Ao montar, lê o estado da API: fechar o navegador não perde nada.

**`ActiveTimersBar`** — barra global montada no layout autenticado, visível em todas as
telas do dashboard. Lista as entradas abertas com tarefa, contador e ações: os que rodam
oferecem pausar e encerrar; os pausados oferecem retomar e encerrar. **Não renderiza nada
quando não há entrada aberta.** Sem arrastar, sem minimizar, sem estado de UI persistido —
é uma lista, não um widget.

Fetchers em `apps/web/src/fetchers/time-entry/` e hooks de mutação e query no padrão
existente. Após cada mutação, invalidar as queries de entradas da tarefa e de timers ativos,
para que a barra e a página da tarefa nunca discordem entre si.

## Erros

Backend com `HTTPException`, como no resto da API. Frontend com toast (`sonner`).

As operações são idempotentes de propósito: clique duplo, duas abas abertas ou uma
requisição repetida não devem produzir erro na tela nem tempo contado em dobro. O único
409 previsto é pausar uma entrada já encerrada, que indica estado realmente inconsistente.

## Testes

Testes unitários da API em `tests/api/`:

- Sequência `start → pause → start → stop`, verificando o acumulado final.
- Idempotência de cada operação (chamar duas vezes seguidas não altera o resultado).
- `pause` em entrada encerrada retorna 409.
- `start` numa tarefa que já tem entrada aberta retoma aquela entrada, sem criar outra.
- Timers simultâneos em tarefas distintas coexistem.

Teste de componente do `TaskTimer` com Vitest, no padrão de
`apps/web/src/components/kanban-board/task-labels.test.tsx`.

## Entrega

Desenvolvimento local com Postgres em Docker e `pnpm dev` (hot reload em API e web),
verificação no navegador pela skill `verify` do projeto, e só então push para o fork.

Na VPS, `/root/build-kaneo-fork.sh main` gera a imagem ARM64 nativa (~2 min) e o compose do
service passa a apontar para `kaneo-fork:latest`. A migração `0038` roda sozinha no start
da API, como as demais.
