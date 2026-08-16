import { config } from "dotenv-mono";

config();

/**
 * Default assistant model on OpenRouter ("vendor/model" form).
 *
 * Chosen 2026-08: openai/gpt-4o-mini. Tool calling support confirmed via
 * `supported_parameters` (includes "tools" and "tool_choice") on the
 * public OpenRouter catalogue (https://openrouter.ai/api/v1/models).
 * Price: $0.15 / 1M input tokens, $0.60 / 1M output tokens — cheaper than
 * the evaluated DeepSeek candidates for this app specifically, because
 * every call sends the schemas for Kaneo's 36 tools in the prompt, so
 * input cost dominates the per-call cost. It also has a longer
 * production track record for tool calling than the DeepSeek models
 * evaluated (deepseek-chat, deepseek-chat-v3.1, deepseek-v3.2).
 */
const DEFAULT_MODEL = "openai/gpt-4o-mini";

export function isAssistantEnabled(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

/**
 * Speech-to-text provider selection.
 *
 * Both backends coexist so the owner can A/B test transcription quality on
 * his own audio. `STT_PROVIDER` picks which one is active:
 *   - "assemblyai" (default): needs ASSEMBLYAI_API_KEY (unchanged behavior).
 *   - "groq": needs GROQ_API_KEY.
 * An unknown value falls back to the AssemblyAI default so an existing
 * setup with only ASSEMBLYAI_API_KEY keeps working exactly as before.
 */
export type SttProvider = "assemblyai" | "groq";

export function getSttProvider(): SttProvider {
  return process.env.STT_PROVIDER === "groq" ? "groq" : "assemblyai";
}

export function isVoiceInputEnabled(): boolean {
  if (getSttProvider() === "groq") {
    return Boolean(process.env.GROQ_API_KEY);
  }

  return Boolean(process.env.ASSEMBLYAI_API_KEY);
}

export type VoiceInputConfig = { provider: SttProvider; apiKey: string };

export function getVoiceInputConfig(): VoiceInputConfig {
  const provider = getSttProvider();

  if (provider === "groq") {
    const apiKey = process.env.GROQ_API_KEY;

    if (!apiKey) {
      throw new Error("GROQ_API_KEY is not configured");
    }

    return { provider, apiKey };
  }

  const apiKey = process.env.ASSEMBLYAI_API_KEY;

  if (!apiKey) {
    throw new Error("ASSEMBLYAI_API_KEY is not configured");
  }

  return { provider, apiKey };
}

export function getAssistantConfig(): { apiKey: string; model: string } {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }

  return {
    apiKey,
    model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
  };
}
