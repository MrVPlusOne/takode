import type { Hono } from "hono";
import { normalizeThreadTarget } from "../../shared/thread-routing.js";
import type { CliLauncher } from "../cli-launcher.js";
import type { WsBridge } from "../ws-bridge.js";

/** Thread views kept per leader; the oldest are forgotten beyond this. */
export const MAX_THREAD_VIEWS = 200;

export interface SessionThreadViewedRouteDeps {
  launcher: CliLauncher;
  wsBridge: WsBridge;
  resolveId: (idOrNum: string) => string | null;
}

/**
 * A browser saying the user viewed one of a leader's threads: a chat showing it stayed focused for
 * a moment (Jiayi, Nov 10). The view counts as dealing with the thread, so it moves up in the
 * Threads view and on Home on every device, and a thread just looked at is easy to find again.
 */
export function registerSessionThreadViewedRoute(api: Hono, deps: SessionThreadViewedRouteDeps): void {
  const { launcher, wsBridge, resolveId } = deps;

  api.post("/sessions/:id/thread-viewed", async (c) => {
    const sessionId = resolveId(c.req.param("id"));
    if (!sessionId || !launcher.getSession(sessionId)) return c.json({ error: "Session not found" }, 404);
    const bridgeSession = wsBridge.getSession(sessionId);
    if (!bridgeSession) return c.json({ error: "Session not found in bridge" }, 404);
    if (!launcher.getSession(sessionId)?.isOrchestrator) return c.json({ error: "Not a leader session" }, 400);

    const body = await c.req.json().catch(() => ({}));
    const threadKey = typeof body.threadKey === "string" ? normalizeThreadTarget(body.threadKey)?.threadKey : null;
    if (!threadKey) return c.json({ error: "threadKey must name a thread" }, 400);

    const viewed = {
      ...bridgeSession.state.threadViewedAt,
      [threadKey]: Date.now(),
    };
    bridgeSession.state.threadViewedAt = keepNewestViews(viewed);
    wsBridge.persistSessionById(sessionId);
    wsBridge.getSyncedProjectionController().invalidateLeaderThreadTabsForSession(sessionId);
    return c.json({ ok: true });
  });
}

function keepNewestViews(viewed: Record<string, number>): Record<string, number> {
  const entries = Object.entries(viewed);
  if (entries.length <= MAX_THREAD_VIEWS) return viewed;
  return Object.fromEntries(entries.sort((a, b) => b[1] - a[1]).slice(0, MAX_THREAD_VIEWS));
}
