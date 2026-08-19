import { resolveApiBaseUrl, windowId } from "@kaneo/libs";

export type TranscribeResponse = { text: string };

// Multipart upload, so this bypasses the RPC `client` (which forces
// `Content-Type: application/json` on every request — see
// packages/libs/src/hono.ts) and talks to the endpoint directly, letting the
// browser set the multipart boundary itself.
async function transcribeAudio(
  audio: Blob,
  // O projeto de onde sai o vocabulario da transcricao: os titulos das tarefas
  // dao os nomes de equipamento e o jargao que a pessoa usa ao ditar.
  projectId?: string,
): Promise<TranscribeResponse> {
  const baseUrl = resolveApiBaseUrl(import.meta.env.VITE_API_URL);
  const formData = new FormData();
  formData.append("audio", audio, "recording.webm");
  if (projectId) {
    formData.append("projectId", projectId);
  }

  const response = await fetch(`${baseUrl}/assistant/transcribe`, {
    method: "POST",
    credentials: "include",
    headers: { "X-Kaneo-Window-Id": windowId },
    body: formData,
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }

  return (await response.json()) as TranscribeResponse;
}

export default transcribeAudio;
