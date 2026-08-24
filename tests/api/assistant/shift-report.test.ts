import { describe, expect, it } from "vitest";

import {
  isShiftReport,
  splitReportItems,
} from "../../../apps/api/src/assistant/shift-report";

describe("isShiftReport", () => {
  it("reconhece a fala que se anuncia como relato", () => {
    for (const fala of [
      "O report de sexta-feira para cá: conversei com o Bruno...",
      "fechamento do turno da noite: olhamos o compressor 2",
      "fechando o turno, terminamos a vedação",
      "segue o relato do dia: ajustei o portal",
      "resumo do dia: falei com o Rafael",
      "passagem de turno: a prensa 4 parou",
      "daily: conversei com o Gustavo",
    ]) {
      expect(isShiftReport(fala)).toBe(true);
    }
  });

  it("nao trata um pedido comum como relato", () => {
    for (const fala of [
      "preciso trocar o rolamento da bomba 3. Ela está fazendo barulho. O operador reclamou",
      "Abra um chamado para verificar os itens duplicados no MetaX Acesso",
      "anota aí que o fornecedor ligou",
      "comenta na tarefa 29 que o Aldir não enviou nada",
    ]) {
      expect(isShiftReport(fala)).toBe(false);
    }
  });
});

describe("splitReportItems", () => {
  const relato =
    "O report de sexta para cá: na sexta à tarde conversei com o Bruno Dias sobre a melhoria da tela de login. " +
    "Também fiz o ajuste que o Gustavo solicitou no portal MetaX. " +
    "E hoje pela manhã estou conversando com o Rafael da Bracell sobre a integração do Rainbow. " +
    "E meu chamado sobre a duplicidade dos documentos do pedido ainda está em andamento.";

  it("separa cada assunto do relato", () => {
    const itens = splitReportItems(relato);

    expect(itens).toHaveLength(4);
    expect(itens[0]).toContain("Bruno Dias");
    expect(itens[1]).toContain("Gustavo");
    expect(itens[2]).toContain("Rainbow");
    expect(itens[3]).toContain("duplicidade");
  });

  it("descarta o cabecalho do relato, que nao e um item", () => {
    expect(splitReportItems(relato)[0]).not.toContain("report de sexta");
  });

  it("descarta fragmento curto demais para virar registro", () => {
    const itens = splitReportItems(
      "fechamento de turno: ok. a prensa 4 voltou a funcionar depois da troca do sensor. beleza",
    );

    expect(itens).toHaveLength(1);
    expect(itens[0]).toContain("prensa 4");
  });
});
