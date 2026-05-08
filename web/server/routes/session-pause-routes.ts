import type { Hono } from "hono";
import { getPauseState } from "../session-pause.js";
import type { RouteContext } from "./context.js";

export function registerSessionPauseRoutes(api: Hono, ctx: RouteContext) {
  const { launcher, wsBridge, resolveId } = ctx;

  api.post("/sessions/:id/pause", async (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    const launcherSession = launcher.getSession(id);
    if (!launcherSession) return c.json({ error: "Session not found" }, 404);
    if (launcherSession.archived) return c.json({ error: "Cannot pause archived session" }, 409);

    const body = await c.req.json().catch(() => ({}));
    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : undefined;
    const pausedBy = typeof body.pausedBy === "string" && body.pausedBy.trim() ? body.pausedBy.trim() : undefined;
    const pause = wsBridge.pauseSession(id, { reason, pausedBy });
    if (!pause) return c.json({ error: "Session not found in bridge" }, 404);
    return c.json({ ok: true, sessionId: id, pause, queued: pause.queuedMessages.length });
  });

  api.post("/sessions/:id/unpause", async (c) => {
    const id = resolveId(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    if (!launcher.getSession(id)) return c.json({ error: "Session not found" }, 404);
    const before = getPauseState(wsBridge.getSession(id));
    const result = await wsBridge.unpauseSession(id);
    if (!result) return c.json({ error: "Session not found in bridge" }, 404);
    return c.json({ ok: true, sessionId: id, wasPaused: !!before, resumed: result.queued });
  });
}
