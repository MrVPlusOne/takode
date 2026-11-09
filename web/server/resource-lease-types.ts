export const DEFAULT_RESOURCE_LEASE_TTL_MS = 30 * 60_000;
/** How long a held slot, or a place in line for one, lasts without a renewal unless its caller says otherwise. */
export const DEFAULT_HOLD_TTL_MS = 2 * 60_000;
/** Prefix of holders that clients (`takode lease run`) create; other holders belong to server components. */
export const CLIENT_HOLDER_PREFIX = "run:";
export const RESOURCE_LEASE_SWEEP_INTERVAL_MS = 5_000;

export interface ResourceLease {
  resourceKey: string;
  slot: number;
  ownerSessionId: string;
  /**
   * The running command that holds this slot, when one does (a held slot):
   * `run:<id>` for `takode lease run`, `exec:<job>` for `takode exec --pool`.
   * A session holds one slot of a pool for itself, but any number of held ones.
   */
  holderId?: string;
  questId?: string;
  purpose: string;
  metadata: Record<string, string>;
  acquiredAt: number;
  heartbeatAt: number;
  ttlMs: number;
  expiresAt: number;
}

export interface ResourceLeaseWaiter {
  id: string;
  resourceKey: string;
  waiterSessionId: string;
  /** The command waiting, for a held slot (see {@link ResourceLease.holderId}). */
  holderId?: string;
  questId?: string;
  purpose: string;
  metadata: Record<string, string>;
  queuedAt: number;
  ttlMs: number;
  /** A waiting command leaves the queue at this time unless its holder renews it. */
  expiresAt?: number;
}

export interface ResourceLeaseFile {
  version: 2;
  capacities: Record<string, number>;
  nextWaiterId: number;
  leases: ResourceLease[];
  waiters: Record<string, ResourceLeaseWaiter[]>;
}

export interface ResourceLeaseStatus {
  resourceKey: string;
  capacity: number;
  leases: ResourceLease[];
  waiters: ResourceLeaseWaiter[];
  available: boolean;
}

/** One pool a session is queued for, with the sessions currently holding its slots. */
export interface ResourceLeaseWait {
  resourceKey: string;
  holderSessionIds: string[];
  /** 1-based place in the pool's queue. */
  position: number;
  /** When the session's earliest entry in this queue joined it. */
  queuedAt?: number;
}

export interface ResourceLeaseAcquireInput {
  resourceKey: string;
  callerSessionId: string;
  questId?: string;
  purpose: string;
  metadata?: Record<string, string>;
  ttlMs?: number;
  waitIfUnavailable?: boolean;
}

export interface ResourceLeaseWaitInput extends ResourceLeaseAcquireInput {
  waitIfUnavailable: true;
}

export type ResourceLeaseAcquireResult =
  | {
      status: "acquired" | "already_owned";
      capacity: number;
      lease: ResourceLease;
      waiters: ResourceLeaseWaiter[];
    }
  | (ResourceLeaseStatus & {
      status: "queued";
      waiter: ResourceLeaseWaiter;
      position: number;
    })
  | (ResourceLeaseStatus & { status: "unavailable" });

export interface ResourceLeaseReleaseResult {
  released: ResourceLease;
  promoted: ResourceLease | null;
  waiters: ResourceLeaseWaiter[];
}

export interface ResourceLeaseRenewInput {
  slot?: number;
  resourceKey: string;
  callerSessionId: string;
  ttlMs?: number;
}

export interface ResourceLeaseHoldInput {
  /** Pools the command can take a slot of; it gets the first slot free in any of them. */
  resourceKeys: string[];
  holderId: string;
  callerSessionId: string;
  questId?: string;
  purpose: string;
  metadata?: Record<string, string>;
  /** How long the slot, or the place in line, lasts without a renewal (default {@link DEFAULT_HOLD_TTL_MS}). */
  ttlMs?: number;
}

/** Where a held slot's command stands: holding a slot, in line for one, or neither any more. */
export type ResourceLeaseHoldState =
  | { status: "held"; lease: ResourceLease }
  | { status: "queued"; resourceKeys: string[]; position: number }
  | { status: "gone" };
