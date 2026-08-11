import { createHmac, timingSafeEqual } from "node:crypto";

const ALGORITHM = "sha256";

/**
 * Deterministic JSON.stringify: object keys are sorted so the signature is
 * stable regardless of how the conversation state object was constructed.
 */
function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalStringify(entry)).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const entries = keys.map(
      (key) => `${JSON.stringify(key)}:${canonicalStringify(record[key])}`,
    );
    return `{${entries.join(",")}}`;
  }

  return JSON.stringify(value);
}

/**
 * Signs the conversation state the assistant route hands back to the client
 * alongside a `pendingConfirmation`. The server is stateless — nothing is
 * persisted — so the client is trusted to echo the state back verbatim as
 * `resumeFrom`. The HMAC lets the server detect if that state (or the
 * `confirmations` it is meant to be paired with) was tampered with before
 * trusting it as genuine prior provider output.
 */
export function signConversationState(state: unknown, secret: string): string {
  return createHmac(ALGORITHM, secret)
    .update(canonicalStringify(state))
    .digest("hex");
}

/**
 * Verifies a conversation state signature using a constant-time comparison.
 * Returns false (never throws) for a missing signature, a tampered state, or
 * malformed hex — all of those should be treated identically by the caller.
 */
export function verifyConversationState(
  state: unknown,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) {
    return false;
  }

  const expected = signConversationState(state, secret);

  try {
    const provided = Buffer.from(signature, "hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    if (provided.length !== expectedBuffer.length) {
      return false;
    }
    return timingSafeEqual(provided, expectedBuffer);
  } catch {
    return false;
  }
}
