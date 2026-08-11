import type { Session } from "better-auth/types";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, validator } from "hono-openapi";
import * as v from "valibot";
import { getAssistantConfig, isAssistantEnabled } from "./config";
import runAssistant from "./controllers/run-assistant";

const assistant = new Hono<{
  Variables: { userId: string; session: Session | null };
}>().post(
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

    const { messages, workspaceId, projectId, confirmations, resumeFrom } =
      c.req.valid("json");
    const { apiKey, model } = getAssistantConfig();

    const result = await runAssistant({
      messages,
      resumeFrom,
      token,
      baseUrl: process.env.KANEO_API_URL || "http://localhost:1337",
      apiKey,
      model,
      workspaceId,
      projectId,
      confirmations,
    });

    return c.json(result);
  },
);

export default assistant;
