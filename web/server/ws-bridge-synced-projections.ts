import { randomUUID } from "node:crypto";
import {
  SESSION_ATTENTION_PROJECTION,
  type SessionAttentionProjectionValue,
} from "../shared/session-attention-projection.js";
import {
  SESSION_NAVIGATION_PROJECTION,
  type SessionNavigationProjectionValue,
  type SessionNavigationStatus,
} from "../shared/session-navigation-projection.js";
import {
  LEADER_THREAD_TABS_PROJECTION,
  LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES,
  type LeaderThreadTabsProjectionValue,
} from "../shared/leader-thread-tabs-projection.js";
import type {
  SyncedProjectionEnvelope,
  SyncedProjectionSnapshotMessage,
  SyncedProjectionSubscription,
  SyncedProjectionSubscriptionsAckMessage,
  SyncedProjectionUpdateMessage,
} from "../shared/synced-projection.js";
import { sendToBrowser, type BrowserTransportSocketLike } from "./bridge/browser-transport-controller.js";
import {
  applyLeaderServerCandidateThreadTabEvent,
  normalizeLeaderOpenThreadTabsState,
} from "../shared/leader-open-thread-tabs.js";
import type { Session } from "./bridge/ws-bridge-session.js";
import type { BrowserIncomingMessage } from "./session-types.js";
import { createSessionAttentionProjectionDefinition } from "./session-attention-projection.js";
import { createLeaderThreadTabsProjectionDefinition } from "./leader-thread-tabs-projection.js";
import { collectMessageAttentionRecords } from "../shared/leader-projection.js";
import { createSessionNavigationProjectionDefinition } from "./session-navigation-projection.js";
import type { SdkSessionInfo } from "./session-info.js";
import { SyncedProjectionRuntime, type SyncedProjectionRuntimeMetrics } from "./synced-projection-runtime.js";

export interface WsBridgeSyncedProjectionDeps {
  getSession: (sessionId: string) => Session | undefined;
  listSessions: () => Iterable<Session>;
  getLauncherSessionInfo: (sessionId: string) => SdkSessionInfo | null | undefined;
  getSessionName: (sessionId: string) => string | undefined;
  getPendingTimerCount: (sessionId: string) => number;
  getBackendConnected: (sessionId: string) => boolean;
  getSessionStatus: (sessionId: string) => SessionNavigationStatus;
  getLastActivityAt: (sessionId: string) => number | undefined;
  getLastUserMessageAt: (sessionId: string) => number | undefined;
  getLastMessagePreviewAt: (sessionId: string) => number | undefined;
  persistSession?: (session: Session) => void;
}

const COMPLETED_QUEST_STATUSES = new Set(["done", "completed", "needs_verification"]);
const ACTIVE_ATTENTION_STATES = new Set(["unresolved", "seen", "reopened"]);

function leaderSessionReferencesQuest(session: Session, questIds: ReadonlySet<string>): boolean {
  const matches = (value: unknown) => typeof value === "string" && questIds.has(value.trim().toLowerCase());
  if (session.state.leaderOpenThreadTabs?.orderedOpenThreadKeys.some(matches)) return true;

  for (const row of session.board.values()) {
    const status = row.status?.trim().toLowerCase() ?? "";
    if (row.completedAt === undefined && !COMPLETED_QUEST_STATUSES.has(status) && matches(row.questId)) return true;
  }
  for (const record of session.attentionRecords) {
    const active =
      ACTIVE_ATTENTION_STATES.has(record.state) ||
      (record.state === "muted" && record.type === "needs_input" && record.priority === "needs_input");
    const threadKey = record.route.threadKey || record.threadKey || record.questId;
    if (active && matches(threadKey)) return true;
  }
  for (const notification of session.notifications) {
    if (!notification.done && matches(notification.threadKey || notification.questId)) return true;
  }
  return false;
}

function leaderThreadTabHasActiveBoardRow(session: Session, questId: string): boolean {
  for (const row of session.board.values()) {
    if (row.questId.trim().toLowerCase() !== questId) continue;
    const status = row.status?.trim().toLowerCase() ?? "";
    return (
      row.completedAt === undefined &&
      status !== "queued" &&
      status !== "proposed" &&
      !COMPLETED_QUEST_STATUSES.has(status)
    );
  }
  return false;
}

function deferredLeaderThreadKeys(session: Session): Set<string> {
  const result = new Set<string>();
  for (const row of session.board.values()) {
    const questId = row.questId.trim().toLowerCase();
    const status = row.status?.trim().toLowerCase() ?? "";
    if (/^q-\d+$/.test(questId) && (status === "queued" || status === "proposed")) result.add(questId);
  }
  return result;
}

export class WsBridgeSyncedProjectionController {
  private readonly runtime: SyncedProjectionRuntime<BrowserTransportSocketLike>;

