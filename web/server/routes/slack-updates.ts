import { Hono } from "hono";
import { refreshSlackUpdates, stopWatchingSlack, watchedSlackConversations } from "../slack-conversation-watch.js";
import type { RouteContext } from "./context.js";

/**
 * Slack updates for a session: the conversations it watches (`takode slack
 * list`), stopping them (`takode slack stop`), and a fresh check when the user
 * opens one of its questions.
 */
export function createSlackUpdateRoutes(
  ctx: Pick<RouteContext, "wsBridge" | "resolveId" | "authenticateTakodeCaller">,
) {
  const api = new Hono();
  const { wsBridge, resolveId, authenticateTakodeCaller } = ctx;
  const sessionIdOf = (raw: string) => {
    const id = resolveId(raw);
    return id && wsBridge.getSession(id) ? id : null;
  };

  // The user opened one of this session's questions, which they may answer without typing a draft.
  api.post("/sessions/:id/slack-refresh", (c) => {
    const id = sessionIdOf(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    refreshSlackUpdates(id);
    return c.json({ ok: true });
  });

  api.get("/sessions/:id/slack-watch", (c) => {
    const auth = authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    const id = sessionIdOf(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    return c.json({ conversations: watchedSlackConversations(id) });
  });

  api.post("/sessions/:id/slack-watch/stop", async (c) => {
    const auth = authenticateTakodeCaller(c);
    if ("response" in auth) return auth.response;
    const id = sessionIdOf(c.req.param("id"));
    if (!id) return c.json({ error: "Session not found" }, 404);
    const body = (await c.req.json().catch(() => null)) as { ids?: unknown; all?: unknown } | null;
    const ids =
      body?.all === true ? "all" : Array.isArray(body?.ids) ? body.ids.filter((x) => typeof x === "string") : null;
    if (!ids || ids.length === 0) return c.json({ error: "Name the conversations to stop, or all." }, 400);
    return c.json({ stopped: stopWatchingSlack(id, ids) });
  });

  return api;
}
