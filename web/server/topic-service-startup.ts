import { homedir } from "node:os";
import { join } from "node:path";
import type { CliLauncher } from "./cli-launcher.js";
import type { WsBridge } from "./ws-bridge.js";
import { listQuests } from "./quest-store.js";
import { addSessionSaveListener } from "./artifact-library.js";
import { archiveLibrarySession, createLibrarySession } from "./library-session-creator.js";
import { resolveResultContextWindow } from "./bridge/context-usage.js";
import { setTopicService } from "./routes/topics.js";
import { TopicService, type TopicLeaderInfo, type TopicSessionLike } from "./topic-service.js";
import { TopicStore } from "./topic-store.js";

/**
 * Starts the Library's topics: loads the store beside the artifact library, reads saved sessions
 * of leaders with topics on, and creates each space's hidden page writer when it is first needed.
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
      const result = wsBridge.injectUserMessage(sessionId, text, { sessionId: "library", sessionLabel: "Library" });
      return result !== "no_session" && result !== "dropped";
    },
    createWriter: async (space, treeGroupId) => {
      const { sessionId } = await createLibrarySession({
        backend: "claude",
        cwd: homedir(),
        permissionMode: "bypassPermissions",
        hidden: true,
        noAutoName: true,
        fixedName: `Library pages (${space})`,
        ...(treeGroupId ? { treeGroupId } : {}),
      });
      const bridgeSession = wsBridge.getSession(sessionId);
      if (bridgeSession) {
        bridgeSession.state.hidden = true;
        // The page writer never reads or writes memory; the catalog would only cost tokens.
        bridgeSession.pendingStartupMemoryCatalogInjection = false;
      }
      return sessionId;
    },
    isWriterAlive: (sessionId) => {
      const info = launcher.getSession(sessionId);
      return !!info && !info.archived;
    },
    writerContextTokens: (sessionId) => {
      const session = wsBridge.getSession(sessionId);
      if (!session) return 0;
      const result = session.messageHistory.findLast((message) => message.type === "result");
      const window =
        (result?.type === "result" ? resolveResultContextWindow(undefined, result.data.modelUsage) : undefined) ??
        200_000;
      return ((session.state.context_used_percent ?? 0) / 100) * window;
    },
    retireWriter: (sessionId) => archiveLibrarySession(sessionId),
    broadcastChanged: () => {},
  });
  await service.store.load();
  setTopicService(service);
  addSessionSaveListener((sessionId) => service.sessionSaved(sessionId));
  return service;
}
