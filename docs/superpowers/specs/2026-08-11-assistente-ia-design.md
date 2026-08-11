# Assistente de IA via OpenRouter — design

Data: 2026-08-11
Status: aprovado, pronto para plano de implementação

## Problema

Abrir um chamado e consultar o andamento exige conhecer a interface do Kaneo: achar o projeto,
a coluna certa, os campos. Para quem usa o sistema esporadicamente, isso é atrito suficiente
para o chamado não ser aberto — ou virar recado de corredor.

A proposta é conversar: "abre um chamado da prensa #4 que está falhando o relé" cria a tarefa,
e "o que vence essa semana?" responde sem navegar por telas.

## Estado atual do código

O Kaneo **já expõe cerca de 40 ferramentas MCP** em `apps/api/src/mcp/tools.ts` (957 linhas),
servidas em `/api/mcp` com OAuth: `create_task`, `update_task`, `update_task_status`,
`move_task`, `search`, `list_tasks`, `create_task_comment`, `create_time_entry`,
`list_workspace_members`, `list_projects`, `whoami`, entre outras.

Ponto decisivo: essas ferramentas **não contêm lógica de negócio**. `registerMcpTools(server,
baseUrl, token)` instancia um `ApiClient` que chama a própria API REST do Kaneo com
`Authorization: Bearer <token>`. São um invólucro HTTP sobre endpoints existentes.

Consequência: o assistente pode reaproveitá-las integralmente, sem duplicar nada, e as
permissões são respeitadas automaticamente — cada chamada vale o que o usuário daquele token
pode fazer.

Outros fatos relevantes:

- `zod` está na versão **4.4.3**, que traz `z.toJSONSchema()` nativo — os schemas das
  ferramentas viram definições no formato da OpenRouter sem biblioteca extra.
- `apps/api/src/utils/authenticate-api-request.ts` aceita **cookie de sessão ou Bearer**, então
  o executor interno pode repassar a sessão do usuário sem inventar credencial nova.
- Já existe sistema de atividades por tarefa, usado hoje para registrar mudanças de status.

## Decisões

Cada decisão foi escolhida explicitamente; a alternativa descartada fica registrada para que
uma releitura futura não reabra a discussão sem contexto.

**O laço do agente vive no backend.** Um endpoint recebe a conversa, chama a OpenRouter,
executa as ferramentas pedidas e repete até a resposta final. A alternativa era o navegador
conduzir o laço, com o backend apenas escondendo a chave — descartada porque cada volta viraria
ida e volta de rede e a lógica do agente ficaria difícil de testar.

**Todas as ferramentas ficam disponíveis, inclusive as destrutivas**, com confirmação antes de
executar exclusões. A alternativa era restringir o conjunto; o usuário preferiu manter o poder
e aceitar um clique a mais no caso raro.

**Uma chave da OpenRouter para toda a instância**, paga pelo dono. A alternativa — cada pessoa
com sua chave — foi descartada porque o atrito de criar conta faria o recurso morrer por falta
de uso.

**Conversa efêmera.** A consequência aceita é não poder reler o que foi pedido ontem; em troca,
não há tabela nova, migração, tela de histórico nem texto livre da equipe armazenado no banco.

**Modelo configurável por variável de ambiente**, com padrão barato. Trocar de modelo não deve
exigir alterar código e refazer deploy, justamente na fase de descobrir qual funciona melhor.

**Botão flutuante no canto** como superfície. A alternativa era um painel lateral com mais
espaço para listas de resultado; o usuário preferiu a bolha, padrão que a equipe reconhece.

## Fora de escopo

- **Histórico de conversas** e qualquer tela para relê-las.
- **Controle de consumo por usuário** (cotas, bloqueio por gasto). O teto é o limite da própria
  chave no painel da OpenRouter.
- **Escolha de modelo pelo usuário** dentro do chat.
- **Streaming** dos passos intermediários: o chat mostra a resposta quando o laço termina.
- **Abertura de chamado por WhatsApp ou Chatwoot.** Continua possível depois, reaproveitando
  este mesmo endpoint.

## Backend

Feature nova em `apps/api/src/assistant/`, seguindo o padrão do projeto: rota fina,
lógica em controllers, validação Valibot, `HTTPException` para erros.

### `POST /api/assistant/chat`

Body:

```ts
{
  messages: { role: "user" | "assistant"; content: string }[];
  workspaceId?: string;   // contexto da tela atual
  projectId?: string;
  confirmations?: { toolCallId: string }[];  // autorizações de exclusão
}
```

Resposta:

```ts
{
  reply: string;
  actions: { tool: string; summary: string; taskId?: string }[];
  pendingConfirmation?: {
    toolCallId: string;
    tool: string;
    description: string;   // legível: "apagar a tarefa #128 'Trocar relé'"
  };
}
```

### O laço

1. Monta as definições das ferramentas a partir dos schemas Zod de `mcp/tools.ts`,
   convertidos com `z.toJSONSchema()`.
2. Chama a OpenRouter com o histórico, as ferramentas e um system prompt que inclui o
   workspace e o projeto do contexto.
