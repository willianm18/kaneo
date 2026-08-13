import type { Session } from "better-auth/types";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, validator } from "hono-openapi";
import * as v from "valibot";
import { resolveApiBaseUrl } from "../utils/resolve-api-base-url";
import {
  getAssistantConfig,
  isAssistantEnabled,
  isVoiceInputEnabled,
} from "./config";
import runAssistant from "./controllers/run-assistant";
import transcribeAudio, {
  MAX_UPLOAD_SIZE_BYTES,
} from "./controllers/transcribe";
import {
  signConversationState,
  verifyConversationState,
} from "./conversation-signature";

const assistant = new Hono<{
  Variables: { userId: string; session: Session | null };
}>()
  .post(
    "/chat",
    describeRoute({
      operationId: "assistantChat",
      tags: ["Assistant"],
      description: "Send a message to the Kaneo assistant",
      responses: {
        200: { description: "Assistant reply" },
        401: { description: "Authentication required" },
        404: { description: "Assistant is not enabled on this instance" },
      },
    }),
    validator(
      "json",
      v.object({
        messages: v.array(
          v.object({
            role: v.picklist(["user", "assistant"]),
            content: v.string(),
          }),
        ),
        workspaceId: v.optional(v.string()),
        projectId: v.optional(v.string()),
        confirmations: v.optional(v.array(v.string())),
        resumeFrom: v.optional(v.array(v.any())),
        // Required whenever resumeFrom is present — see the signature check
        // below. Never trust resumeFrom on its own: see conversation-signature.ts.
        conversationSignature: v.optional(v.string()),
      }),
    ),
    async (c) => {
      if (!isAssistantEnabled()) {
        throw new HTTPException(404, { message: "Assistant is not enabled" });
      }

      // The tools authenticate against Kaneo's own API as the requesting user,
      // so the token must be that user's Better Auth session token — never a
      // shared/admin credential — or the assistant could act beyond what the
      // caller is allowed to do. The `bearer()` plugin lets this same session
      // token be sent as `Authorization: Bearer <token>` on tool calls.
      const session = c.get("session");
      if (!session?.token) {
        throw new HTTPException(401, { message: "Unauthorized" });
      }
      const token = session.token;
      const authSecret = process.env.AUTH_SECRET || "";

      const {
        messages,
        workspaceId,
        projectId,
        confirmations,
        resumeFrom,
        conversationSignature,
      } = c.req.valid("json");

      // The server keeps no session store: resumeFrom + confirmations are
      // client-supplied and, without a signature, a caller could fabricate an
      // "assistant already asked to delete this and I already confirmed it"
      // conversation and skip the confirmation round-trip with the model
      // entirely. Requiring a valid HMAC over the exact state we handed back
      // closes that gap while staying stateless.
      if (
        resumeFrom !== undefined &&
        !verifyConversationState(resumeFrom, conversationSignature, authSecret)
      ) {
        throw new HTTPException(400, {
          message: "Missing or invalid conversationSignature for resumeFrom",
        });
      }

      const { apiKey, model } = getAssistantConfig();

      const result = await runAssistant({
        messages,
        resumeFrom,
        token,
        baseUrl: resolveApiBaseUrl(),
        apiKey,
        model,
        workspaceId,
        projectId,
        confirmations,
      });

      if (!result.conversationState) {
        return c.json(result);
      }

      return c.json({
        ...result,
        conversationSignature: signConversationState(
          result.conversationState,
          authSecret,
        ),
      });
    },
  )
  .post(
    "/transcribe",
    describeRoute({
      operationId: "assistantTranscribe",
      tags: ["Assistant"],
      description: "Transcribe an audio recording to text via AssemblyAI",
      responses: {
        200: { description: "Transcribed text" },
        400: { description: "Voice input is not enabled or audio is missing" },
        401: { description: "Authentication required" },
        413: { description: "Audio file is too large" },
      },
    }),
    async (c) => {
      if (!isVoiceInputEnabled()) {
        throw new HTTPException(400, { message: "Voice input is not enabled" });
      }

      const session = c.get("session");
      if (!session?.token) {
        throw new HTTPException(401, { message: "Unauthorized" });
      }

      // We check content-length upfront to reject oversized uploads without
      // buffering them into memory first (parseBody would already have read
      // the whole body by the time we could check its size).
      const contentLength = Number(c.req.header("content-length") ?? 0);
      if (contentLength > MAX_UPLOAD_SIZE_BYTES) {
        throw new HTTPException(413, {
          message: `Audio file is too large (max ${MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)}MB)`,
        });
      }

      const body = await c.req.parseBody();
      const audio = body.audio;

      if (!(audio instanceof File)) {
        throw new HTTPException(400, { message: "Missing audio file" });
      }

      const buffer = await audio.arrayBuffer();
      const result = await transcribeAudio(buffer);

      return c.json(result);
    },
  );

export default assistant;
