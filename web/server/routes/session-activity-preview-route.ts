import type { Hono } from "hono";
import type { WsBridge } from "../ws-bridge.js";
import { buildSessionActivityPreview } from "../session-activity-preview.js";

export interface SessionActivityPreviewRouteDeps {
  wsBridge: Pick<WsBridge, "getSession">;
  resolveId: (idOrNum: string) => string | null;
}

/** Bounded latest-activity slice so a leader thread can glance at a worker without loading its history. */
export function registerSessionActivityPreviewRoute(api: Hono, deps: SessionActivityPreviewRouteDeps): void {
  api.get("/sessions/:id/activity-preview", (c) => {
    const sessionId = deps.resolveId(c.req.param("id"));
    const history = sessionId ? deps.wsBridge.getSession(sessionId)?.messageHistory : undefined;
    if (!history) return c.json({ error: "Session not found" }, 404);
    return c.json(buildSessionActivityPreview(history));
  });
}
