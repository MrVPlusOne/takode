import { Hono } from "hono";
import type { RouteContext } from "./context.js";

export function createTimerRoutes(ctx: RouteContext) {
  const api = new Hono();
  const { wsBridge, authenticateTakodeCaller, resolveId } = ctx;

  // POST /api/sessions/:id/timers — create a timer
  api.post("/sessions/:id/timers", async (c) => {
    const auth = authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;

    const raw = c.req.param("id");
    const sessionId = resolveId(raw);
    if (!sessionId) return c.json({ error: `Session not found: ${raw}` }, 404);

    if (!ctx.timerManager) return c.json({ error: "Timer manager not available" }, 503);

    try {
      const body = await c.req.json();
      const timer = await ctx.timerManager.createTimer(sessionId, body);
      return c.json({ timer }, 201);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 400);
    }
  });

  // GET /api/sessions/:id/timers — list timers for a session
  api.get("/sessions/:id/timers", async (c) => {
    const auth = authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;

    const raw = c.req.param("id");
    const sessionId = resolveId(raw);
    if (!sessionId) return c.json({ error: `Session not found: ${raw}` }, 404);

    if (!ctx.timerManager) return c.json({ error: "Timer manager not available" }, 503);

    const timers = ctx.timerManager.listTimers(sessionId);
    return c.json({ timers });
  });

  // DELETE /api/sessions/:id/timers/:timerId — cancel a timer
  api.delete("/sessions/:id/timers/:timerId", async (c) => {
    const auth = authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;

    const raw = c.req.param("id");
    const sessionId = resolveId(raw);
    if (!sessionId) return c.json({ error: `Session not found: ${raw}` }, 404);

    if (!ctx.timerManager) return c.json({ error: "Timer manager not available" }, 503);

    const timerId = c.req.param("timerId");
    const cancelled = await ctx.timerManager.cancelTimer(sessionId, timerId);
    if (!cancelled) return c.json({ error: `Timer not found: ${timerId}` }, 404);

    return c.json({ ok: true });
  });

  return api;
}
