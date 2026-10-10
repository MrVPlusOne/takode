import { Hono } from "hono";
import { readSessionDraftWriteRequest } from "../../shared/session-drafts.js";
import { applySessionDraftWrite, getSessionDraftsSnapshot } from "../bridge/session-drafts-controller.js";
import type { RouteContext } from "./context.js";

/**
 * Unsent drafts shared by the user's browsers. Browsers write each draft change
 * here (debounced) and receive other browsers' changes as `session_draft_update`
 * messages; `state_snapshot` carries the current drafts on every subscribe.
 */
export function createSessionDraftRoutes(ctx: Pick<RouteContext, "wsBridge" | "resolveId">) {
  const api = new Hono();
  const { wsBridge, resolveId } = ctx;

  api.get("/sessions/:id/drafts", (c) => {
    const id = resolveId(c.req.param("id"));
    const session = id ? wsBridge.getSession(id) : undefined;
    if (!session) return c.json({ error: "Session not found" }, 404);
    return c.json({ drafts: getSessionDraftsSnapshot(session) ?? { revision: 0 } });
  });

  api.put("/sessions/:id/drafts", async (c) => {
    const id = resolveId(c.req.param("id"));
    const session = id ? wsBridge.getSession(id) : undefined;
    if (!session) return c.json({ error: "Session not found" }, 404);
    const request = readSessionDraftWriteRequest(await c.req.json().catch(() => null));
    if ("error" in request) return c.json({ error: request.error }, 400);
    const result = applySessionDraftWrite(session, request, {
      broadcastToBrowsers: (target, message) => wsBridge.broadcastToSession(target.id, message),
      persistSession: (target) => wsBridge.persistSessionById(target.id),
    });
    if (!result.ok) return c.json({ error: result.error }, 409);
    return c.json({ change: result.change });
  });

  return api;
}
