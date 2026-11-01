import type { Hono } from "hono";
import type { CliLauncher } from "../cli-launcher.js";
import type { SessionStore } from "../session-store.js";
import type { SessionActivityRecord } from "../activity-stream.js";
import type { WsBridge } from "../ws-bridge.js";
import * as sessionNames from "../session-names.js";
import * as treeGroupStore from "../tree-group-store.js";
import { searchUserMessages, type UserMessageSearchSource } from "../user-message-search.js";

export interface GlobalUserMessageSearchRouteDeps {
  launcher: CliLauncher;
  wsBridge: WsBridge;
  sessionStore: Pick<SessionStore, "loadActivityRecord">;
}

/**
 * Search the user's own messages in every session (`q`, `limit`, `offset`, optional
 * `sessionSpaceId`). Sessions archived before this server started are read from the activity
 * records saved when they were archived, each read from disk once.
 */
export function registerGlobalUserMessageSearchRoute(api: Hono, deps: GlobalUserMessageSearchRouteDeps): void {
  const { launcher, wsBridge, sessionStore } = deps;
  // Records belong to archived sessions, so they don't change once read.
  const records = new Map<string, SessionActivityRecord>();
  const recordOf = async (sessionId: string): Promise<SessionActivityRecord | undefined> => {
    const known = records.get(sessionId);
    if (known) return known;
    const record = await sessionStore.loadActivityRecord(sessionId).catch((error: unknown) => {
      console.warn(`[user-message-search] Cannot read the activity record of ${sessionId}:`, error);
      return null;
    });
    if (record) records.set(sessionId, record);
    return record ?? undefined;
  };

  api.get("/sessions/user-message-search", async (c) => {
    const startedAt = Date.now();
    const spaceFilter = c.req.query("sessionSpaceId") || undefined;
    const assignments = spaceFilter
      ? (await treeGroupStore.getState().catch(() => ({ assignments: {} as Record<string, string> }))).assignments
      : {};
    const names = sessionNames.getAllNames();
    const found = await Promise.all(
      launcher.listSessions().map(async (session): Promise<UserMessageSearchSource | null> => {
        const bridgeSession = wsBridge.getSession(session.sessionId);
        const state = bridgeSession?.state;
        if (!bridgeSession || session.hidden === true || state?.hidden === true || state?.slackThreadChild) return null;
        if (spaceFilter) {
          const space = state?.treeGroupId || session.treeGroupId || assignments[session.sessionId] || "default";
          if (space !== spaceFilter) return null;
        }
        const source: UserMessageSearchSource = {
          sessionId: session.sessionId,
          sessionNum: launcher.getSessionNum(session.sessionId) ?? session.sessionNum ?? null,
          sessionName: names[session.sessionId] ?? session.name ?? `Session ${session.sessionId.slice(0, 8)}`,
          archived: session.archived === true,
          isOrchestrator: session.isOrchestrator === true || state?.isOrchestrator === true,
        };
        if (!bridgeSession.searchDataOnly) return { ...source, history: bridgeSession.messageHistory };
        const record = await recordOf(session.sessionId);
        return record ? { ...source, record, excerpts: bridgeSession.searchExcerpts } : null;
      }),
    );
    const sources = found.filter((source): source is UserMessageSearchSource => source !== null);
    const response = searchUserMessages({
      sources,
      query: c.req.query("q") ?? "",
      limit: parseInteger(c.req.query("limit")),
      offset: parseInteger(c.req.query("offset")),
    });
    return c.json({ ...response, tookMs: Date.now() - startedAt });
  });
}

function parseInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
