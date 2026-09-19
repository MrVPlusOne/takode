import type { Hono } from "hono";
import { resolve } from "node:path";
import { AuxiliaryWorktreeLifecycle, canonicalWorktreePath } from "../auxiliary-worktrees.js";
import type { AuxiliaryWorktreeRegistration } from "../auxiliary-worktree-registry.js";
import type { RouteContext } from "./context.js";

function publicRegistration(record: AuxiliaryWorktreeRegistration) {
  return {
    sessionId: record.sessionId,
    path: record.worktreePath,
    repoRoot: record.repoRoot,
    branch: record.branch,
    baseBranch: record.baseBranch ?? null,
    retention: record.retention,
    cleanupStatus: record.cleanupStatus ?? null,
    cleanupReason: record.cleanupReason ?? null,
  };
}

export function registerAuxiliaryWorktreeRoutes(api: Hono, ctx: RouteContext, lifecycle: AuxiliaryWorktreeLifecycle) {
  api.get("/sessions/:id/worktrees", async (c) => {
    const auth = ctx.authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    const id = ctx.resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    return c.json({ worktrees: (await lifecycle.registry.list(id)).map(publicRegistration) });
  });

  api.post("/sessions/:id/worktrees", async (c) => {
    const auth = ctx.authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    const id = ctx.resolveId(c.req.param("id"));
    if (id !== auth.callerId) return c.json({ error: "Register worktrees only for your own session" }, 403);
    const input = await c.req.json().catch(() => null);
    if (
      !input ||
      typeof input.path !== "string" ||
      !input.path ||
      !["temporary", "retained"].includes(input.retention) ||
      (input.baseBranch !== undefined && (typeof input.baseBranch !== "string" || !input.baseBranch))
    ) {
      return c.json({ error: "path and explicit temporary/retained retention are required" }, 400);
    }
    try {
      const record = await lifecycle.register(id, resolve(input.path), input.retention, input.baseBranch);
      return c.json({ worktree: publicRegistration(record) });
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });

  api.post("/sessions/:id/worktrees/cleanup", async (c) => {
    const auth = ctx.authenticateTakodeCaller(c, { requireOrchestrator: true });
    if ("response" in auth) return auth.response;
    const id = ctx.resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    const body = await c.req.json().catch(() => null);
    if (typeof body?.path !== "string" || !body.path) return c.json({ error: "Select one registered path" }, 400);
    try {
      const [record] = await lifecycle.cleanup(id, await canonicalWorktreePath(body.path));
      const ok = record?.cleanupStatus === "done";
      return c.json(
        {
          ok,
          worktree: record && publicRegistration(record),
          error: ok ? undefined : (record?.cleanupReason ?? "Retained worktrees are not cleanup candidates"),
        },
        ok ? 200 : 409,
      );
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 409);
    }
  });
}
