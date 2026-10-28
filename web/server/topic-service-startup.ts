import { homedir } from "node:os";
import { join } from "node:path";
import type { CliLauncher } from "./cli-launcher.js";
import type { WsBridge } from "./ws-bridge.js";
import { listQuests } from "./quest-store.js";
import { addSessionSaveListener } from "./artifact-library.js";
import { archiveLibrarySession, createLibrarySession } from "./library-session-creator.js";
import { setTopicService } from "./routes/topics.js";
import { TopicService, historyMessageText, type TopicLeaderInfo, type TopicSessionLike } from "./topic-service.js";
import { TopicStore } from "./topic-store.js";
import { setTopicViewSource } from "./topic-views.js";
import { setScribeHooks } from "./scribe-registry.js";
import { getSettings } from "./settings-manager.js";
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
      ...(info.backendType ? { backendType: info.backendType } : {}),
      ...(info.hostId ? { hostId: info.hostId } : {}),
    };
  };
  const leaderCwd = (leader: TopicLeaderInfo) => launcher.getSession(leader.sessionId)?.cwd;
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
      const backend = scribeBackendFor(leader);
      const { sessionId } = await createLibrarySession(
        {
          backend,
          // On the leader's machine, in its home folder (the leader's folder if the host's home is unknown).
          ...(leader.hostId
            ? { hostId: leader.hostId, cwd: launcher.remoteHosts?.links.homeDir(leader.hostId) ?? leaderCwd(leader) }
            : { cwd: homedir() }),
          // Full access without prompts, as a leader's workers usually run; nobody watches a Scribe.
          ...(backend === "codex"
            ? { permissionMode: "codex-full-access", askPermission: false }
            : { permissionMode: "bypassPermissions" }),
          noAutoName: true,
          fixedName: "Scribe",
          ...(leaderState?.treeGroupId ? { treeGroupId: leaderState.treeGroupId } : {}),
        },
        { scribeFor: leader.sessionId },
      );
      launcher.herdSessions(leader.sessionId, [sessionId], { force: true });
      return sessionId;
    },
    hostOf: (sessionId) => launcher.getSession(sessionId)?.hostId || undefined,
    isScribeAlive: (sessionId) => {
      const info = launcher.getSession(sessionId);
      return !!info && !info.archived;
    },
    isScribeBusy: (sessionId) => wsBridge.getSession(sessionId)?.isGenerating === true,
    retireScribe: (sessionId) => archiveLibrarySession(sessionId),
    notifyLeader: (leaderId, text) => {
      wsBridge.injectUserMessage(leaderId, text, { ...LIBRARY_MESSAGE_SOURCE });
    },
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
    turnEnded: (sessionId, outcome) => {
      service
        .scribeTurnEnded(sessionId, outcome)
        .catch((error) => console.error("[library-topics] Scribe turn end:", error));
    },
  });
  launcher.scribeLeaderName = (leaderId) => input.sessionName(leaderId);
  setTopicService(service);
  // Topic conversations ask the store which quests a topic holds, live, so a quest moving to
  // another topic moves between their views at once.
  setTopicViewSource({
    topicOf: (handle) => {
      const topic = service.store.loaded ? service.store.resolveHandle(handle) : undefined;
      return topic ? { id: topic.id, name: topic.name } : null;
    },
    questsOf: (topicId) => (service.store.loaded ? service.store.questsOf(topicId) : []),
    handlesOf: (topicId) => (service.store.loaded ? service.store.handlesOf(topicId) : []),
    topicOfQuest: (questId) => (service.store.loaded ? (service.store.topicOfQuest(questId)?.id ?? null) : null),
    listTopics: () => (service.store.loaded ? service.store.list() : []),
  });
  addSessionSaveListener((sessionId) => service.sessionSaved(sessionId));
  return service;
}

/** The Scribe's backend: the leader's own unless Settings name one. */
function scribeBackendFor(leader: TopicLeaderInfo): "claude" | "codex" {
  const setting = getSettings().scribeBackend ?? "leader";
  if (setting !== "leader") return setting;
  return leader.backendType === "codex" ? "codex" : "claude";
}
