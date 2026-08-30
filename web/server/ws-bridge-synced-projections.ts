import { randomUUID } from "node:crypto";
import {
  SESSION_ATTENTION_PROJECTION,
  type SessionAttentionProjectionValue,
} from "../shared/session-attention-projection.js";
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
import { SyncedProjectionRuntime, type SyncedProjectionRuntimeMetrics } from "./synced-projection-runtime.js";

export interface WsBridgeSyncedProjectionDeps {
  getSession: (sessionId: string) => Session | undefined;
  listSessions: () => Iterable<Session>;
  getLauncherSessionInfo: (sessionId: string) =>
    | {
        hidden?: boolean;
        archived?: boolean;
        herdedBy?: string;
      }
    | null
    | undefined;
}

export class WsBridgeSyncedProjectionController {
  private readonly runtime: SyncedProjectionRuntime<BrowserTransportSocketLike>;

  constructor(private readonly deps: WsBridgeSyncedProjectionDeps) {
    this.runtime = new SyncedProjectionRuntime({
      generation: randomUUID(),
      onError: (error, context) => {
        console.warn(`[synced-projection] ${context.phase} failed for ${context.projection}/${context.key}:`, error);
      },
    });
    this.runtime.register(
      createSessionAttentionProjectionDefinition({
        getSession: deps.getSession,
        isHerdedWorkerSession: (session) => !!deps.getLauncherSessionInfo(session.id)?.herdedBy,
        authorizeSubscription: (_socket, session) => {
          const launcherInfo = deps.getLauncherSessionInfo(session.id);
          return (
            launcherInfo?.hidden !== true &&
            launcherInfo?.archived !== true &&
            session.state.hidden !== true &&
            session.searchDataOnly !== true
          );
        },
      }),
    );
  }

  invalidateSession(session: Session): void {
    this.runtime.invalidate(SESSION_ATTENTION_PROJECTION, session.id);
  }

  invalidateAllSessions(): void {
    this.runtime.transaction(() => {
      for (const session of this.deps.listSessions()) this.invalidateSession(session);
    });
  }

  getSessionAttentionSnapshot(sessionId: string): SyncedProjectionEnvelope<SessionAttentionProjectionValue> | null {
    return this.runtime.getSnapshot(SESSION_ATTENTION_PROJECTION, sessionId);
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

  removeSession(sessionId: string): void {
    this.runtime.removeKey(SESSION_ATTENTION_PROJECTION, sessionId);
  }

  getMetrics(): Readonly<SyncedProjectionRuntimeMetrics> {
    return this.runtime.getMetrics();
  }

  flushForTest(): Promise<void> {
    return this.runtime.flushForTest();
  }
}