  constructor(private readonly deps: WsBridgeSyncedProjectionDeps) {
    this.runtime = new SyncedProjectionRuntime({
      generation: randomUUID(),
      maxValueBytes: LEADER_THREAD_TABS_PROJECTION_MAX_VALUE_BYTES,
      onError: (error, context) => {
        console.warn(`[synced-projection] ${context.phase} failed for ${context.projection}/${context.key}:`, error);
      },
    });
    const authorizeSubscription = (_socket: BrowserTransportSocketLike, session: Session) =>
      this.isProjectionVisibleSession(session);
    this.runtime.register(
      createSessionAttentionProjectionDefinition({
        getSession: deps.getSession,
        isHerdedWorkerSession: (session) => !!deps.getLauncherSessionInfo(session.id)?.herdedBy,
        authorizeSubscription,
      }),
    );
    this.runtime.register(
      createSessionNavigationProjectionDefinition({
        getSession: deps.getSession,
        getLauncherSessionInfo: deps.getLauncherSessionInfo,
        getSessionName: deps.getSessionName,
        getPendingTimerCount: deps.getPendingTimerCount,
        getBackendConnected: deps.getBackendConnected,
        getSessionStatus: deps.getSessionStatus,
        getLastActivityAt: deps.getLastActivityAt,
        getLastUserMessageAt: deps.getLastUserMessageAt,
        getLastMessagePreviewAt: deps.getLastMessagePreviewAt,
        authorizeSubscription,
      }),
    );
    this.runtime.register(
      createLeaderThreadTabsProjectionDefinition({
        getSession: deps.getSession,
        listSessions: deps.listSessions,
        isCurrentQuestSourceSession: (session) => this.isProjectionVisibleSession(session),
        isLeaderSession: (session) => this.isLeaderSession(session),
        authorizeSubscription,
      }),
    );
  }

  private isProjectionVisibleSession(session: Session): boolean {
    const launcherInfo = this.deps.getLauncherSessionInfo(session.id);
    return (
      launcherInfo?.hidden !== true &&
      launcherInfo?.archived !== true &&
      session.state.hidden !== true &&
      session.searchDataOnly !== true
    );
  }

  private isLeaderSession(session: Session): boolean {
    return (
      this.isProjectionVisibleSession(session) &&
      (session.state.isOrchestrator === true || this.deps.getLauncherSessionInfo(session.id)?.isOrchestrator === true)
    );
  }

  invalidateSession(session: Session): void {
    this.runtime.transaction(() => {
      this.runtime.invalidate(SESSION_ATTENTION_PROJECTION, session.id);
      this.runtime.invalidate(SESSION_NAVIGATION_PROJECTION, session.id);
      this.runtime.invalidate(LEADER_THREAD_TABS_PROJECTION, session.id);
    });
  }

  invalidateSessionNavigation(session: Session): void {
    this.runtime.invalidate(SESSION_NAVIGATION_PROJECTION, session.id);
  }

  promoteLeaderThreadTabForAttention(
    sessionId: string,
    threadKey: string,
    eventAt: number,
    kind: "primary" | "review",
  ): boolean {
    const session = this.deps.getSession(sessionId);
    const normalizedThreadKey = threadKey.trim().toLowerCase();
    if (
      !session ||
      !this.isLeaderSession(session) ||
      !/^q-\d+$/.test(normalizedThreadKey) ||
      !Number.isFinite(eventAt) ||
      eventAt < 0
    ) {
      return false;
    }
    const existingState = normalizeLeaderOpenThreadTabsState(session.state.leaderOpenThreadTabs);
    const alreadyOpen = existingState?.orderedOpenThreadKeys.includes(normalizedThreadKey) === true;
    // Active work is already in the leading class. Review/rework attention may
    // promote a missing, completed, scheduled, or otherwise non-active tab,
    // but ordinary active edits must not perturb its durable order.
    if (alreadyOpen && leaderThreadTabHasActiveBoardRow(session, normalizedThreadKey)) return false;
    const nextState = applyLeaderServerCandidateThreadTabEvent(existingState, normalizedThreadKey, eventAt, {
      repositionExisting: true,
      placement: kind === "review" ? "before" : "first",
      ...(kind === "review" ? { beforeThreadKeys: deferredLeaderThreadKeys(session) } : {}),
    });
    if (!nextState || nextState === existingState) return false;
    session.state = { ...session.state, leaderOpenThreadTabs: nextState };
    this.runtime.invalidate(LEADER_THREAD_TABS_PROJECTION, session.id);
    this.deps.persistSession?.(session);
    return true;
  }

  promoteLeaderThreadTabForMessageAttention(
    sessionId: string,
    message: Extract<BrowserIncomingMessage, { type: "user_message" }>,
  ): boolean {
    const record = collectMessageAttentionRecords(sessionId, [message]).find(
      (candidate) => candidate.type === "quest_reopened_or_rework",
    );
    if (!record) return false;
    return this.promoteLeaderThreadTabForAttention(sessionId, record.route.threadKey, record.updatedAt, "primary");
  }

