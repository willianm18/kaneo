import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "../../../apps/api/src/assistant/controllers/run-assistant";

describe("buildSystemPrompt", () => {
  it("inclui o workspace id e o project id quando informados", () => {
    const prompt = buildSystemPrompt("ws-1", "proj-1");

    expect(prompt).toContain("ws-1");
    expect(prompt).toContain("proj-1");
  });

  it("nao quebra quando workspace/project nao sao informados", () => {
    const prompt = buildSystemPrompt();

    expect(prompt.length).toBeGreaterThan(0);
  });

  it("menciona os slugs padrao de status", () => {
    const prompt = buildSystemPrompt();

    for (const slug of [
      "to-do",
      "planned",
      "in-progress",
      "in-review",
      "done",
      "archived",
    ]) {
      expect(prompt).toContain(slug);
    }
  });

  it("instrui a resolver colunas customizadas via list_project_columns", () => {
    const prompt = buildSystemPrompt();

    expect(prompt).toContain("list_project_columns");
  });

  it("instrui a resolver identificadores <slug>-<numero> via o campo number", () => {
    const prompt = buildSystemPrompt();

    expect(prompt).toContain("<project-slug>-<task number>");
    expect(prompt).toContain("number");
  });

  it("instrui a permanecer no projeto atual e nunca mutar tarefa de outro projeto", () => {
    const prompt = buildSystemPrompt();

    expect(prompt.toLowerCase()).toContain("current project");
    expect(prompt.toLowerCase()).toContain("another project");
  });

  it("instrui a perguntar em vez de adivinhar o alvo de uma mutacao", () => {
    const prompt = buildSystemPrompt();

    expect(prompt.toLowerCase()).toContain("do not guess");
    expect(prompt.toLowerCase()).toContain("ask a clarifying question");
  });

  it("inclui a data/hora atual informada, em ISO 8601 com offset", () => {
    const fixedNow = new Date("2026-03-15T10:30:00.000Z");

    const prompt = buildSystemPrompt(undefined, undefined, fixedNow);

    expect(prompt).toContain(fixedNow.toISOString());
  });

  it("usa new Date() por padrao quando nenhuma data e informada", () => {
    const before = Date.now();
    const prompt = buildSystemPrompt();
    const after = Date.now();

    const match = prompt.match(/(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)/);
    expect(match).not.toBeNull();
    const promptTime = new Date(match?.[1] ?? "").getTime();
    expect(promptTime).toBeGreaterThanOrEqual(before);
    expect(promptTime).toBeLessThanOrEqual(after);
  });

  it("instrui a resolver datas relativas e datas sem ano contra a data atual, nunca por memoria", () => {
    const prompt = buildSystemPrompt();

    expect(prompt.toLowerCase()).toContain("relative date");
    expect(prompt.toLowerCase()).toContain("without a year");
    expect(prompt.toLowerCase()).toContain("nearest sensible occurrence");
    expect(prompt.toLowerCase()).toContain("training data");
  });

  it("instrui a sempre reportar o resultado da chamada de ferramenta mais recente, nunca dados antigos da conversa", () => {
    const prompt = buildSystemPrompt();

    expect(prompt.toLowerCase()).toContain("most recent tool call");
    expect(prompt.toLowerCase()).toContain(
      "never restate a value from an earlier message",
    );
  });

  it("instrui a estruturar a descricao do chamado com as tres secoes (por que, para quem, o que)", () => {
    const prompt = buildSystemPrompt();

    expect(prompt.toLowerCase()).toContain("why it matters");
    expect(prompt.toLowerCase()).toContain("who it matters to");
    expect(prompt.toLowerCase()).toContain("what is wanted");
  });

  it("instrui a criar o chamado imediatamente quando as tres secoes ja estao dadas, sem perguntar nada", () => {
    const prompt = buildSystemPrompt();

    expect(prompt.toLowerCase()).toContain("create the task immediately");
    expect(prompt.toLowerCase()).toContain("do not ask anything");
  });

  it("instrui a fazer no maximo uma pergunta consolidada, nunca uma sequencia de perguntas", () => {
    const prompt = buildSystemPrompt();

    expect(prompt.toLowerCase()).toContain(
      "ask exactly one consolidated question",
    );
    expect(prompt.toLowerCase()).toContain("one-question-at-a-time");
  });

  it("proibe texto de placeholder (ex.: 'a definir') em qualquer secao do chamado", () => {
    const prompt = buildSystemPrompt();

    expect(prompt.toLowerCase()).toContain("placeholder text");
    expect(prompt).toContain("a definir");
  });

  it("instrui a aplicar um status dito pelo usuario, mesmo no meio da frase, ao criar a tarefa", () => {
    const prompt = buildSystemPrompt();

    expect(prompt.toLowerCase()).toContain("mid-sentence");
    expect(prompt.toLowerCase()).toContain(
      "never silently fall back to the default column",
    );
  });

  it("instrui a distinguir pedido de registro de trabalho ja feito, com o trabalho feito como substancia", () => {
    const prompt = buildSystemPrompt();

    expect(prompt.toLowerCase()).toContain(
      "a record of work already completed",
    );
    expect(prompt.toLowerCase()).toContain("what was done");
    expect(prompt.toLowerCase()).toContain("what changed as a result");
    expect(prompt.toLowerCase()).toContain("what is still pending");
    expect(prompt.toLowerCase()).toContain("the substance of the card");
  });

  it("reconhece anotacao livre como um terceiro tipo, criada sem formato de secoes", () => {
    const prompt = buildSystemPrompt();

    expect(prompt.toLowerCase()).toContain("a free note");
    expect(prompt.toLowerCase()).toContain(
      "without forcing it into any section format",
    );
    expect(prompt.toLowerCase()).toContain("no headings and no fixed sections");
  });

  it("proibe perguntar quando a intencao e anotacao livre ou registro de trabalho feito", () => {
    const prompt = buildSystemPrompt();

    expect(prompt.toLowerCase()).toContain(
      "never ask when the intent is a free note",
    );
  });

  it("instrui a preservar o conteudo ditado na anotacao, sem inventar nem resumir", () => {
    const prompt = buildSystemPrompt();

    expect(prompt.toLowerCase()).toContain(
      "preserving everything the user said",
    );
    expect(prompt.toLowerCase()).toContain("do not invent");
  });
});
