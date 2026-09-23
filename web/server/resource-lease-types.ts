export const DEFAULT_RESOURCE_LEASE_TTL_MS = 30 * 60_000;
export const RESOURCE_LEASE_SWEEP_INTERVAL_MS = 5_000;

export interface ResourceLease {
  resourceKey: string;
  slot: number;
  ownerSessionId: string;
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
  questId?: string;
  purpose: string;
  metadata: Record<string, string>;
  queuedAt: number;
  ttlMs: number;
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
