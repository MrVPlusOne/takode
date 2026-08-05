import { Hono } from "hono";
import {
  CODEX_GOAL_UNKNOWN_CAPABILITY,
  isCodexGoalUnsupportedError,
  normalizeCodexGoalStatus,
  type CodexGoalCapabilityState,
  type CodexGoalSetMode,
  type CodexGoalState,
} from "../codex-goal.js";
import type { RouteContext } from "./context.js";

type GoalAdapter = {
  refreshGoal(): Promise<CodexGoalState | null>;
  setGoal(
    input: { objective?: string | null; status?: string; tokenBudget?: number | null },
    mode?: CodexGoalSetMode,
  ): Promise<CodexGoalState | null>;
  clearGoal(): Promise<void>;
};

function getGoalAdapter(ctx: RouteContext, rawId: string): { id: string; adapter: GoalAdapter } | Response {
  const id = ctx.resolveId(rawId);
  if (!id) return Response.json({ error: "Session not found" }, { status: 404 });
  const session = ctx.wsBridge.getSession(id);
  if (!session) return Response.json({ error: "Session not found" }, { status: 404 });
  if (session.backendType !== "codex") {
    return Response.json({ error: "Codex Goal is only supported for Codex sessions" }, { status: 400 });
  }
  const adapter = session.codexAdapter as unknown as GoalAdapter | null;
  if (!adapter?.refreshGoal || !adapter?.setGoal || !adapter?.clearGoal) {
    return Response.json(
      { error: "Codex backend is not connected", goal: session.state.codex_goal ?? null },
      { status: 409 },
    );
  }
  return { id, adapter };
}

function parseBudget(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new Error("tokenBudget must be a positive number or null");
  return Math.floor(numeric);
}

function capability(state: CodexGoalCapabilityState["state"], error: string | null = null): CodexGoalCapabilityState {
  return { state, checkedAt: Date.now(), error };
}

export function createCodexGoalRoutes(ctx: RouteContext) {
  const api = new Hono();

  api.get("/sessions/:id/codex-goal", async (c) => {
    const id = ctx.resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    const session = ctx.wsBridge.getSession(id);
    if (!session) return c.json({ error: "Session not found" }, 404);
    return c.json({
      ok: true,
      goal: session.state.codex_goal ?? null,
      capability: session.state.codex_goal_capability ?? CODEX_GOAL_UNKNOWN_CAPABILITY,
    });
  });

  api.post("/sessions/:id/codex-goal/refresh", async (c) => {
    const resolved = getGoalAdapter(ctx, c.req.param("id"));
    if (resolved instanceof Response) return resolved;
    try {
      const goal = await resolved.adapter.refreshGoal();
      const session = ctx.wsBridge.getSession(resolved.id);
      return c.json({
        ok: true,
        goal,
        capability: session?.state.codex_goal_capability ?? capability(goal ? "supported" : "unknown"),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const state = isCodexGoalUnsupportedError(error) ? "unsupported" : "error";
      return c.json(
        { ok: false, goal: null, capability: capability(state, message), error: message },
        state === "unsupported" ? 409 : 500,
      );
    }
  });

  api.post("/sessions/:id/codex-goal/set", async (c) => {
    const resolved = getGoalAdapter(ctx, c.req.param("id"));
    if (resolved instanceof Response) return resolved;
    const body = await c.req.json().catch(() => ({}));
    const objective = typeof body.objective === "string" ? body.objective.trim() : undefined;
    const status = normalizeCodexGoalStatus(body.status);
    const mode: CodexGoalSetMode = body.mode === "replace" ? "replace" : "edit";
    let tokenBudget: number | null | undefined;
    try {
      tokenBudget = parseBudget(body.tokenBudget);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
    if (!objective && !status && tokenBudget === undefined) {
      return c.json({ error: "Provide objective, status, or tokenBudget" }, 400);
    }
    try {
      const goal = await resolved.adapter.setGoal(
        {
          ...(objective !== undefined ? { objective } : {}),
          ...(status ? { status } : {}),
          ...(tokenBudget !== undefined ? { tokenBudget } : {}),
        },
        mode,
      );
      return c.json({ ok: true, goal, capability: capability("supported") });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ ok: false, error: message }, isCodexGoalUnsupportedError(error) ? 409 : 500);
    }
  });

  api.post("/sessions/:id/codex-goal/pause", async (c) => {
    const resolved = getGoalAdapter(ctx, c.req.param("id"));
    if (resolved instanceof Response) return resolved;
    try {
      const goal = await resolved.adapter.setGoal({ status: "paused" });
      return c.json({ ok: true, goal, capability: capability("supported") });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ ok: false, error: message }, isCodexGoalUnsupportedError(error) ? 409 : 500);
    }
  });

  api.post("/sessions/:id/codex-goal/resume", async (c) => {
    const resolved = getGoalAdapter(ctx, c.req.param("id"));
    if (resolved instanceof Response) return resolved;
    try {
      const goal = await resolved.adapter.setGoal({ status: "active" });
      return c.json({ ok: true, goal, capability: capability("supported") });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ ok: false, error: message }, isCodexGoalUnsupportedError(error) ? 409 : 500);
    }
  });

  api.post("/sessions/:id/codex-goal/clear", async (c) => {
    const resolved = getGoalAdapter(ctx, c.req.param("id"));
    if (resolved instanceof Response) return resolved;
    try {
      await resolved.adapter.clearGoal();
      return c.json({ ok: true, goal: null, capability: capability("supported") });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ ok: false, error: message }, isCodexGoalUnsupportedError(error) ? 409 : 500);
    }
  });

  return api;
}
