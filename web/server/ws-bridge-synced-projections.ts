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
import type { Session } from "./bridge/ws-bridge-session.js";
import { createSessionAttentionProjectionDefinition } from "./session-attention-projection.js";
import { createLeaderThreadTabsProjectionDefinition } from "./leader-thread-tabs-projection.js";
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
    const authorizeSubscription = (_socket: BrowserTransportSocketLike, session: Session) => {
      const launcherInfo = deps.getLauncherSessionInfo(session.id);
      return (
        launcherInfo?.hidden !== true &&
        launcherInfo?.archived !== true &&
        session.state.hidden !== true &&
        session.searchDataOnly !== true
      );
    };
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
        isLeaderSession: (session) =>
          session.state.isOrchestrator === true || deps.getLauncherSessionInfo(session.id)?.isOrchestrator === true,
        authorizeSubscription,
      }),
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
