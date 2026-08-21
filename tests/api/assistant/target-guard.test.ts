import { describe, expect, it } from "vitest";

import {
  asksForStatusChange,
  findAmbiguousTargets,
  mentionsTaskNumber,
} from "../../../apps/api/src/assistant/target-guard";

const metaxA = {
  id: "a",
  number: 28,
  title: "Separação dos portais MetaX Acesso",
  description: "Separar o portal MetaX do MetaX Acesso.",
  status: "to-do",
  score: 4,
};

const metaxB = {
  id: "b",
  number: 29,
  title: "Verificar itens duplicados no MetaX Acesso",
  description: "Documentos duplicados no pedido de compra.",
  status: "to-do",
  score: 4,
};

describe("mentionsTaskNumber", () => {
  it("reconhece o chamado citado pelo numero", () => {
    for (const fala of [
      "atualiza a tarefa 29",
      "comenta no chamado #17",
      "na MC-3 coloca que ficou pendente",
      "no card 1852 ja foi feito",
    ]) {
      expect(mentionsTaskNumber(fala)).toBe(true);
    }
  });

  it("nao inventa numero onde nao ha", () => {
    expect(
      mentionsTaskNumber("atualize o metax informando que avisamos o Aldir"),
    ).toBe(false);
  });

  it("nao confunde numero de equipamento com numero de chamado", () => {
    expect(mentionsTaskNumber("o compressor 2 voltou a fazer barulho")).toBe(
      false,
    );
  });
});

describe("findAmbiguousTargets", () => {
  it("acusa ambiguidade quando dois chamados disputam o mesmo pedido", () => {
    const ambiguous = findAmbiguousTargets("atualize o metax", [
      metaxA,
      metaxB,
    ]);

    expect(ambiguous?.map((task) => task.number)).toEqual([28, 29]);
  });

  it("nao acusa quando um candidato se destaca dos outros", () => {
    expect(
      findAmbiguousTargets("atualize o metax", [
        { ...metaxA, score: 6 },
        { ...metaxB, score: 2 },
      ]),
    ).toBeNull();
  });

  it("nao acusa quando a pessoa disse o numero", () => {
    expect(
      findAmbiguousTargets("atualize a tarefa 29 do metax", [metaxA, metaxB]),
    ).toBeNull();
  });

  it("nao acusa com um candidato so", () => {
    expect(findAmbiguousTargets("atualize o metax", [metaxA])).toBeNull();
  });
});

describe("asksForStatusChange", () => {
  it("reconhece o pedido de mover ou fechar", () => {
    for (const fala of [
      "pode fechar essa tarefa",
      "marca como concluída",
      "move para em andamento",
      "coloca em revisão",
      "muda o status para done",
      "terminamos a troca da vedação",
    ]) {
      expect(asksForStatusChange(fala)).toBe(true);
    }
  });

  it("nao ve pedido de status onde a pessoa so quer registrar algo", () => {
    for (const fala of [
      "atualize o metax informando que avisamos o Aldir e nada chegou",
      "anota aí que o fornecedor ligou",
      "comenta na tarefa que o prazo mudou",
    ]) {
      expect(asksForStatusChange(fala)).toBe(false);
    }
  });
});
