import type { BrowserIncomingMessage } from "../session-types.js";
import type { ProgrammaticUserMessageOptions } from "./browser-transport-controller.js";
import { sessionTag } from "../session-tag.js";
import {
  formatSessionRecoveryNotice,
  SESSION_RECOVERY_SOURCE,
  type SessionRecoveryFacts,
} from "../session-recovery-notice.js";
import {
  buildLeaderPreloadDeliveryContent,
  buildLeaderSkillPreloadBundles,
  buildLeaderSkillPreloadHistoryFollowUps,
  type LeaderSkillPreloadBundle,
} from "../leader-skill-preload.js";
import { getKnownSessionNum } from "../cli-launcher.js";
import {
  buildMemoryCatalogDeliveryContent,
  buildMemoryCatalogHistoryFollowUp,
  recordMemoryCatalogSeenAfterDelivery,
  type MemoryCatalogInjectionBundle,
} from "../memory-catalog-injection-utils.js";

export interface SessionRecoveryDeliverySession {
  id: string;
  messageHistory: BrowserIncomingMessage[];
  /** The recovery notice is on its way to the backend; other input waits behind it. */
  recoveryNoticeInFlight?: boolean;
  state?: { memorySessionSpaceSlug?: string };
}

export interface SessionRecoveryDeliveryDeps {
  takeRecovery: (sessionId: string) => SessionRecoveryFacts | undefined;
  isLeader: (sessionId: string) => boolean;
  sessionRef: (sessionId: string) => string;
  broadcastToBrowsers: (session: SessionRecoveryDeliverySession, message: BrowserIncomingMessage) => void;
  persistSession: (session: SessionRecoveryDeliverySession) => void;
  injectUserMessage: (
    sessionId: string,
    content: string,
    agentSource: { sessionId: string; sessionLabel: string },
    options: ProgrammaticUserMessageOptions,
  ) => void;
  /**
   * What a fresh conversation gets with the notice, as after a compaction or a
   * leader recycle: the required leader skills and the memory catalog. Absent
   * for backends whose own instructions restore that context (Codex).
   */
  freshContext?: {
    buildLeaderSkillPreloadBundles: () => Promise<LeaderSkillPreloadBundle[]>;
    buildMemoryCatalogInjectionBundle: (
      session: SessionRecoveryDeliverySession,
    ) => Promise<MemoryCatalogInjectionBundle | null | undefined>;
  };
}

/**
 * Tell a session's new backend what Takode rebuilt for it (a recreated
 * worktree, a lost conversation) in one message, then run `then` to hand it
 * the rest of its input. Returns false, without running `then`, when there is
 * nothing to tell. A lost conversation is treated like a leader recycle: a
 * `session_recycled` boundary in the history, and the recycle's recovery
 * instructions to rebuild context from the session's Takode history.
 */
export function deliverSessionRecoveryNotice(
  session: SessionRecoveryDeliverySession,
  deps: SessionRecoveryDeliveryDeps,
  then: () => void,
): boolean {
  const facts = deps.takeRecovery(session.id);
  if (!facts) return false;
  const leader = deps.isLeader(session.id);
  const content = formatSessionRecoveryNotice(facts, leader ? "leader" : "standard", deps.sessionRef(session.id));
  console.log(`[ws-bridge] Telling session ${sessionTag(session.id)} what Takode rebuilt for it`);

  session.recoveryNoticeInFlight = true;
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    session.recoveryNoticeInFlight = false;
    then();
  };
  const inject = (preloads: LeaderSkillPreloadBundle[], catalog: MemoryCatalogInjectionBundle | null | undefined) => {
    try {
      deps.injectUserMessage(session.id, content, SESSION_RECOVERY_SOURCE, {
        deliveryContent: buildMemoryCatalogDeliveryContent(
          buildLeaderPreloadDeliveryContent(content, preloads),
          catalog,
        ),
        historyFollowUps: [
          ...buildLeaderSkillPreloadHistoryFollowUps(preloads),
          ...buildMemoryCatalogHistoryFollowUp(catalog),
        ],
        afterAccepted: () => {
          recordMemoryCatalogSeenAfterDelivery(catalog);
          settle();
        },
        afterRejected: settle,
      });
    } catch (err) {
      console.error(`[ws-bridge] Failed to deliver the recovery notice of ${sessionTag(session.id)}:`, err);
      settle();
    }
  };

  if (facts.conversationLost) markFreshConversation(session, deps);
  const fresh = facts.conversationLost ? deps.freshContext : undefined;
  if (!fresh) {
    inject([], null);
    return true;
  }
  Promise.all([leader ? fresh.buildLeaderSkillPreloadBundles() : [], fresh.buildMemoryCatalogInjectionBundle(session)])
    .then(([preloads, catalog]) => inject(preloads, catalog))
    .catch((err) => {
      console.error(`[ws-bridge] Failed to build fresh-conversation context for ${sessionTag(session.id)}:`, err);
      inject([], null);
    });
  return true;
}

