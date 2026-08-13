import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real repo root .env may define ASSEMBLYAI_API_KEY for manual testing.
// `config()` from "../config" re-runs dotenv-mono on every fresh import
// (triggered below by vi.resetModules()), which would silently repopulate
// process.env.ASSEMBLYAI_API_KEY from that file and override the empty
// value a test sets to simulate "not configured". Stub it out so this file
// controls the env var exclusively.
vi.mock("dotenv-mono", () => ({ config: () => {} }));

const originalEnv = process.env.ASSEMBLYAI_API_KEY;
const originalFetch = global.fetch;

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
    process.env.ASSEMBLYAI_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.ASSEMBLYAI_API_KEY = originalEnv;
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
});
