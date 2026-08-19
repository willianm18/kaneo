import { describe, expect, it } from "vitest";

import {
  extractKeywords,
  rankSimilarTasks,
  selectSimilarForText,
} from "../../../apps/api/src/assistant/similar-tasks";

describe("extractKeywords", () => {
  it("descarta palavras vazias e fica com o que identifica o assunto", () => {
    const keywords = extractKeywords(
      "não conseguimos mexer no painel elétrico porque faltou o disjuntor",
    );

    expect(keywords).toContain("painel");
    expect(keywords).toContain("eletrico");
    expect(keywords).toContain("disjuntor");
    expect(keywords).not.toContain("no");
    expect(keywords).not.toContain("porque");
    expect(keywords).not.toContain("o");
  });

  it("mantem numero de equipamento, que costuma ser o que distingue o ativo", () => {
    expect(extractKeywords("barulho no compressor 2")).toContain("2");
    expect(extractKeywords("vazamento perto da prensa 4")).toContain("4");
  });

  it("normaliza acento e caixa para casar com o que esta gravado", () => {
    expect(extractKeywords("VEDAÇÃO da bomba")).toContain("vedacao");
  });

  it("nao repete a mesma palavra", () => {
    const keywords = extractKeywords("disjuntor, disjuntor e mais disjuntor");

    expect(keywords.filter((word) => word === "disjuntor")).toHaveLength(1);
  });
});

describe("rankSimilarTasks", () => {
  const tasks = [
    {
      id: "a",
      number: 7,
      title: "Painel elétrico",
      description: "Não conseguimos mexer no painel porque faltou o disjuntor.",
      status: "to-do",
    },
    {
      id: "b",
      number: 3,
      title: "Verificar compressor 2",
      description: "Barulho estranho no fim da tarde.",
      status: "to-do",
    },
    {
      id: "c",
      number: 1,
      title: "Vazamento de óleo na bomba 3",
      description: "Pingando no piso.",
      status: "done",
    },
  ];

  it("acha o chamado do mesmo assunto mesmo quando o titulo e generico", () => {
    const ranked = rankSimilarTasks(
      tasks,
      extractKeywords("o disjuntor do painel chegou mas ninguem instalou"),
    );

    expect(ranked[0]?.number).toBe(7);
  });

  it("pontua mais alto quem casa mais palavras", () => {
    const ranked = rankSimilarTasks(
      tasks,
      extractKeywords("barulho no compressor 2"),
    );

    expect(ranked[0]?.number).toBe(3);
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
  });

  it("descarta quem nao casa nada, em vez de devolver a lista inteira", () => {
    const ranked = rankSimilarTasks(
      tasks,
      extractKeywords("troca de lampada do refeitorio"),
    );

    expect(ranked).toHaveLength(0);
  });

  it("devolve no maximo os tres mais parecidos, para nao inchar o prompt", () => {
    const muitas = Array.from({ length: 10 }, (_, index) => ({
      id: `t${index}`,
      number: index,
      title: "Vazamento na bomba",
      description: "vazamento",
      status: "to-do",
    }));

    expect(rankSimilarTasks(muitas, ["vazamento", "bomba"])).toHaveLength(3);
  });
});

describe("selectSimilarForText", () => {
  const tasks = [
    {
      id: "a",
      number: 7,
      title: "Painel elétrico",
      description: "Não conseguimos mexer no painel porque faltou o disjuntor.",
      status: "to-do",
    },
    {
      id: "b",
      number: 6,
      title: "Verificar compressor 2",
      description: "Barulho estranho no fim da tarde.",
      status: "to-do",
    },
    {
      id: "c",
      number: 1,
      title: "Vazamento de óleo na bomba 3",
      description: "Pingando no piso, operador escorregou.",
      status: "done",
    },
  ];

  const falaDeTurno =
    "fechamento do turno: olhamos o compressor 2, era folga na correia, o barulho sumiu; " +
    "o disjuntor do painel chegou mas ninguem instalou ainda; " +
    "e apareceu vazamento novo na linha de ar comprimido perto da prensa 4";

  it("acha o chamado de cada item da fala, e nao so os do assunto dominante", () => {
    const numbers = selectSimilarForText(tasks, falaDeTurno).map(
      (task) => task.number,
    );

    expect(numbers).toContain(6);
    expect(numbers).toContain(7);
  });

  it("nao repete o mesmo chamado quando ele casa com mais de um item", () => {
    const numbers = selectSimilarForText(
      tasks,
      "compressor 2; compressor 2 de novo",
    ).map((task) => task.number);

    expect(numbers.filter((number) => number === 6)).toHaveLength(1);
  });

  it("devolve vazio quando nada casa", () => {
    expect(
      selectSimilarForText(tasks, "troca de lampada do refeitorio"),
    ).toEqual([]);
  });
});
