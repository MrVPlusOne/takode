import type {
  SyncedProjectionSnapshotMessage,
  SyncedProjectionSubscriptionIdentity,
  SyncedProjectionSubscriptionsAckMessage,
  SyncedProjectionUpdateMessage,
} from "../shared/synced-projection.js";
import { isValidSyncedProjectionIdentity, syncedProjectionEntryId } from "../shared/synced-projection.js";
import { isSyncedProjectionId } from "../shared/synced-projection-registry.js";
import type { AppState } from "./store-types.js";
import {
  cacheCoversSyncedProjectionSnapshot,
  isValidSyncedProjectionSnapshot,
  isValidSyncedProjectionUpdate,
} from "./store-synced-projections.js";
import {
  reconcileStoredSyncedProjectionSnapshots,
  getCurrentActiveSessionListRequestSequence,
} from "./session-list-hydration.js";
import type { BrowserIncomingMessage } from "./types.js";
import type { WsIncomingMessageContext } from "./ws-message-context.js";
import { getSyncedProjectionValue } from "./store-synced-projections.js";
import { THREAD_MONITORING_PROJECTION, type ThreadMonitoringProjectionValue } from "../shared/thread-monitoring.js";
import { playNewMonitoredResultSound } from "./ws-notification-handler.js";

export interface SyncedProjectionMessageHandlerDeps {
  requestSyncedProjectionResync?: (carrierSessionId: string, projection: string, key: string) => boolean;
  hasPendingSyncedProjectionResync?: (carrierSessionId: string, projection: string, key: string) => boolean;
  resolveSyncedProjectionResync?: (carrierSessionId: string, projection: string, key: string) => void;
  noteAcceptedSyncedProjectionSnapshot?: (carrierSessionId: string, projection: string, key: string) => void;
  consumeSyncedProjectionSubscriptionsAck?: (
    carrierSessionId: string,
    subscriptions: readonly SyncedProjectionSubscriptionIdentity[],
  ) => SyncedProjectionSubscriptionIdentity[] | null;
}

type SyncedProjectionStore = Pick<
  AppState,
  | "applySyncedProjectionSnapshot"
  | "applySyncedProjectionUpdate"
  | "reconcileSyncedProjectionAuthority"
  | "syncedProjectionKeys"
  | "syncedProjectionValues"
  | "syncedProjectionVersions"
>;

function requestMalformedProjectionResync(
  sessionId: string,
  message: { projection?: unknown; key?: unknown },
  deps: SyncedProjectionMessageHandlerDeps,
): void {
  if (!isSyncedProjectionId(message.projection) || !isValidSyncedProjectionIdentity(message.key)) return;
  deps.requestSyncedProjectionResync?.(sessionId, message.projection, message.key);
}

/** Apply direct projection protocol messages without routing them through legacy event handling. */
export function handleSyncedProjectionMessage(
  sessionId: string,
  data: BrowserIncomingMessage,
  store: SyncedProjectionStore,
  deps: SyncedProjectionMessageHandlerDeps,
  context: WsIncomingMessageContext,
): boolean {
  const isProjectionMessage =
    data.type === "synced_projection_snapshot" ||
    data.type === "synced_projection_update" ||
    data.type === "synced_projection_subscriptions_ack";
  if (isProjectionMessage && context.source !== "live") return true;

  if (data.type === "synced_projection_snapshot") {
    const snapshot = data as SyncedProjectionSnapshotMessage;
    const structurallyValid = isValidSyncedProjectionSnapshot(snapshot);
    const acceptSameRevisionConflict =
      deps.hasPendingSyncedProjectionResync?.(sessionId, snapshot.projection, snapshot.key) ?? false;
    const result = store.applySyncedProjectionSnapshot(snapshot, {
      acceptSameRevisionConflict,
      source: "live",
      activeRequestSequence: getCurrentActiveSessionListRequestSequence(),
    });
    const snapshotCovered = result.accepted || cacheCoversSyncedProjectionSnapshot(store, snapshot);
    if (result.requestResync) {
      deps.requestSyncedProjectionResync?.(sessionId, snapshot.projection, snapshot.key);
    } else if (!structurallyValid) {
      requestMalformedProjectionResync(sessionId, snapshot, deps);
    } else if (snapshotCovered) {
      deps.noteAcceptedSyncedProjectionSnapshot?.(sessionId, snapshot.projection, snapshot.key);
      deps.resolveSyncedProjectionResync?.(sessionId, snapshot.projection, snapshot.key);
    }
    return true;
  }

  if (data.type === "synced_projection_update") {
    const update = data as SyncedProjectionUpdateMessage;
    const previousMonitoring =
      update.projection === THREAD_MONITORING_PROJECTION
        ? getSyncedProjectionValue(store, THREAD_MONITORING_PROJECTION, update.key)
        : undefined;
    const structurallyValid = isValidSyncedProjectionUpdate(update);
    const result = store.applySyncedProjectionUpdate(update, {
      activeRequestSequence: getCurrentActiveSessionListRequestSequence(),
    });
    if (result.accepted && previousMonitoring && "value" in update) {
      const next = update.value as ThreadMonitoringProjectionValue;
      if (next.alertVersion > previousMonitoring.alertVersion) playNewMonitoredResultSound();
    }
    if (result.requestResync) {
      deps.requestSyncedProjectionResync?.(sessionId, update.projection, update.key);
    } else if (!structurallyValid) {
      requestMalformedProjectionResync(sessionId, update, deps);
    }
    return true;
  }

  if (data.type === "synced_projection_subscriptions_ack") {
    const ack = data as SyncedProjectionSubscriptionsAckMessage;
    if (ack.complete !== true || !Array.isArray(ack.subscriptions)) return true;
    // Entries the server found current were not resent; the held value covers them.
    for (const current of Array.isArray(ack.current) ? ack.current : []) {
      if (!isValidSyncedProjectionIdentity(current?.projection) || !isValidSyncedProjectionIdentity(current?.key)) {
        continue;
      }
      const entryId = syncedProjectionEntryId(current.projection, current.key);
      const held = store.syncedProjectionVersions.get(entryId);
      if (
        store.syncedProjectionKeys.has(entryId) &&
        held?.generation === current.generation &&
        held.revision >= current.revision
      ) {
        deps.noteAcceptedSyncedProjectionSnapshot?.(sessionId, current.projection, current.key);
      }
    }
    const accepted = deps.consumeSyncedProjectionSubscriptionsAck?.(sessionId, ack.subscriptions);
    if (accepted) {
      const revokedSubscriptions = reconcileStoredSyncedProjectionSnapshots(accepted);
      store.reconcileSyncedProjectionAuthority(accepted, {
        activeRequestSequence: getCurrentActiveSessionListRequestSequence(),
        revokedSubscriptions,
      });
      const acceptedIds = new Set(accepted.map(({ projection, key }) => `${projection}\u0000${key}`));
      for (const subscription of ack.subscriptions) {
        if (
          isSyncedProjectionId(subscription?.projection) &&
          isValidSyncedProjectionIdentity(subscription?.key) &&
          !acceptedIds.has(`${subscription.projection}\u0000${subscription.key}`)
        ) {
          deps.requestSyncedProjectionResync?.(sessionId, subscription.projection, subscription.key);
        }
      }
    }
    return true;
  }

  return false;
}
