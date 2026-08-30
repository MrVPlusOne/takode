import type {
  SyncedProjectionSnapshotMessage,
  SyncedProjectionSubscriptionIdentity,
  SyncedProjectionSubscriptionsAckMessage,
  SyncedProjectionUpdateMessage,
} from "../shared/synced-projection.js";
import type { AppState } from "./store-types.js";
import { cacheCoversSyncedProjectionSnapshot } from "./store-synced-projections.js";
import {
  reconcileStoredSyncedProjectionSnapshots,
  getCurrentActiveSessionListRequestSequence,
} from "./session-list-hydration.js";
import type { BrowserIncomingMessage } from "./types.js";
import type { WsIncomingMessageContext } from "./ws-message-context.js";

export interface SyncedProjectionMessageHandlerDeps {
  requestSyncedProjectionResync?: (carrierSessionId: string, projection: string, key: string) => boolean;
  hasPendingSyncedProjectionResync?: (carrierSessionId: string, projection: string, key: string) => boolean;
  resolveSyncedProjectionResync?: (carrierSessionId: string, projection: string, key: string) => void;
  noteAcceptedSyncedProjectionSnapshot?: (carrierSessionId: string, projection: string, key: string) => void;
  consumeSyncedProjectionSubscriptionsAck?: (
    carrierSessionId: string,
    subscriptions: readonly SyncedProjectionSubscriptionIdentity[],
  ) => SyncedProjectionSubscriptionIdentity[] | null;
  settleUnsupportedSyncedProjectionSubscriptions?: (
    carrierSessionId: string,
  ) => SyncedProjectionSubscriptionIdentity[] | null;
}

type SyncedProjectionStore = Pick<
  AppState,
  | "applySyncedProjectionSnapshot"
  | "applySyncedProjectionUpdate"
  | "reconcileSyncedProjectionAuthority"
  | "syncedProjectionKeys"
  | "syncedProjectionVersions"
>;

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
    } else if (snapshotCovered) {
      deps.noteAcceptedSyncedProjectionSnapshot?.(sessionId, snapshot.projection, snapshot.key);
      deps.resolveSyncedProjectionResync?.(sessionId, snapshot.projection, snapshot.key);
    }
    return true;
  }

  if (data.type === "synced_projection_update") {
    const update = data as SyncedProjectionUpdateMessage;
    const result = store.applySyncedProjectionUpdate(update, {
      activeRequestSequence: getCurrentActiveSessionListRequestSequence(),
    });
    if (result.requestResync) {
      deps.requestSyncedProjectionResync?.(sessionId, update.projection, update.key);
    }
    return true;
  }

  if (data.type === "synced_projection_subscriptions_ack") {
    const ack = data as SyncedProjectionSubscriptionsAckMessage;
    if (ack.complete !== true || !Array.isArray(ack.subscriptions)) return true;
    const accepted = deps.consumeSyncedProjectionSubscriptionsAck?.(sessionId, ack.subscriptions);
    if (accepted) {
      const revokedSubscriptions = reconcileStoredSyncedProjectionSnapshots(accepted);
      store.reconcileSyncedProjectionAuthority(accepted, {
        activeRequestSequence: getCurrentActiveSessionListRequestSequence(),
        revokedSubscriptions,
      });
    }
    return true;
  }

  return false;
}

/** A normal state snapshot closes initial subscribe. Missing ack means this carrier lacks projection support. */
export function settleSyncedProjectionSubscribeBoundary(
  sessionId: string,
  store: SyncedProjectionStore,
  deps: SyncedProjectionMessageHandlerDeps,
): void {
  const accepted = deps.settleUnsupportedSyncedProjectionSubscriptions?.(sessionId);
  if (!accepted) return;
  const revokedSubscriptions = reconcileStoredSyncedProjectionSnapshots(accepted);
  store.reconcileSyncedProjectionAuthority(accepted, {
    activeRequestSequence: getCurrentActiveSessionListRequestSequence(),
    revokedSubscriptions,
  });
}
