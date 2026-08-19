import { describe, expect, it } from "vitest";

import {
  buildTranscriptionPrompt,
  correctKnownTerms,
} from "../../../apps/api/src/assistant/transcription-vocabulary";

describe("buildTranscriptionPrompt", () => {
  it("sempre inclui o nome do produto, que o modelo de audio nao conhece", () => {
    expect(buildTranscriptionPrompt([])).toContain("Kaneo");
  });

  it("inclui os termos do projeto, que sao o vocabulario de quem fala", () => {
    const prompt = buildTranscriptionPrompt([
      "compressor",
      "disjuntor",
      "prensa",
    ]);

    expect(prompt).toContain("compressor");
    expect(prompt).toContain("disjuntor");
    expect(prompt).toContain("prensa");
  });

  it("nao repete termo e ignora vazio", () => {
    const prompt = buildTranscriptionPrompt(["bomba", "bomba", "", "  "]);

    expect(prompt.match(/bomba/g)).toHaveLength(1);
  });

  it("respeita o limite do campo: o Whisper so considera o inicio do prompt", () => {
    const muitos = Array.from({ length: 500 }, (_, i) => `termo${i}`);

    expect(buildTranscriptionPrompt(muitos).length).toBeLessThanOrEqual(700);
  });
});

describe("correctKnownTerms", () => {
  it("corrige o nome do produto ouvido errado", () => {
    expect(correctKnownTerms("abre um chamado no canel", ["Kaneo"])).toBe(
      "abre um chamado no Kaneo",
    );
  });

  it("corrige mantendo a pontuacao em volta", () => {
    expect(correctKnownTerms("no canel, abre o chamado", ["Kaneo"])).toBe(
      "no Kaneo, abre o chamado",
    );
  });

  it("corrige respeitando a caixa da frase", () => {
    expect(correctKnownTerms("Canel esta lento", ["Kaneo"])).toBe(
      "Kaneo esta lento",
    );
  });

  it("nao mexe em palavra que ja esta certa", () => {
    expect(correctKnownTerms("abre no Kaneo", ["Kaneo"])).toBe("abre no Kaneo");
  });

  it("nao troca palavra apenas parecida de longe", () => {
    expect(correctKnownTerms("o canal de vendas ligou", ["Kaneo"])).toBe(
      "o canal de vendas ligou",
    );
  });

  it("corrige termo do projeto ouvido errado", () => {
    expect(correctKnownTerms("barulho no compresor 2", ["compressor"])).toBe(
      "barulho no compressor 2",
    );
  });
});

describe("collectVocabularyTerms", () => {
  it("tira os termos dos titulos das tarefas, do mais usado para o menos", async () => {
    const { collectVocabularyTerms } = await import(
      "../../../apps/api/src/assistant/transcription-vocabulary"
    );

    const terms = collectVocabularyTerms([
      "Verificar compressor 2",
      "Trocar correia do compressor 2",
      "Vazamento na prensa 4",
    ]);

    expect(terms[0]).toBe("compressor");
    expect(terms).toContain("prensa");
  });

  it("descarta palavra vazia e numero solto, que nao ajudam a grafia", async () => {
    const { collectVocabularyTerms } = await import(
      "../../../apps/api/src/assistant/transcription-vocabulary"
    );

    expect(collectVocabularyTerms(["Compressor 2", "3"])).toEqual([
      "compressor",
    ]);
  });

  it("limita a quantidade de termos", async () => {
    const { collectVocabularyTerms } = await import(
      "../../../apps/api/src/assistant/transcription-vocabulary"
    );

    const titulos = Array.from({ length: 100 }, (_, i) => `equipamento${i}`);

    expect(collectVocabularyTerms(titulos).length).toBeLessThanOrEqual(40);
  });
});
