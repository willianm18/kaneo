import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real repo root .env may define ASSEMBLYAI_API_KEY for manual testing.
// `config()` from "../config" re-runs dotenv-mono on every fresh import
// (triggered below by vi.resetModules()), which would silently repopulate
// process.env.ASSEMBLYAI_API_KEY from that file and override the empty
// value a test sets to simulate "not configured". Stub it out so this file
// controls the env var exclusively.
vi.mock("dotenv-mono", () => ({ config: () => {} }));

const originalAssemblyKey = process.env.ASSEMBLYAI_API_KEY;
const originalGroqKey = process.env.GROQ_API_KEY;
const originalProvider = process.env.STT_PROVIDER;
const originalFetch = global.fetch;

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe("transcribeAudio", () => {
  beforeEach(() => {
    vi.resetModules();
    // Clear any vi.doMock left over from a previous test — doMock registrations
    // survive resetModules() and would otherwise leak the config stub into
    // later imports of the real config/controller modules.
    vi.doUnmock("../../../apps/api/src/assistant/config");
    process.env.ASSEMBLYAI_API_KEY = "test-key";
    delete process.env.GROQ_API_KEY;
    delete process.env.STT_PROVIDER;
  });

  afterEach(() => {
    restoreEnv("ASSEMBLYAI_API_KEY", originalAssemblyKey);
    restoreEnv("GROQ_API_KEY", originalGroqKey);
    restoreEnv("STT_PROVIDER", originalProvider);
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("faz upload, solicita e retorna a transcricao no caminho feliz", async () => {
    const fetchMock = vi
      .fn()
      // upload
      .mockResolvedValueOnce(
        jsonResponse({ upload_url: "https://cdn.assemblyai.com/upload/abc" }),
      )
      // request transcript
      .mockResolvedValueOnce(jsonResponse({ id: "transcript-1" }))
      // poll -> completed
      .mockResolvedValueOnce(
        jsonResponse({
          id: "transcript-1",
          status: "completed",
          text: "ola mundo",
        }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const { default: transcribeAudio } = await import(
      "../../../apps/api/src/assistant/controllers/transcribe"
    );

    const result = await transcribeAudio(new ArrayBuffer(10));

    expect(result).toEqual({ text: "ola mundo" });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const uploadCall = fetchMock.mock.calls[0];
    expect(uploadCall[0]).toBe("https://api.assemblyai.com/v2/upload");
    expect(uploadCall[1].headers.authorization).toBe("test-key");

    const transcriptCall = fetchMock.mock.calls[1];
    expect(transcriptCall[0]).toBe("https://api.assemblyai.com/v2/transcript");
    expect(JSON.parse(transcriptCall[1].body)).toEqual({
      audio_url: "https://cdn.assemblyai.com/upload/abc",
      language_code: "pt",
    });
  });

  it("lanca HTTPException quando o AssemblyAI retorna status error", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ upload_url: "https://cdn.assemblyai.com/upload/abc" }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: "transcript-2" }))
      .mockResolvedValueOnce(
        jsonResponse({
          id: "transcript-2",
          status: "error",
          text: null,
          error: "audio muito curto",
        }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    const { default: transcribeAudio } = await import(
      "../../../apps/api/src/assistant/controllers/transcribe"
    );

    await expect(transcribeAudio(new ArrayBuffer(10))).rejects.toMatchObject({
      status: 502,
    });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("transcript-2"),
    );
  });

  it("estoura por timeout quando o polling nunca completa", async () => {
    vi.useFakeTimers();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ upload_url: "https://cdn.assemblyai.com/upload/abc" }),
      )
      .mockResolvedValueOnce(jsonResponse({ id: "transcript-3" }))
      .mockResolvedValue(
        jsonResponse({
          id: "transcript-3",
          status: "processing",
          text: null,
        }),
      );
    global.fetch = fetchMock as unknown as typeof fetch;

    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const { default: transcribeAudio } = await import(
      "../../../apps/api/src/assistant/controllers/transcribe"
    );

    const promise = transcribeAudio(new ArrayBuffer(10));
    const assertion = expect(promise).rejects.toMatchObject({ status: 504 });

    // Avanca o tempo alem do limite de polling (120s) para acionar o timeout.
    await vi.advanceTimersByTimeAsync(130_000);

    await assertion;

    vi.useRealTimers();
  }, 15_000);

  it("lanca quando ASSEMBLYAI_API_KEY nao esta configurada", async () => {
    global.fetch = vi.fn() as unknown as typeof fetch;

    vi.doMock("../../../apps/api/src/assistant/config", () => ({
      getVoiceInputConfig: () => {
        throw new Error("ASSEMBLYAI_API_KEY is not configured");
      },
      isVoiceInputEnabled: () => false,
      getSttProvider: () => "assemblyai",
    }));

    const { default: transcribeAudio } = await import(
      "../../../apps/api/src/assistant/controllers/transcribe"
    );

    await expect(transcribeAudio(new ArrayBuffer(10))).rejects.toThrow(
      "ASSEMBLYAI_API_KEY is not configured",
    );
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rejeita audio maior que o limite antes de chamar a rede", async () => {
    global.fetch = vi.fn() as unknown as typeof fetch;

    const { default: transcribeAudio, MAX_UPLOAD_SIZE_BYTES } = await import(
      "../../../apps/api/src/assistant/controllers/transcribe"
    );

    const oversized = new ArrayBuffer(MAX_UPLOAD_SIZE_BYTES + 1);

    await expect(transcribeAudio(oversized)).rejects.toMatchObject({
      status: 413,
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  describe("provedor Groq", () => {
    beforeEach(() => {
      delete process.env.ASSEMBLYAI_API_KEY;
      process.env.GROQ_API_KEY = "groq-key";
      process.env.STT_PROVIDER = "groq";
    });

    it("faz uma unica chamada e retorna o texto no caminho feliz", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ text: "ola groq" }));
      global.fetch = fetchMock as unknown as typeof fetch;

      const { default: transcribeAudio } = await import(
        "../../../apps/api/src/assistant/controllers/transcribe"
      );

      const result = await transcribeAudio(new ArrayBuffer(10));

      expect(result).toEqual({ text: "ola groq" });
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const call = fetchMock.mock.calls[0];
      expect(call[0]).toBe(
        "https://api.groq.com/openai/v1/audio/transcriptions",
      );
      expect(call[1].headers.authorization).toBe("Bearer groq-key");
      expect(call[1].body).toBeInstanceOf(FormData);

      const form = call[1].body as FormData;
      expect(form.get("model")).toBe("whisper-large-v3-turbo");
      expect(form.get("language")).toBe("pt");
      expect(form.get("response_format")).toBe("json");
    });

    it("lanca HTTPException quando o Groq retorna erro", async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => "invalid audio",
      } as Response);
      global.fetch = fetchMock as unknown as typeof fetch;

      vi.spyOn(console, "error").mockImplementation(() => undefined);

      const { default: transcribeAudio } = await import(
        "../../../apps/api/src/assistant/controllers/transcribe"
      );

      await expect(transcribeAudio(new ArrayBuffer(10))).rejects.toMatchObject({
        status: 502,
      });
    });

    it("rejeita audio maior que o limite antes de chamar a rede", async () => {
      global.fetch = vi.fn() as unknown as typeof fetch;

      const { default: transcribeAudio, MAX_UPLOAD_SIZE_BYTES } = await import(
        "../../../apps/api/src/assistant/controllers/transcribe"
      );

      const oversized = new ArrayBuffer(MAX_UPLOAD_SIZE_BYTES + 1);

      await expect(transcribeAudio(oversized)).rejects.toMatchObject({
        status: 413,
      });
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe("isVoiceInputEnabled", () => {
    it("usa a chave do AssemblyAI quando nenhum provedor esta definido", async () => {
      process.env.ASSEMBLYAI_API_KEY = "test-key";
      delete process.env.GROQ_API_KEY;
      delete process.env.STT_PROVIDER;

      const { isVoiceInputEnabled } = await import(
        "../../../apps/api/src/assistant/config"
      );

      expect(isVoiceInputEnabled()).toBe(true);
    });

    it("fica desabilitado com STT_PROVIDER=groq e apenas a chave do AssemblyAI", async () => {
      process.env.ASSEMBLYAI_API_KEY = "test-key";
      delete process.env.GROQ_API_KEY;
      process.env.STT_PROVIDER = "groq";

      const { isVoiceInputEnabled } = await import(
        "../../../apps/api/src/assistant/config"
      );

      expect(isVoiceInputEnabled()).toBe(false);
    });

    it("fica habilitado com STT_PROVIDER=groq e a chave do Groq", async () => {
      delete process.env.ASSEMBLYAI_API_KEY;
      process.env.GROQ_API_KEY = "groq-key";
      process.env.STT_PROVIDER = "groq";

      const { isVoiceInputEnabled } = await import(
        "../../../apps/api/src/assistant/config"
      );

      expect(isVoiceInputEnabled()).toBe(true);
    });
  });
});
