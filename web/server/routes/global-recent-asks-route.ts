import type { Hono } from "hono";
import type { CliLauncher } from "../cli-launcher.js";
import type { WsBridge } from "../ws-bridge.js";
import {
  buildRecentAskBundles,
  type RecentAskFilter,
  type RecentAskQuestSummary,
  type RecentAskSessionDocument,
} from "../recent-ask-bundles.js";
import * as sessionNames from "../session-names.js";
import * as treeGroupStore from "../tree-group-store.js";
import * as questStore from "../quest-store.js";
import { getUserVisibleSessionNotifications } from "../bridge/session-notification-controller.js";

export interface GlobalRecentAsksRouteDeps {
  launcher: CliLauncher;
  wsBridge: WsBridge;
  getTreeGroupState?: typeof treeGroupStore.getState;
  listQuests?: typeof questStore.listQuests;
}

export function registerGlobalRecentAsksRoute(api: Hono, deps: GlobalRecentAsksRouteDeps): void {
  const { launcher, wsBridge } = deps;
  api.get("/sessions/recent-asks", async (c) => {
    const startedAt = Date.now();
    const [treeState, quests] = await Promise.all([
      (deps.getTreeGroupState ?? treeGroupStore.getState)().catch(
        (): Awaited<ReturnType<typeof treeGroupStore.getState>> => ({
          groups: [{ id: "default", name: "Default" }],
          assignments: {},
          nodeOrder: {},
        }),
      ),
      (deps.listQuests ?? questStore.listQuests)().catch(() => []),
    ]);
    const names = sessionNames.getAllNames();
    const groupNames = new Map(treeState.groups.map((group) => [group.id, group.name] as const));
    const documents: RecentAskSessionDocument[] = [];
    let omittedSearchOnlySessions = 0;

    for (const session of launcher.listSessions()) {
      const bridgeSession = wsBridge.getSession(session.sessionId);
      const state = bridgeSession?.state;
      if (!bridgeSession || session.hidden === true || state?.hidden === true || state?.slackThreadChild) continue;
      if (bridgeSession.searchDataOnly) {
        omittedSearchOnlySessions += 1;
        continue;
      }
      const sessionSpaceId =
        state?.treeGroupId || session.treeGroupId || treeState.assignments[session.sessionId] || "default";
      documents.push({
        sessionId: session.sessionId,
        sessionNum: launcher.getSessionNum(session.sessionId) ?? session.sessionNum ?? null,
        sessionName: names[session.sessionId] ?? session.name ?? `Session ${session.sessionId.slice(0, 8)}`,
        sessionState: session.state,
        archived: session.archived === true,
        archivedAt: session.archivedAt,
        sessionSpaceId,
        sessionSpaceName: groupNames.get(sessionSpaceId) ?? sessionSpaceId,
        messageHistory: bridgeSession.messageHistory,
        notifications: getUserVisibleSessionNotifications(bridgeSession),
        isGenerating: bridgeSession.isGenerating,
        activeTurnRoute: bridgeSession.activeTurnRoute,
        userMessageIdsThisTurn: bridgeSession.userMessageIdsThisTurn,
        queuedTurnUserMessageIds: bridgeSession.queuedTurnUserMessageIds,
        pendingCodexInputs: bridgeSession.pendingCodexInputs,
      });
    }

    const questSummaries = new Map<string, RecentAskQuestSummary>();
    for (const quest of quests) {
      questSummaries.set(quest.questId, { questId: quest.questId, title: quest.title, status: quest.status });
    }

    const response = buildRecentAskBundles({
      documents,
      quests: questSummaries,
      query: c.req.query("q") ?? "",
      filter: parseFilter(c.req.query("filter")),
      sessionSpaceId: c.req.query("sessionSpaceId") || undefined,
      limit: parseInteger(c.req.query("limit")),
      omittedSearchOnlySessions,
    });
    return c.json({ ...response, tookMs: Date.now() - startedAt });
  });
}

function parseFilter(value: string | undefined): RecentAskFilter {
  return value === "needs_me" || value === "new_response" || value === "active" ? value : "all";
}

function parseInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}
