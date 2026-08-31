/** Wire contract for small server-owned UI projections in one compatible build. */
export interface SyncedProjectionVersion {
  generation: string;
  revision: number;
}

export interface SyncedProjectionSubscription {
  projection: string;
  key: string;
}

export type SyncedProjectionSubscriptionIdentity = Pick<SyncedProjectionSubscription, "projection" | "key">;

export interface SyncedProjectionEnvelope<T = unknown> extends SyncedProjectionVersion {
  projection: string;
  key: string;
  value: T;
}

export interface SyncedProjectionPatchEnvelope<TPatch = unknown> extends SyncedProjectionVersion {
  projection: string;
  key: string;
  patch: TPatch;
}

export type SyncedProjectionSnapshotMessage<T = unknown> = SyncedProjectionEnvelope<T> & {
  type: "synced_projection_snapshot";
};

export type SyncedProjectionUpdateMessage<T = unknown, TPatch = unknown> = (
  | SyncedProjectionEnvelope<T>
  | SyncedProjectionPatchEnvelope<TPatch>
) & {
  type: "synced_projection_update";
};

export interface SyncedProjectionSubscribeMessage {
  type: "synced_projection_subscribe";
  subscriptions: SyncedProjectionSubscription[];
}

export interface SyncedProjectionResyncMessage {
  type: "synced_projection_resync";
  projection: string;
  key: string;
}

/** Authoritative completeness boundary for one replacement subscription set. */
export interface SyncedProjectionSubscriptionsAckMessage {
  type: "synced_projection_subscriptions_ack";
  subscriptions: SyncedProjectionSubscriptionIdentity[];
  complete: true;
}

export function syncedProjectionEntryId(projection: string, key: string): string {
  return `${projection}\u0000${key}`;
}

export function isValidSyncedProjectionIdentity(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 160 && !value.includes("\u0000");
}

export function isValidSyncedProjectionRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}
