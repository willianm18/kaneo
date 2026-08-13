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

export function isVoiceInputEnabled(): boolean {
  return Boolean(process.env.ASSEMBLYAI_API_KEY);
}

export function getVoiceInputConfig(): { apiKey: string } {
  const apiKey = process.env.ASSEMBLYAI_API_KEY;

  if (!apiKey) {
    throw new Error("ASSEMBLYAI_API_KEY is not configured");
  }

  return { apiKey };
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
