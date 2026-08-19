import { HTTPException } from "hono/http-exception";
import { getVoiceInputConfig } from "../config";
import {
  buildTranscriptionPrompt,
  correctKnownTerms,
} from "../transcription-vocabulary";

const ASSEMBLYAI_BASE_URL = "https://api.assemblyai.com";

const GROQ_TRANSCRIPTION_URL =
  "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_MODEL = "whisper-large-v3-turbo";
// Groq transcription is a single synchronous call, so a request timeout is
// enough — there is no polling loop to bound.
const GROQ_REQUEST_TIMEOUT_MS = 120_000;

// Guards against a slow/misbehaving AssemblyAI job hanging the request
// indefinitely.
const POLL_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 3_000;

export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

// Keeps the surfaced upstream error message from bloating the response.
const MAX_ERROR_MESSAGE_LENGTH = 500;

type AssemblyAiUploadResponse = { upload_url: string };
type AssemblyAiTranscriptResponse = {
  id: string;
  status: "queued" | "processing" | "completed" | "error";
  text: string | null;
  error?: string;
};

type GroqTranscriptionResponse = { text?: string };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function truncate(message: string): string {
  return message.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}...`
    : message;
}

async function uploadAudio(
  audio: ArrayBuffer,
  apiKey: string,
): Promise<string> {
  const response = await fetch(`${ASSEMBLYAI_BASE_URL}/v2/upload`, {
    method: "POST",
    headers: {
      authorization: apiKey,
      "content-type": "application/octet-stream",
    },
    body: audio,
  });

  if (!response.ok) {
    throw new HTTPException(502, {
      message: `Failed to upload audio to AssemblyAI (status ${response.status})`,
    });
  }

  const data = (await response.json()) as AssemblyAiUploadResponse;
  return data.upload_url;
}

async function requestTranscript(
  audioUrl: string,
  apiKey: string,
): Promise<string> {
  const response = await fetch(`${ASSEMBLYAI_BASE_URL}/v2/transcript`, {
    method: "POST",
    headers: {
      authorization: apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({ audio_url: audioUrl, language_code: "pt" }),
  });

  if (!response.ok) {
    throw new HTTPException(502, {
      message: `Failed to request transcription from AssemblyAI (status ${response.status})`,
    });
  }

  const data = (await response.json()) as AssemblyAiTranscriptResponse;
  return data.id;
}

async function pollTranscript(
  transcriptId: string,
  apiKey: string,
): Promise<string> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    const response = await fetch(
      `${ASSEMBLYAI_BASE_URL}/v2/transcript/${transcriptId}`,
      { headers: { authorization: apiKey } },
    );

    if (!response.ok) {
      console.error(
        `AssemblyAI transcript ${transcriptId} poll failed with status ${response.status}`,
      );
      throw new HTTPException(502, {
        message: `Failed to poll transcription status from AssemblyAI (status ${response.status})`,
      });
    }

    const data = (await response.json()) as AssemblyAiTranscriptResponse;

    if (data.status === "completed") {
      return data.text ?? "";
    }

    if (data.status === "error") {
      console.error(
        `AssemblyAI transcript ${transcriptId} failed: ${data.error ?? "unknown error"}`,
      );
      throw new HTTPException(502, {
        message: `AssemblyAI transcription failed: ${data.error ?? "unknown error"}`,
      });
    }

    await sleep(POLL_INTERVAL_MS);
  }

  console.error(`AssemblyAI transcript ${transcriptId} timed out`);
  throw new HTTPException(504, {
    message: "Timed out waiting for AssemblyAI transcription",
  });
}

async function transcribeWithAssemblyAi(
  audio: ArrayBuffer,
  apiKey: string,
): Promise<{ text: string }> {
  const uploadUrl = await uploadAudio(audio, apiKey);
  const transcriptId = await requestTranscript(uploadUrl, apiKey);
  const text = await pollTranscript(transcriptId, apiKey);

  return { text };
}

async function transcribeWithGroq(
  audio: ArrayBuffer,
  apiKey: string,
  vocabulary: string[],
): Promise<{ text: string }> {
  const form = new FormData();
  form.append("file", new Blob([audio]), "audio.webm");
  form.append("model", GROQ_MODEL);
  form.append("language", "pt");
  form.append("response_format", "json");
  // Dica de contexto: o Whisper trata esse texto como a fala anterior, entao
  // escrever ali os nomes proprios e o jargao do projeto torna a grafia certa
  // mais provavel ("Kaneo" em vez de "canel").
  form.append("prompt", buildTranscriptionPrompt(vocabulary));

  let response: Response;
  try {
    response = await fetch(GROQ_TRANSCRIPTION_URL, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(GROQ_REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Groq transcription request failed: ${message}`);
    throw new HTTPException(502, {
      message: truncate(`Groq transcription request failed: ${message}`),
    });
  }

  if (!response.ok) {
    const detail = truncate((await response.text()).trim());
    console.error(
      `Groq transcription failed with status ${response.status}: ${detail}`,
    );
    throw new HTTPException(502, {
      message: `Groq transcription failed (status ${response.status}): ${detail}`,
    });
  }

  const data = (await response.json()) as GroqTranscriptionResponse;
  return { text: data.text ?? "" };
}

async function transcribeAudio(
  audio: ArrayBuffer,
  vocabulary: string[] = [],
): Promise<{ text: string }> {
  if (audio.byteLength > MAX_UPLOAD_SIZE_BYTES) {
    throw new HTTPException(413, {
      message: `Audio file is too large (max ${MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)}MB)`,
    });
  }

  const { provider, apiKey } = getVoiceInputConfig();

  const result =
    provider === "groq"
      ? await transcribeWithGroq(audio, apiKey, vocabulary)
      : await transcribeWithAssemblyAi(audio, apiKey);

  // Segunda camada: o prompt torna a grafia certa mais provavel, mas nao
  // garante. A correcao roda sobre o texto ja transcrito e e deterministica.
  return { text: correctKnownTerms(result.text, vocabulary) };
}

export default transcribeAudio;
