import { topicHandle } from "../shared/topic-thread-key.js";
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
import { machineFor } from "./remote-host/session-machine.js";
import { LIBRARY_MESSAGE_SOURCE } from "../shared/library-topics.js";

/** Most images of one folder looked at when checking for new ones beside a page's pictures. */
const MAX_FOLDER_IMAGES = 200;

/** How long a burst of thread changes is gathered into one notice to the browsers. */
const THREAD_NOTICE_DELAY_MS = 300;

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
  /** The machine a leader runs on, and how a home-relative path there reads. */
  const leaderMachine = (leaderId: string) => {
    const hostId = leaderInfo(leaderId)?.hostId;
    const home = hostId ? launcher.remoteHosts?.links.homeDir(hostId) : homedir();
    return {
      machine: machineFor(hostId),
      expand: (path: string) => (path.startsWith("~/") && home ? `${home}${path.slice(1)}` : path),
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
    topicsForLeaders: () => getSettings().leaderTopics !== false,
    // A page's images load from its leader's machine (a remote host's too), so they are checked there.
    fileModifiedAt: async (leaderId, path) => {
      const where = leaderMachine(leaderId);
      return (await where.machine.stat(where.expand(path)))?.mtimeMs ?? null;
    },
    listImages: async (leaderId, folder) => {
      const where = leaderMachine(leaderId);
      const dir = where.expand(folder);
      const { stdout } = await where.machine.exec("ls -1A", { cwd: dir, timeout: 5000 });
      const names = stdout
        .split("\n")
        .filter((name) => /\.(png|jpe?g|gif|webp|svg)$/i.test(name))
        .slice(0, MAX_FOLDER_IMAGES);
      const images = await Promise.all(
        names.map(async (name) => {
          const info = await where.machine.stat(`${dir}/${name}`);
          return info?.isFile ? [{ path: `${folder}/${name}`, mtimeMs: info.mtimeMs }] : [];
        }),
      );
      return images.flat();
    },
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
  // Open Threads menus reload a leader's threads when they change (a Scribe filing one, a rename),
  // instead of on their minute poll. Bursts (the leader's turn writing in a thread) send one notice.
  const threadNotices = new Map<string, ReturnType<typeof setTimeout>>();
  service.store.onThreadChange = (leaderId) => {
    if (threadNotices.has(leaderId)) return;
    threadNotices.set(
      leaderId,
      setTimeout(() => {
        threadNotices.delete(leaderId);
        wsBridge.broadcastGlobal({ type: "leader_threads_changed", leaderId });
      }, THREAD_NOTICE_DELAY_MS),
    );
  };
  setTopicService(service);
  // Topic conversations ask the store which quests a topic holds, live, so a quest moving to
  // another topic moves between their views at once.
  setTopicViewSource({
    topicOf: (handle) => {
      const topic = service.store.loaded ? service.store.resolveHandle(handle) : undefined;
      if (!topic) return null;
      return {
        id: topic.id,
        name: topic.name,
        ...(topic.thread
          ? {
              thread: {
                ...(topic.thread.startedFrom ? { startedFrom: topic.thread.startedFrom } : {}),
                ...(topic.thread.topicId ? { topicId: topic.thread.topicId } : {}),
                // Renaming keeps the old name as an alias, so none means it has its first name still.
                ...(topic.aliases.length ? {} : { placeholderName: true }),
              },
            }
          : {}),
      };
    },
    questsOf: (topicId) => (service.store.loaded ? service.store.questsOf(topicId) : []),
    handlesOf: (topicId) => (service.store.loaded ? service.store.handlesOf(topicId) : []),
    threadsUnder: (topicId) =>
      service.store.loaded ? service.store.threadsUnder(topicId).map((thread) => topicHandle(thread.id)) : [],
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