  promoteLeaderThreadTabForQuest(questId: string, eventAt: number, _sourceSessionId: string): number {
    const normalizedQuestId = questId.trim().toLowerCase();
    if (!/^q-\d+$/.test(normalizedQuestId) || !Number.isFinite(eventAt) || eventAt < 0) return 0;
    const questIds = new Set([normalizedQuestId]);
    let changed = 0;

    for (const session of this.deps.listSessions()) {
      if (!this.isLeaderSession(session) || !leaderSessionReferencesQuest(session, questIds)) continue;
      const existingState = normalizeLeaderOpenThreadTabsState(session.state.leaderOpenThreadTabs);
      const nextState = applyLeaderServerCandidateThreadTabEvent(existingState, normalizedQuestId, eventAt, {
        repositionExisting: true,
      });
      if (!nextState || nextState === existingState) continue;
      session.state = { ...session.state, leaderOpenThreadTabs: nextState };
      changed += 1;
      this.runtime.invalidate(LEADER_THREAD_TABS_PROJECTION, session.id);
      this.deps.persistSession?.(session);
    }
    return changed;
  }

  invalidateLeaderThreadTabsForSessionQuestState(sessionId: string): number {
    const session = this.deps.getSession(sessionId);
    if (!session) return 0;
    return this.invalidateLeaderThreadTabsForQuestIds([
      session.state.claimedQuestId ?? "",
      ...session.board.keys(),
      ...session.completedBoard.keys(),
    ]);
  }

  invalidateLeaderThreadTabsForQuestIds(questIds: Iterable<string>): number {
    const normalizedQuestIds = new Set(
      [...questIds].map((questId) => questId.trim().toLowerCase()).filter((questId) => /^q-\d+$/.test(questId)),
    );
    if (normalizedQuestIds.size === 0) return 0;

    let invalidated = 0;
    this.runtime.transaction(() => {
      for (const session of this.deps.listSessions()) {
        if (
          !this.isLeaderSession(session) ||
          !this.runtime.hasSubscribers(LEADER_THREAD_TABS_PROJECTION, session.id) ||
          !leaderSessionReferencesQuest(session, normalizedQuestIds)
        ) {
          continue;
        }
        if (this.runtime.invalidate(LEADER_THREAD_TABS_PROJECTION, session.id)) invalidated += 1;
      }
    });
    return invalidated;
  }

  invalidateAllSessions(): void {
    this.runtime.transaction(() => {
      for (const session of this.deps.listSessions()) this.invalidateSession(session);
    });
  }

  getSessionAttentionSnapshot(sessionId: string): SyncedProjectionEnvelope<SessionAttentionProjectionValue> | null {
    return this.runtime.getSnapshot(SESSION_ATTENTION_PROJECTION, sessionId);
  }

  getSessionNavigationSnapshot(sessionId: string): SyncedProjectionEnvelope<SessionNavigationProjectionValue> | null {
    return this.runtime.getSnapshot(SESSION_NAVIGATION_PROJECTION, sessionId);
  }

  getLeaderThreadTabsSnapshot(sessionId: string): SyncedProjectionEnvelope<LeaderThreadTabsProjectionValue> | null {
    return this.runtime.getSnapshot(LEADER_THREAD_TABS_PROJECTION, sessionId);
  }

  replaceSubscriptions(
    socket: BrowserTransportSocketLike,
    subscriptions: readonly SyncedProjectionSubscription[],
  ): Array<SyncedProjectionSnapshotMessage | SyncedProjectionSubscriptionsAckMessage> {
    const replacement = this.runtime.replaceSubscriptions(socket, subscriptions, (subscriber, envelope) => {
      const update = {
        type: "synced_projection_update",
        ...envelope,
      } satisfies SyncedProjectionUpdateMessage;
      if (!sendToBrowser(subscriber, update)) throw new Error("Synced projection subscriber is not sendable");
    });
    return [
      ...replacement.snapshots.map((envelope) => ({ type: "synced_projection_snapshot" as const, ...envelope })),
      {
        type: "synced_projection_subscriptions_ack",
        subscriptions: replacement.acceptedSubscriptions,
        complete: true,
      },
    ];
  }

  resync(socket: BrowserTransportSocketLike, projection: string, key: string): SyncedProjectionSnapshotMessage | null {
    const envelope = this.runtime.resync(socket, projection, key);
    return envelope ? { type: "synced_projection_snapshot", ...envelope } : null;
  }

  removeSubscriber(socket: BrowserTransportSocketLike): void {
    this.runtime.removeSubscriber(socket);
  }

  hasSubscription(socket: BrowserTransportSocketLike, projection: string, key: string): boolean {
    return this.runtime.hasSubscription(socket, projection, key);
  }

  hasSessionNavigationSubscription(socket: BrowserTransportSocketLike, sessionId: string): boolean {
    return this.hasSubscription(socket, SESSION_NAVIGATION_PROJECTION, sessionId);
  }

  removeSession(sessionId: string): void {
    this.runtime.removeKey(SESSION_ATTENTION_PROJECTION, sessionId);
    this.runtime.removeKey(SESSION_NAVIGATION_PROJECTION, sessionId);
    this.runtime.removeKey(LEADER_THREAD_TABS_PROJECTION, sessionId);
  }

  getMetrics(): Readonly<SyncedProjectionRuntimeMetrics> {
    return this.runtime.getMetrics();
  }

  flushForTest(): Promise<void> {
    return this.runtime.flushForTest();
  }
}
