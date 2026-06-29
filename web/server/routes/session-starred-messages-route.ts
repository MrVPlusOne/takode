import type { Hono } from "hono";
import { findStableStarTarget } from "../starred-messages.js";
import type { StarredMessageRecord } from "../session-types.js";
import type { CliLauncher } from "../cli-launcher.js";
import type { WsBridge } from "../ws-bridge.js";

export interface SessionStarredMessagesRouteDeps {
  launcher: CliLauncher;
  wsBridge: WsBridge;
  resolveId: (idOrNum: string) => string | null;
}

export function registerSessionStarredMessagesRoute(api: Hono, deps: SessionStarredMessagesRouteDeps): void {
  const { launcher, wsBridge, resolveId } = deps;

  api.put("/sessions/:id/starred-messages/:messageId", async (c) => {
    const sessionId = resolveId(c.req.param("id"));
    if (!sessionId) return c.json({ error: "Session not found" }, 404);
    if (!launcher.getSession(sessionId)) return c.json({ error: "Session not found" }, 404);

    const bridgeSession = wsBridge.getSession(sessionId);
    if (!bridgeSession) return c.json({ error: "Session not found in bridge" }, 404);

    const messageId = decodeURIComponent(c.req.param("messageId"));
    const body = await c.req.json().catch(() => ({}));
    const historyIndex = typeof body.historyIndex === "number" ? Math.floor(body.historyIndex) : undefined;
    const target = findStableStarTarget(bridgeSession.messageHistory, messageId, historyIndex);
    if (!target) return c.json({ error: "Message is not star-actionable" }, 400);

    const current = bridgeSession.state.starredMessages ?? {};
    if (current[target.messageId]) return c.json({ ok: true, starredMessages: current });

    const starredMessages: Record<string, StarredMessageRecord> = {
      ...current,
      [target.messageId]: { ...target, starredAt: Date.now() },
    };
    bridgeSession.state.starredMessages = starredMessages;
    wsBridge.persistSessionById(sessionId);
    wsBridge.broadcastToSession(sessionId, { type: "session_update", session: { starredMessages } } as never);
    return c.json({ ok: true, starredMessages });
  });

  api.delete("/sessions/:id/starred-messages/:messageId", (c) => {
    const sessionId = resolveId(c.req.param("id"));
    if (!sessionId) return c.json({ error: "Session not found" }, 404);
    if (!launcher.getSession(sessionId)) return c.json({ error: "Session not found" }, 404);

    const bridgeSession = wsBridge.getSession(sessionId);
    if (!bridgeSession) return c.json({ error: "Session not found in bridge" }, 404);

    const messageId = decodeURIComponent(c.req.param("messageId"));
    const current = bridgeSession.state.starredMessages ?? {};
    if (!current[messageId]) return c.json({ ok: true, starredMessages: current });

    const starredMessages = { ...current };
    delete starredMessages[messageId];
    bridgeSession.state.starredMessages = starredMessages;
    wsBridge.persistSessionById(sessionId);
    wsBridge.broadcastToSession(sessionId, { type: "session_update", session: { starredMessages } } as never);
    return c.json({ ok: true, starredMessages });
  });
}
