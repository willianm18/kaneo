import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";

const WORKSPACE_BY_PROJECT: Record<string, string> = {
  "project-mine": "workspace-mine",
  "project-theirs": "workspace-theirs",
};

vi.mock("../../../apps/api/src/database", async () => {
  const schema = await import("../../../apps/api/src/database/schema");
  const { PgDialect } = await import("drizzle-orm/pg-core");

  const dialect = new PgDialect();
  let boundId: string | undefined;

  const chain = {
    select: () => chain,
    from: () => chain,
    innerJoin: () => chain,
    where: (condition: Parameters<typeof dialect.sqlToQuery>[0]) => {
      const [id] = dialect.sqlToQuery(condition).params;
      boundId = typeof id === "string" ? id : undefined;
      return chain;
    },
    limit: async () => {
      const workspaceId = boundId ? WORKSPACE_BY_PROJECT[boundId] : undefined;
      return workspaceId ? [{ workspaceId }] : [];
    },
  };

  return { default: chain, schema };
});

vi.mock("../../../apps/api/src/utils/validate-workspace-access", async () => {
  const { HTTPException } = await import("hono/http-exception");
  return {
    validateWorkspaceAccess: async (_userId: string, workspaceId: string) => {
      if (workspaceId !== "workspace-mine") {
        throw new HTTPException(403, {
          message: "You don't have access to this workspace",
        });
      }
    },
  };
});

const { workspaceAccess } = await import(
  "../../../apps/api/src/utils/workspace-access-middleware"
);

// Espelha GET /api/search: tudo viaja na query string, e o handler filtra
// pelo mesmo projectId que autoriza a chamada.
function get(query: string) {
  const app = new Hono()
    .use("*", async (c, next) => {
      c.set("userId", "user-1");
      return next();
    })
    .get("/search", workspaceAccess.fromQueryOrProjectQuery(), async (c) =>
      c.json({ projectId: c.req.query("projectId") ?? null }),
    );

  return app.request(`/search${query}`);
}

describe("workspaceAccess: busca escopada por projeto", () => {
  it("resolve o workspace pelo projectId da query quando nao veio workspaceId", async () => {
    const res = await get("?q=disjuntor&projectId=project-mine");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ projectId: "project-mine" });
  });

  it("nega quando o projeto da query esta num workspace sem acesso", async () => {
    const res = await get("?q=disjuntor&projectId=project-theirs");

    expect(res.status).toBe(403);
  });

  it("continua aceitando o workspaceId direto na query", async () => {
    const res = await get("?q=disjuntor&workspaceId=workspace-mine");

    expect(res.status).toBe(200);
  });

  it("recusa quando nao ha workspaceId nem projectId", async () => {
    const res = await get("?q=disjuntor");

    expect(res.status).toBe(400);
  });
});