function markFreshConversation(session: SessionRecoveryDeliverySession, deps: SessionRecoveryDeliveryDeps): void {
  const timestamp = Date.now();
  const marker: BrowserIncomingMessage = {
    type: "compact_marker",
    id: `session-recycled-${timestamp}`,
    timestamp,
    markerKind: "session_recycled",
    trigger: "conversation_lost",
  };
  session.messageHistory.push(marker);
  deps.broadcastToBrowsers(session, marker);
  deps.persistSession(session);
}

/** The parts of the bridge the delivery uses. */
export interface SessionRecoveryBridge {
  launcher?: {
    takeRecovery?(sessionId: string): SessionRecoveryFacts | undefined;
    getSession(sessionId: string): { isOrchestrator?: boolean; pendingRecovery?: SessionRecoveryFacts } | undefined;
  } | null;
  broadcastToBrowsers(session: any, message: BrowserIncomingMessage): void;
  persistSession(session: any): void;
  injectUserMessage(
    sessionId: string,
    content: string,
    agentSource?: { sessionId: string; sessionLabel?: string },
    takodeHerdBatch?: undefined,
    threadRoute?: undefined,
    options?: ProgrammaticUserMessageOptions,
  ): unknown;
}

export function sessionRecoveryDeliveryDeps(
  bridge: SessionRecoveryBridge,
  backend: "claude" | "codex",
): SessionRecoveryDeliveryDeps {
  return {
    takeRecovery: (sessionId) => bridge.launcher?.takeRecovery?.(sessionId),
    isLeader: (sessionId) => bridge.launcher?.getSession(sessionId)?.isOrchestrator === true,
    sessionRef: (sessionId) => String(getKnownSessionNum(sessionId) ?? sessionId),
    broadcastToBrowsers: (session, message) => bridge.broadcastToBrowsers(session, message),
    persistSession: (session) => bridge.persistSession(session),
    injectUserMessage: (sessionId, content, agentSource, options) =>
      bridge.injectUserMessage(sessionId, content, agentSource, undefined, undefined, options),
    // Codex sessions get their recovery instructions and skills from their own developer instructions.
    ...(backend === "claude"
      ? {
          freshContext: {
            buildLeaderSkillPreloadBundles: () => buildLeaderSkillPreloadBundles(),
            buildMemoryCatalogInjectionBundle: async (session: SessionRecoveryDeliverySession) => {
              const { buildMemoryCatalogInjectionBundle } = await import("../memory-catalog-injection.js");
              return buildMemoryCatalogInjectionBundle({
                sessionId: session.id,
                repoOptions: { sessionSpaceSlug: session.state?.memorySessionSpaceSlug },
              });
            },
          },
        }
      : {}),
  };
}

/** Input for the session waits until its backend has been told what Takode rebuilt. */
export function isSessionRecoveryNoticePending(
  bridge: SessionRecoveryBridge,
  session: SessionRecoveryDeliverySession,
): boolean {
  return session.recoveryNoticeInFlight === true || !!bridge.launcher?.getSession(session.id)?.pendingRecovery;
}

/**
 * A Codex backend reported its session start. Note a lost conversation (the
 * thread to resume had real turns but is not saved on the machine; a thread
 * that never ran a turn has no saved rollout either), then start the notice.
 * Returns true while the notice is still on its way, so the caller holds the
 * queued input; `dispatch` runs once the notice is ahead of it.
 */
export function startCodexSessionRecoveryNotice(
  session: Pick<SessionRecoveryDeliverySession, "id" | "messageHistory" | "recoveryNoticeInFlight">,
  meta: { resumedThreadMissing?: boolean },
  deps: {
    noteConversationLost?: (sessionId: string) => void;
    deliverSessionRecoveryNotice?: (session: any, then: () => void) => boolean;
  },
  dispatch: () => void,
): boolean {
  if (meta.resumedThreadMissing && session.messageHistory.some((entry) => entry.type === "assistant")) {
    deps.noteConversationLost?.(session.id);
  }
  let returned = false;
  const started = deps.deliverSessionRecoveryNotice?.(session, () => {
    if (returned) dispatch();
  });
  returned = true;
  return !!started && session.recoveryNoticeInFlight === true;
}
