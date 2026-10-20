/** Wire contract for small server-owned UI projections in one compatible build. */
export interface SyncedProjectionVersion {
  generation: string;
  revision: number;
}

export interface SyncedProjectionSubscription {
  projection: string;
  key: string;
  /** The version the subscriber already holds; if still current, it is acknowledged instead of re-sent. */
  known?: SyncedProjectionVersion;
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

/**
 * Authoritative completeness boundary for one replacement subscription set.
 * Compact, as a subscriber names a few hundred subscriptions: both lists refer
 * to the subscription request it answers.
 */
export interface SyncedProjectionSubscriptionsAckMessage {
  type: "synced_projection_subscriptions_ack";
  /** The accepted subscriptions; absent with `all_accepted`. */
  subscriptions?: SyncedProjectionSubscriptionIdentity[];
  /** Every subscription of the request was accepted. */
  all_accepted?: true;
  /** Positions in the request of accepted subscriptions whose `known` version is current, so no snapshot was sent for them. */
  current_indexes?: number[];
  complete: true;
}

/** An acknowledgement in full: the accepted subscriptions, and those found current with their (known) version. */
export interface ExpandedSyncedProjectionSubscriptionsAck {
  subscriptions: SyncedProjectionSubscriptionIdentity[];
  current: Array<SyncedProjectionSubscriptionIdentity & SyncedProjectionVersion>;
}

/** Reads a compact acknowledgement against the subscription request it answers; null when it is malformed. */
export function expandSyncedProjectionSubscriptionsAck(
  ack: SyncedProjectionSubscriptionsAckMessage,
  requested: readonly SyncedProjectionSubscription[],
): ExpandedSyncedProjectionSubscriptionsAck | null {
  const subscriptions = ack.all_accepted
    ? requested.map(({ projection, key }) => ({ projection, key }))
    : Array.isArray(ack.subscriptions)
      ? ack.subscriptions
      : null;
  if (!subscriptions) return null;
  const current: ExpandedSyncedProjectionSubscriptionsAck["current"] = [];
  for (const index of Array.isArray(ack.current_indexes) ? ack.current_indexes : []) {
    const subscription = Number.isInteger(index) ? requested[index] : undefined;
    if (!subscription?.known) continue;
    current.push({
      projection: subscription.projection,
      key: subscription.key,
      ...subscription.known,
    });
  }
  return { subscriptions, current };
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
