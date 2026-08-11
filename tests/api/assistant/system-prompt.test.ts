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
});