3. Se o modelo pedir ferramentas: executa cada uma, acrescenta os resultados à conversa e
   volta ao passo 2.
4. Se o modelo responder texto: devolve.

**Limite de 8 voltas.** Ao atingir, o laço para e responde que não conseguiu concluir. Sem esse
limite, um modelo confuso consome crédito indefinidamente.

### Execução das ferramentas e permissões

O executor repassa **o cookie de sessão da requisição original** ao `ApiClient`, de modo que
cada ferramenta chama a API do Kaneo como o próprio usuário. Nenhuma verificação de permissão
precisa ser reimplementada: quem não pode apagar uma tarefa continua não podendo, ainda que
peça à IA. Isso exige estender o `ApiClient` para aceitar um cabeçalho de autenticação pronto,
além do Bearer que ele já usa.

### Confirmação de exclusões

São destrutivas: `delete_task`, `delete_label`, `delete_task_comment`, `delete_task_relation`.

Ao encontrar uma delas, o servidor **interrompe o laço sem executar** e devolve
`pendingConfirmation` com uma descrição legível do que seria apagado. O cliente exibe e, se o
usuário autorizar, reenvia a mesma conversa com o `toolCallId` em `confirmations`.

O `toolCallId` é o identificador que o próprio modelo atribui à chamada de ferramenta (campo
`id` de cada item em `tool_calls`, no formato da API da OpenAI que a OpenRouter usa). O
servidor o devolve intacto e só executa a exclusão quando recebe de volta exatamente aquele
identificador — um valor divergente ou ausente nunca autoriza nada.

A confirmação vive no protocolo, não na disciplina do cliente.

## Frontend

**`AssistantBubble`** — botão flutuante no canto inferior direito, presente no layout
autenticado. Só é renderizado quando a instância tem o assistente habilitado.

**`AssistantChat`** — janela de conversa: mensagens, campo de envio, e as ações executadas
como linhas com link para a tarefa criada ou alterada. Envia `workspaceId` e `projectId` da
rota atual, para que "abre um chamado" caia no projeto que o usuário está vendo.

Quando a resposta traz `pendingConfirmation`, a janela mostra a descrição com os botões
confirmar e cancelar. Confirmar reenvia a conversa autorizando; cancelar apenas descarta.

Estado local do componente, sem persistência. Fechar a janela mantém a conversa enquanto a
aba viver; recarregar começa do zero.

## Configuração

| Variável | Efeito |
| --- | --- |
| `OPENROUTER_API_KEY` | Habilita o recurso. **Ausente: o assistente não existe** |
| `OPENROUTER_MODEL` | Modelo usado |

O valor padrão de `OPENROUTER_MODEL` **não é fixado nesta spec de propósito**: preços e
disponibilidade na OpenRouter mudam, e chutar de memória produziria um padrão errado. Quem
implementar deve consultar o catálogo da OpenRouter e escolher pelo critério: **suporte
confirmado a tool calling**, custo baixo por token, e latência aceitável para uso interativo.
Os candidatos citados pelo dono foram DeepSeek e GPT-4o-mini. O modelo escolhido e o motivo
devem ser registrados no relatório da implementação.

Um endpoint de configuração informa ao front se o assistente está habilitado, e o botão
flutuante só aparece nesse caso. Instalações que não configurarem a chave não veem diferença
alguma — nada quebra, nada aparece pela metade.

## Erros

Todos viram mensagem legível dentro do chat, nunca erro genérico de tela:

- OpenRouter indisponível ou lenta → aviso de indisponibilidade temporária
- Chave inválida ou sem crédito → aviso de problema de configuração
- Modelo sem suporte a ferramentas → aviso explícito, já que o sintoma seria o assistente
  conversar sem nunca executar nada
- Ferramenta negada por permissão → o resultado do erro volta ao modelo, que explica ao
  usuário o que não pôde fazer

Backend com `HTTPException`; frontend com toast (`sonner`) apenas para falhas de rede.

## Testes

Com a OpenRouter mockada, em `tests/api/assistant/`:

- Uma volta simples: o modelo pede `create_task`, a ferramenta executa, o laço responde.
- Duas voltas: consulta seguida de criação, verificando que o resultado da primeira entra
  na conversa da segunda.
- Destrutiva sem confirmação: o laço para, devolve `pendingConfirmation` e **não** executa.
- Destrutiva com o `toolCallId` correto: executa.
- Destrutiva com `toolCallId` divergente: não executa.
- Limite de voltas: um modelo que só pede ferramentas para em 8 e responde a mensagem de
  desistência.
- Permissão negada: o erro chega ao modelo em vez de derrubar a requisição.
- Sem `OPENROUTER_API_KEY`: o endpoint responde que o recurso está desabilitado.

Teste de componente do `AssistantChat` cobrindo o fluxo de confirmação, no padrão de
`task-timer.test.tsx` (com `afterEach(cleanup)`, pois este projeto não limpa automaticamente).

## Entrega

Desenvolvimento e verificação **locais** (API 1337, web 5173, Postgres 5433). O deploy vai
junto do próximo lote, pelo fluxo já estabelecido: `push` → `/root/build-kaneo-fork.sh`
publica no GHCR → Redeploy no Coolify.
