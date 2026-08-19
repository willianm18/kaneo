import { describe, expect, it } from "vitest";

import { collectTools } from "../../../apps/api/src/assistant/collect-tools";
import { selectToolsForConversation } from "../../../apps/api/src/assistant/select-tools";

const allTools = collectTools("http://localhost:1337", "token");
const namesOf = (text: string) =>
  selectToolsForConversation(allTools, text).map((tool) => tool.name);

describe("selectToolsForConversation", () => {
  it("mantem as ferramentas de tarefa mesmo quando a conversa nao diz nada", () => {
    const names = namesOf("");

    for (const core of [
      "whoami",
      "list_tasks",
      "get_task",
      "create_task",
      "update_task",
      "update_task_status",
      "search",
      "list_project_columns",
    ]) {
      expect(names).toContain(core);
    }
  });

  it("mantem create_task_comment no nucleo: relatar o que aconteceu e acao central, e a palavra 'comentario' nunca aparece numa fala de turno", () => {
    const names = namesOf(
      "fechando o turno: terminamos a troca da vedacao, o compressor 2 ficou fazendo barulho",
    );

    expect(names).toContain("create_task_comment");
  });

  it("nao manda as ferramentas de tempo quando ninguem falou de tempo", () => {
    const names = namesOf("abre um chamado sobre o vazamento na bomba 3");

    expect(names).not.toContain("create_time_entry");
    expect(names).not.toContain("start_task_timer");
  });

  it("manda as ferramentas de tempo quando a conversa fala de apontamento", () => {
    const names = namesOf("apontar 2 horas na tarefa de ontem");

    expect(names).toContain("create_time_entry");
    expect(names).toContain("list_task_time_entries");
  });

  it("reconhece o assunto sem acento e em caixa alta", () => {
    const names = namesOf("liga o CRONOMETRO dessa tarefa");

    expect(names).toContain("start_task_timer");
  });

  it("reconhece o assunto escrito com acento", () => {
    expect(namesOf("liga o cronômetro dessa tarefa")).toContain(
      "start_task_timer",
    );
    expect(namesOf("quanto tempo de duração ficou nessa tarefa?")).toContain(
      "list_task_time_entries",
    );
  });

  it("manda as ferramentas de etiqueta so quando o assunto aparece", () => {
    expect(namesOf("cria a tarefa de troca do rolamento")).not.toContain(
      "create_label",
    );
    expect(namesOf("coloca a etiqueta de urgente nessa tarefa")).toContain(
      "create_label",
    );
  });

  it("nao depende de o nucleo estar completo: seleciona com as que existirem", () => {
    const semUmaDoNucleo = allTools.filter(
      (tool) => tool.name !== "create_task_comment",
    );

    const names = selectToolsForConversation(
      semUmaDoNucleo,
      "abre um chamado do vazamento",
    ).map((tool) => tool.name);

    expect(names).toContain("create_task");
    expect(names).not.toContain("start_task_timer");
  });

  it("manda todas quando nenhum nome do nucleo existe mais (ferramentas renomeadas)", () => {
    const renomeadas = allTools
      .filter((tool) => !tool.name.startsWith("list_"))
      .map((tool) => ({ ...tool, name: `v2_${tool.name}` }));

    const names = selectToolsForConversation(renomeadas, "qualquer coisa").map(
      (tool) => tool.name,
    );

    expect(names).toEqual(renomeadas.map((tool) => tool.name));
  });

  it("devolve sempre um subconjunto das ferramentas, sem repetir", () => {
    const selected = selectToolsForConversation(
      allTools,
      "apontar tempo, etiqueta, comentario, relacao, notificacao, membro, projeto",
    );
    const names = selected.map((tool) => tool.name);

    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(allTools.map((tool) => tool.name)).toContain(name);
    }
  });

  it("corta pelo menos um terco das ferramentas numa conversa so de tarefa", () => {
    const names = namesOf("abre um chamado sobre o vazamento na bomba 3");

    expect(names.length).toBeLessThanOrEqual(
      Math.floor(allTools.length * 0.67),
    );
  });
});
