import { HTTPException } from "hono/http-exception";
import { getVoiceInputConfig } from "../config";

const ASSEMBLYAI_BASE_URL = "https://api.assemblyai.com";

// Guards against a slow/misbehaving AssemblyAI job hanging the request
// indefinitely.
const POLL_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 3_000;

export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

type AssemblyAiUploadResponse = { upload_url: string };
type AssemblyAiTranscriptResponse = {
  id: string;
  status: "queued" | "processing" | "completed" | "error";
  text: string | null;
  error?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function transcribeAudio(audio: ArrayBuffer): Promise<{ text: string }> {
  if (audio.byteLength > MAX_UPLOAD_SIZE_BYTES) {
    throw new HTTPException(413, {
      message: `Audio file is too large (max ${MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)}MB)`,
    });
  }

  const { apiKey } = getVoiceInputConfig();

  const uploadUrl = await uploadAudio(audio, apiKey);
  const transcriptId = await requestTranscript(uploadUrl, apiKey);
  const text = await pollTranscript(transcriptId, apiKey);

  return { text };
}

export default transcribeAudio;
