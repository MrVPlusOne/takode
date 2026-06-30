import type { Hono } from "hono";
import type { CliLauncher } from "../cli-launcher.js";
import {
  searchGlobalStarredMessages,
  type GlobalStarredMessageSearchDocument,
} from "../global-starred-message-search.js";
import * as sessionNames from "../session-names.js";
import type { WsBridge } from "../ws-bridge.js";

export interface GlobalStarredMessageSearchRouteDeps {
  launcher: CliLauncher;
  wsBridge: WsBridge;
}

export function registerGlobalStarredMessageSearchRoute(api: Hono, deps: GlobalStarredMessageSearchRouteDeps): void {
  const { launcher, wsBridge } = deps;
  api.get("/sessions/starred-message-search", (c) => {
    const startedAt = Date.now();
    const names = sessionNames.getAllNames();
    const docs: GlobalStarredMessageSearchDocument[] = launcher.listSessions().flatMap((session) => {
      const bridgeSession = wsBridge.getSession(session.sessionId);
      const state = bridgeSession?.state;
      if (!bridgeSession || session.hidden === true || state?.hidden === true || state?.slackThreadChild) return [];
      return [
        {
          sessionId: session.sessionId,
          sessionNum: launcher.getSessionNum(session.sessionId) ?? session.sessionNum ?? null,
          state: session.state,
          name: names[session.sessionId] ?? session.name ?? "",
          archived: session.archived === true,
          archivedAt: session.archivedAt,
          reviewerOf: session.reviewerOf,
          starredMessages: state?.starredMessages,
          messageHistory: bridgeSession.messageHistory,
          searchExcerpts: bridgeSession.searchExcerpts,
        },
      ];
    });

    const response = searchGlobalStarredMessages({
      docs,
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
