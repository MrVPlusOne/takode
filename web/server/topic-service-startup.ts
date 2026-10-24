import { homedir } from "node:os";
import { join } from "node:path";
import type { CliLauncher } from "./cli-launcher.js";
import type { WsBridge } from "./ws-bridge.js";
import { listQuests } from "./quest-store.js";
import { addSessionSaveListener } from "./artifact-library.js";
import { archiveLibrarySession, createLibrarySession } from "./library-session-creator.js";
import { resolveResultContextWindow } from "./bridge/context-usage.js";
import { setTopicService } from "./routes/topics.js";
import { TopicService, historyMessageText, type TopicLeaderInfo, type TopicSessionLike } from "./topic-service.js";
import { TopicStore } from "./topic-store.js";
import { setScribeHooks } from "./scribe-registry.js";
import { LIBRARY_MESSAGE_SOURCE } from "../shared/library-topics.js";

/**
 * Starts the Library's topics: loads the store beside the artifact library, reads saved sessions
 * of leaders with topics on, and starts each such leader's Scribe (a worker in its herd) when it is
 * first needed.
 */
export async function startLibraryTopics(input: {
  serverId: string;
  wsBridge: WsBridge;
  launcher: CliLauncher;
  sessionName: (sessionId: string) => string | undefined;
}): Promise<TopicService> {
  const { wsBridge, launcher } = input;
  const leaderInfo = (sessionId: string): TopicLeaderInfo | undefined => {
    const info = launcher.getSession(sessionId);
    if (!info) return undefined;
    return {
      sessionId,
      sessionNum: launcher.getSessionNum(sessionId) ?? null,
      name: input.sessionName(sessionId) || sessionId.slice(0, 8),
      space: info.memorySessionSpaceSlug ?? launcher.getMemorySessionSpaceSlug(),
      isOrchestrator: info.isOrchestrator === true,
      archived: info.archived === true,
    };
  };
  const service = new TopicService(new TopicStore(join(homedir(), ".companion", "library", input.serverId)), {
    getSession: (sessionId) => wsBridge.getSession(sessionId) as TopicSessionLike | undefined,
    getLeaderInfo: leaderInfo,
    listLeaders: () =>
      launcher
        .listSessions()
        .filter((session) => session.isOrchestrator)
        .flatMap((session) => leaderInfo(session.sessionId) ?? []),
    sessionNum: (sessionId) => launcher.getSessionNum(sessionId) ?? null,
    listQuests,
    inject: (sessionId, text) => {
      const result = wsBridge.injectUserMessage(sessionId, text, { ...LIBRARY_MESSAGE_SOURCE });
      return result !== "no_session" && result !== "dropped";
    },
    leaderOf: (sessionId) => {
      const info = launcher.getSession(sessionId);
      if (!info) return undefined;
      return info.isOrchestrator ? sessionId : info.herdedBy;
    },
    createScribe: async (leader) => {
      const leaderState = wsBridge.getSession(leader.sessionId)?.state;
      const { sessionId } = await createLibrarySession(
        {
          backend: "claude",
          cwd: homedir(),
          permissionMode: "bypassPermissions",
          noAutoName: true,
          fixedName: "Scribe",
          ...(leaderState?.treeGroupId ? { treeGroupId: leaderState.treeGroupId } : {}),
        },
        { scribeFor: leader.sessionId },
      );
      launcher.herdSessions(leader.sessionId, [sessionId], { force: true });
      const bridgeSession = wsBridge.getSession(sessionId);
      // The Scribe never reads or writes memory; the catalog would only cost tokens.
      if (bridgeSession) bridgeSession.pendingStartupMemoryCatalogInjection = false;
      return sessionId;
    },
    isScribeAlive: (sessionId) => {
      const info = launcher.getSession(sessionId);
      return !!info && !info.archived;
    },
    scribeContextTokens: (sessionId) => {
      const session = wsBridge.getSession(sessionId);
      if (!session) return 0;
      const result = session.messageHistory.findLast((message) => message.type === "result");
      const window =
        (result?.type === "result" ? resolveResultContextWindow(undefined, result.data.modelUsage) : undefined) ??
        200_000;
      return ((session.state.context_used_percent ?? 0) / 100) * window;
    },
    isScribeBusy: (sessionId) => wsBridge.getSession(sessionId)?.isGenerating === true,
    retireScribe: (sessionId) => archiveLibrarySession(sessionId),
    messageText: (sessionNum, index) => {
      const sessionId = launcher.resolveSessionId(String(sessionNum));
      const message = sessionId ? wsBridge.getSession(sessionId)?.messageHistory[index] : undefined;
      return message ? historyMessageText(message) : null;
    },
    broadcastChanged: () => {},
  });
  await service.store.load();
  setScribeHooks({
    isScribe: (sessionId) => !!launcher.getSession(sessionId)?.scribeFor,
    turnEnded: (sessionId) => service.scribeTurnEnded(sessionId),
  });
  launcher.scribeLeaderName = (leaderId) => input.sessionName(leaderId);
  setTopicService(service);
  addSessionSaveListener((sessionId) => service.sessionSaved(sessionId));
  return service;
}
