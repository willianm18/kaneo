import { describe, expect, it } from "vitest";

import {
  type DuplicateCandidate,
  findBlockingDuplicate,
} from "../../../apps/api/src/assistant/duplicate-guard";

const painel: DuplicateCandidate = {
  id: "t7",
  number: 7,
  title: "Painel elétrico",
  description: "Não conseguimos mexer no painel porque faltou o disjuntor.",
  status: "to-do",
  score: 3,
};

const compressor: DuplicateCandidate = {
  id: "t6",
  number: 6,
  title: "Verificar compressor 2",
  description: "Barulho estranho no fim da tarde.",
  status: "to-do",
  score: 4,
};

describe("findBlockingDuplicate", () => {
  it("aponta o chamado existente quando a nova tarefa e sobre a mesma coisa", () => {
    const found = findBlockingDuplicate(
      { title: "Instalação do disjuntor do painel", description: "" },
      [painel, compressor],
    );

    expect(found?.number).toBe(7);
  });

  it("nao bloqueia quando a nova tarefa e de outro assunto", () => {
    const found = findBlockingDuplicate(
      {
        title: "Vazamento na linha de ar comprimido perto da prensa 4",
        description: "Apareceu hoje.",
      },
      [painel, compressor],
    );

    expect(found).toBeNull();
  });

  it("exige mais de uma palavra em comum: uma palavra generica nao basta", () => {
    const found = findBlockingDuplicate(
      { title: "Verificar bomba de vácuo", description: "" },
      [
        {
          ...painel,
          title: "Verificar iluminação do galpão",
          description: "Lâmpadas queimadas.",
        },
      ],
    );

    expect(found).toBeNull();
  });

  it("distingue equipamentos pelo numero: compressor 3 nao e o compressor 2", () => {
    const found = findBlockingDuplicate(
      { title: "Verificar compressor 3", description: "Barulho." },
      [compressor],
    );

    expect(found).toBeNull();
  });

  it("nao bloqueia contra chamado ja fechado: o assunto voltou, e um caso novo", () => {
    const found = findBlockingDuplicate(
      { title: "Instalação do disjuntor do painel", description: "" },
      [{ ...painel, status: "done" }],
    );

    expect(found).toBeNull();
  });

  it("nao bloqueia quando nao ha candidato", () => {
    expect(
      findBlockingDuplicate({ title: "Qualquer coisa", description: "" }, []),
    ).toBeNull();
  });
});

describe("hasExplicitCreateRequest", () => {
  it("reconhece o pedido direto de abrir chamado", async () => {
    const { hasExplicitCreateRequest } = await import(
      "../../../apps/api/src/assistant/duplicate-guard"
    );

    for (const fala of [
      "Abra um chamado para verificar os itens duplicados no MetaX Acesso",
      "abre um chamado sobre o vazamento",
      "faça esse chamado conforme eu mencionei",
      "cria uma tarefa nova pra isso",
      "quero abrir um novo chamado",
      "registra um chamado disso aí",
    ]) {
      expect(hasExplicitCreateRequest(fala)).toBe(true);
    }
  });

  it("reconhece o pedido mesmo quando o ditado troca o verbo para o passado", async () => {
    const { hasExplicitCreateRequest } = await import(
      "../../../apps/api/src/assistant/duplicate-guard"
    );

    // "Crie uma tarefa" costuma voltar da transcricao como "Criei uma tarefa".
    for (const fala of [
      "Criei uma tarefa em progresso, carga Bracell Bahia Industrial",
      "abri um chamado sobre a carga do Rainbow",
      "registrei uma tarefa para o script de carga",
    ]) {
      expect(hasExplicitCreateRequest(fala)).toBe(true);
    }
  });

  it("nao confunde relato de turno com pedido de abrir chamado", async () => {
    const { hasExplicitCreateRequest } = await import(
      "../../../apps/api/src/assistant/duplicate-guard"
    );

    for (const fala of [
      "fechando o turno: terminamos a troca da vedação da bomba 3",
      "o disjuntor chegou mas ninguém instalou ainda",
      "anota aí que o fornecedor ligou",
    ]) {
      expect(hasExplicitCreateRequest(fala)).toBe(false);
    }
  });
});
