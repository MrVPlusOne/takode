import type { Hono } from "hono";
import { buildActivityStream, type ActivitySessionDocument } from "../activity-stream.js";
import * as sessionNames from "../session-names.js";
import * as treeGroupStore from "../tree-group-store.js";
import type { RouteContext } from "./context.js";

/** Default shortened length of each message; `full=1` returns whole messages. */
const ACTIVITY_TEXT_LIMIT = 1000;

/**
 * `GET /takode/activity?since=<ms>&until=<ms>&space=<names|ids|all>&full=1`
 *
 * The user's hand-typed messages and the final answers to them for a time window.
 * Without `space`, a session caller sees only its own session space, so a session in
 * one space never pulls another space's content in by accident.
 */
export function registerTakodeActivityRoute(api: Hono, ctx: RouteContext): void {
  api.get("/takode/activity", async (c) => {
    const auth = ctx.authenticateCompanionCallerOptional(c);
    if (auth && "response" in auth) return auth.response;

    const rawUntil = c.req.query("until");
    const rawSince = c.req.query("since");
    const until = rawUntil ? Number(rawUntil) : Date.now();
    const since = rawSince ? Number(rawSince) : until - 24 * 60 * 60 * 1000;
    if (!Number.isFinite(since) || !Number.isFinite(until)) {
      return c.json({ error: "since and until must be epoch milliseconds" }, 400);
    }
    if (since >= until) return c.json({ error: "since must be before until" }, 400);

    const treeState = await treeGroupStore.getState();
    const spaceName = new Map(treeState.groups.map((group) => [group.id, group.name] as const));
    const spaceOf = (sessionId: string): string => {
      const groupId =
        ctx.wsBridge.getSession(sessionId)?.state.treeGroupId ||
        ctx.launcher.getSession(sessionId)?.treeGroupId ||
        treeState.assignments[sessionId] ||
        "default";
      return spaceName.get(groupId) ?? groupId;
    };

    const requested = c.req.query("space")?.trim();
    let spaces: string[] | null = auth ? [spaceOf(auth.callerId)] : null;
    if (requested === "all") spaces = null;
    else if (requested) {
      const known = [...spaceName.values()];
      spaces = [];
      for (const value of requested.split(",").map((part) => part.trim())) {
        const name = known.find((candidate) => candidate.toLowerCase() === value.toLowerCase()) ?? spaceName.get(value);
        if (!name) return c.json({ error: `Unknown session space "${value}". Known: ${known.join(", ")}` }, 400);
        spaces.push(name);
      }
    }

    const documents: ActivitySessionDocument[] = [];
    const unreadable: Array<{ session: number | null; error: string }> = [];
    for (const session of ctx.launcher.listSessions()) {
      const bridgeSession = ctx.wsBridge.getSession(session.sessionId);
      if (!bridgeSession) continue;
      // Hidden sessions are delegate children driven by an agent, except Side Chats, which the user types into.
      const sideChat = bridgeSession.state.slackThreadChild;
      if ((session.hidden || bridgeSession.state.hidden) && !sideChat) continue;
      const space = spaceOf(sideChat?.rootSessionId ?? session.sessionId);
      if (spaces && !spaces.includes(space)) continue;
      // A session last active before the window cannot contribute; skip it before loading archived history.
      const lastActive = session.archived ? (session.archivedAt ?? session.lastActivityAt) : undefined;
      if (lastActive !== undefined && lastActive < since) continue;
      let messageHistory = bridgeSession.messageHistory;
      // Sessions archived before this server started keep their history only on disk.
      if (bridgeSession.searchDataOnly) {
        try {
          messageHistory = (await ctx.sessionStore.load(session.sessionId))?.messageHistory ?? [];
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[takode-activity] Cannot load archived session ${session.sessionId}: ${message}`);
          unreadable.push({ session: ctx.launcher.getSessionNum(session.sessionId) ?? null, error: message });
          continue;
        }
      }
      const name = sessionNames.getName(session.sessionId) ?? session.name ?? session.sessionId.slice(0, 8);
      const rootNum = sideChat ? ctx.launcher.getSessionNum(sideChat.rootSessionId) : undefined;
      documents.push({
        sessionId: session.sessionId,
        sessionNum: ctx.launcher.getSessionNum(session.sessionId) ?? null,
        sessionName: sideChat ? `Side chat of #${rootNum ?? sideChat.rootSessionId.slice(0, 8)}` : name,
        space,
        isOrchestrator: session.isOrchestrator === true || bridgeSession.state.isOrchestrator === true,
        messageHistory,
      });
    }

    const threads = buildActivityStream({
      documents,
      since,
      until,
      ...(c.req.query("full") === "1" ? {} : { textLimit: ACTIVITY_TEXT_LIMIT }),
    });
    return c.json({ since, until, spaces, threads, ...(unreadable.length ? { unreadable } : {}) });
  });
}
