import {
  DEFAULT_HOLD_TTL_MS,
  DEFAULT_RESOURCE_LEASE_TTL_MS,
  RESOURCE_LEASE_SWEEP_INTERVAL_MS,
} from "./resource-lease-types.js";
import type {
  ResourceLease,
  ResourceLeaseAcquireInput,
  ResourceLeaseAcquireResult,
  ResourceLeaseFile,
  ResourceLeaseHoldInput,
  ResourceLeaseHoldState,
  ResourceLeaseReleaseResult,
  ResourceLeaseRenewInput,
  ResourceLeaseStatus,
  ResourceLeaseWait,
  ResourceLeaseWaiter,
  ResourceLeaseWaitInput,
} from "./resource-lease-types.js";
import { emptyResourceLeaseFile, ResourceLeaseStore } from "./resource-lease-store.js";
import { formatLeaseWaitDuration, formatResourceLeaseMessageLine } from "../shared/resource-lease-message.js";

const MAX_PURPOSE_LENGTH = 300;
const MAX_RESOURCE_KEY_LENGTH = 120;
const MIN_TTL_MS = 5_000;
const MAX_TTL_MS = 24 * 60 * 60_000;
const LOG_TAG = "[resource-lease-manager]";

export class ResourceLeaseError extends Error {
  constructor(
    readonly code: "invalid" | "not_found" | "forbidden" | "conflict",
    message: string,
  ) {
    super(message);
  }
}

interface ResourceLeaseBridge {
  injectUserMessage: (
    sessionId: string,
    content: string,
    agentSource?: { sessionId: string; sessionLabel?: string },
  ) => "sent" | "queued" | "paused_queued" | "dropped" | "no_session";
  /** Republish a session's navigation row after its waiter state changes. */
  invalidateSessionNavigation: (sessionId: string) => void;
}

export class ResourceLeaseManager {
  private data: ResourceLeaseFile = emptyResourceLeaseFile();
  private loaded = false;
  private loading: Promise<void> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private operationQueue: Promise<unknown> = Promise.resolve();
  /** Owners that are server components, not sessions, keyed by owner ID prefix. */
  private systemOwners = new Map<string, (lease: ResourceLease) => void>();
  /** Callers waiting for a held slot's state to change, by holder. */
  private holdListeners = new Map<string, Set<() => void>>();

  constructor(
    private bridge: ResourceLeaseBridge,
    private store = new ResourceLeaseStore(),
  ) {}

  /**
   * Let a server component own leases under owner IDs, or holder IDs of held
   * slots, starting with `prefix`. When such an owner is promoted from a pool's
   * queue, `onPromoted` is called (outside the manager's lock) instead of
   * messaging a session.
   */
  registerSystemOwner(prefix: string, onPromoted: (lease: ResourceLease) => void): void {
    this.systemOwners.set(prefix, onPromoted);
  }

  async startAll(): Promise<void> {
    await this.ensureLoaded();
    await this.sweepExpiredNow();
    this.startSweep();
  }

  destroy(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
  }

  async acquire(input: ResourceLeaseAcquireInput): Promise<ResourceLeaseAcquireResult> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const normalized = normalizeAcquireInput(input);
      const changed = this.expireDueLeases(Date.now());
      const result = this.acquireLoaded(normalized);
      await this.persistIfNeeded(changed || result.status === "acquired" || result.status === "queued");
      return result;
    });
  }

  async wait(input: ResourceLeaseWaitInput): Promise<ResourceLeaseAcquireResult> {
    return this.acquire({ ...input, waitIfUnavailable: true });
  }

  async configure(resourceKeyInput: string, capacity: number): Promise<ResourceLeaseStatus> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const resourceKey = normalizeResourceKey(resourceKeyInput);
      if (!Number.isSafeInteger(capacity) || capacity < 1) {
        throw new ResourceLeaseError("invalid", "capacity must be a positive safe integer");
      }
      const changed = this.expireDueLeases(Date.now());
      await this.persistIfNeeded(changed);
      // Holders keep their slot numbers, so capacity may change while a pool is
      // busy as long as no held slot would fall outside the new range.
      const highestHeld = Math.max(0, ...this.getLeases(resourceKey).map((lease) => lease.slot));
      if (capacity < highestHeld) {
        throw new ResourceLeaseError(
          "conflict",
          `Capacity cannot drop below held slot ${highestHeld}; lower it after that slot is released`,
        );
      }
      if (this.data.capacities[resourceKey] !== capacity) {
        this.data.capacities[resourceKey] = capacity;
        // Raising a busy pool fills its new slots from the queue in FIFO order.
        this.promoteWaiters(resourceKey, Date.now());
        await this.persistIfNeeded(true);
      }
      return this.buildStatus(resourceKey);
    });
  }

  async renew(input: ResourceLeaseRenewInput): Promise<ResourceLease> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const resourceKey = normalizeResourceKey(input.resourceKey);
      const callerSessionId = normalizeSessionId(input.callerSessionId);
      const slot = this.validateSlot(resourceKey, input.slot);
      const ttlMs = normalizeTtlMs(input.ttlMs);
      await this.persistIfNeeded(this.expireDueLeases(Date.now()));
      const lease = this.selectLease(resourceKey, callerSessionId, slot, "renew");
      const now = Date.now();
      lease.heartbeatAt = now;
      lease.ttlMs = ttlMs ?? lease.ttlMs;
      lease.expiresAt = now + lease.ttlMs;
      await this.persistIfNeeded(true);
      return lease;
    });
  }

  async release(
    resourceKeyInput: string,
    callerSessionIdInput: string,
    force = false,
    slotInput?: number,
  ): Promise<ResourceLeaseReleaseResult> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const resourceKey = normalizeResourceKey(resourceKeyInput);
      const callerSessionId = normalizeSessionId(callerSessionIdInput);
      const slot = this.validateSlot(resourceKey, slotInput);
      if (force && slot === undefined && this.getCapacity(resourceKey) > 1) {
        throw new ResourceLeaseError("invalid", "Force release requires --slot for a multi-slot pool");
      }
      // Recovery targets the current record before expiry can replace it with
      // a queued successor. It never means release every slot in the pool.
      if (!force) await this.persistIfNeeded(this.expireDueLeases(Date.now()));
      const lease = this.selectLease(resourceKey, callerSessionId, force ? (slot ?? 1) : slot, "release", force);
      this.data.leases.splice(this.data.leases.indexOf(lease), 1);
      if (lease.holderId) this.wakeHolder(lease.holderId);
      const promoted = this.promoteWaiters(resourceKey, Date.now())[0] ?? null;
      await this.persistIfNeeded(true);
      return { released: lease, promoted, waiters: this.getWaiters(resourceKey) };
    });
  }

  /**
   * Leave a pool's queue without having been promoted. Returns whether the
   * session was queued. A held slot is untouched; release it instead.
   */
  async withdraw(resourceKeyInput: string, callerSessionIdInput: string): Promise<boolean> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const resourceKey = normalizeResourceKey(resourceKeyInput);
      const callerSessionId = normalizeSessionId(callerSessionIdInput);
      const waiters = this.getWaiters(resourceKey);
      const remaining = waiters.filter((waiter) => waiter.holderId || waiter.waiterSessionId !== callerSessionId);
      if (remaining.length === waiters.length) return false;
      this.setWaiters(resourceKey, remaining);
      await this.persistIfNeeded(true);
      return true;
    });
  }

  /** Sessions holding an unexpired slot of any pool whose key starts with `prefix`, read from loaded state. */
  holdersOf(prefix: string): string[] {
    const now = Date.now();
    const keyPrefix = prefix.trim().toLowerCase();
    return this.data.leases
      .filter((lease) => lease.resourceKey.startsWith(keyPrefix) && lease.expiresAt > now)
      .map((lease) => lease.ownerSessionId);
  }

  /** Whether the session holds a slot of the pool for itself (not a held slot), read synchronously from loaded state. */
  holdsLease(resourceKeyInput: string, sessionId: string): boolean {
    const resourceKey = resourceKeyInput.trim().toLowerCase();
    const now = Date.now();
    return this.data.leases.some(
      (lease) =>
        lease.resourceKey === resourceKey &&
        !lease.holderId &&
        lease.ownerSessionId === sessionId &&
        lease.expiresAt > now,
    );
  }

  /**
   * Take a held slot for a running command: a slot of the first of
   * `resourceKeys` with one free (the freest), or a place in line in all of them,
   * where the first slot to free up is taken and the other places are given up
   * in the same step. Unlike a session's own lease, a session may hold any
   * number of these, one per command, and promotion sends it no message: the
   * caller learns of it through {@link waitHold} or its system owner callback.
   * The slot or place lasts `ttlMs` past each renewal. Repeating the call for a
   * holder returns where it stands.
   */
  async hold(input: ResourceLeaseHoldInput): Promise<ResourceLeaseHoldState> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const holderId = normalizeHolderId(input.holderId);
      const resourceKeys = [...new Set(input.resourceKeys.map(normalizeResourceKey))];
      if (resourceKeys.length === 0) throw new ResourceLeaseError("invalid", "at least one resource key is required");
      const normalized = normalizeAcquireInput({
        ...input,
        resourceKey: resourceKeys[0]!,
        ttlMs: input.ttlMs ?? DEFAULT_HOLD_TTL_MS,
      });
      const now = Date.now();
      let changed = this.expireDueLeases(now);
      const current = this.holdStateLoaded(holderId);
      if (current.status !== "gone") {
        this.checkHolderOwner(holderId, normalized.callerSessionId);
        await this.persistIfNeeded(changed);
        return current;
      }
      const free = resourceKeys
        .map((resourceKey) => ({
          resourceKey,
          slot: this.lowestFreeSlot(resourceKey),
          free: this.freeSlots(resourceKey),
        }))
        .filter((pool) => pool.slot !== undefined && this.getWaiters(pool.resourceKey).length === 0)
        .sort((a, b) => b.free - a.free)[0];
      if (free) {
        this.data.leases.push({
          ...this.createLease({ ...normalized, resourceKey: free.resourceKey }, free.slot!, now),
          holderId,
        });
      } else {
        for (const resourceKey of resourceKeys) {
          const waiter: ResourceLeaseWaiter = {
            id: `w${this.data.nextWaiterId++}`,
            resourceKey,
            waiterSessionId: normalized.callerSessionId,
            holderId,
            ...(normalized.questId ? { questId: normalized.questId } : {}),
            purpose: normalized.purpose,
            metadata: normalized.metadata,
            queuedAt: now,
            ttlMs: normalized.ttlMs,
            expiresAt: now + normalized.ttlMs,
          };
          this.setWaiters(resourceKey, [...this.getWaiters(resourceKey), waiter]);
        }
      }
      changed = true;
      await this.persistIfNeeded(changed);
      return this.holdStateLoaded(holderId);
    });
  }

  /** Extend a held slot, or a place in line for one, by its TTL. `callerSessionId` must own it when given. */
  async renewHold(holderIdInput: string, callerSessionId?: string): Promise<ResourceLeaseHoldState> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const holderId = normalizeHolderId(holderIdInput);
      const now = Date.now();
      const expired = this.expireDueLeases(now);
      if (callerSessionId !== undefined) this.checkHolderOwner(holderId, callerSessionId);
      let renewed = false;
      for (const lease of this.data.leases) {
        if (lease.holderId !== holderId) continue;
        lease.heartbeatAt = now;
        lease.expiresAt = now + lease.ttlMs;
        renewed = true;
      }
      for (const waiter of Object.values(this.data.waiters).flat()) {
        if (waiter.holderId !== holderId) continue;
        waiter.expiresAt = now + waiter.ttlMs;
        renewed = true;
      }
      await this.persistIfNeeded(expired || renewed);
      return this.holdStateLoaded(holderId);
    });
  }

  /** Give up a held slot (filling it from its queue) and any places in line. Returns the slot given up, if any. */
  async releaseHold(holderIdInput: string, callerSessionId?: string): Promise<ResourceLease | null> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const holderId = normalizeHolderId(holderIdInput);
      if (callerSessionId !== undefined) this.checkHolderOwner(holderId, callerSessionId);
      const lease = this.data.leases.find((entry) => entry.holderId === holderId) ?? null;
      const queued = this.removeHolderWaiters(holderId);
      if (lease) {
        this.data.leases.splice(this.data.leases.indexOf(lease), 1);
        this.promoteWaiters(lease.resourceKey, Date.now());
      }
      this.wakeHolder(holderId);
      await this.persistIfNeeded(lease !== null || queued);
      return lease;
    });
  }

  /**
   * Where a held slot's command stands, once it differs from `known` or `ms`
   * passed. Shutdown ({@link releaseWaits}) answers early with the current state.
   */
  async waitHold(
    holderIdInput: string,
    known: ResourceLeaseHoldState["status"],
    ms: number,
  ): Promise<ResourceLeaseHoldState> {
    const holderId = normalizeHolderId(holderIdInput);
    // Listen before reading, so a change between the read and the wait still wakes it.
    let wake = () => {};
    const woken = new Promise<void>((resolve) => (wake = resolve));
    const listeners = this.holdListeners.get(holderId) ?? new Set();
    listeners.add(wake);
    this.holdListeners.set(holderId, listeners);
    const timer = setTimeout(wake, ms);
    try {
      const now = await this.runExclusive(async () => {
        await this.ensureLoaded();
        return this.holdStateLoaded(holderId);
      });
      if (now.status !== known || now.status === "gone") return now;
      await woken;
      return await this.runExclusive(async () => this.holdStateLoaded(holderId));
    } finally {
      clearTimeout(timer);
      listeners.delete(wake);
      if (listeners.size === 0) this.holdListeners.delete(holderId);
    }
  }

  /** Answer every {@link waitHold} now, as the server shuts down; callers simply ask again. */
  releaseWaits(): void {
    for (const listeners of this.holdListeners.values()) for (const wake of [...listeners]) wake();
  }

  /** Configured capacities by pool, for finding every machine a pool has slots on. */
  async capacities(): Promise<Record<string, number>> {
    await this.ensureLoaded();
    return { ...this.data.capacities };
  }

  async getStatus(resourceKeyInput: string): Promise<ResourceLeaseStatus> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const resourceKey = normalizeResourceKey(resourceKeyInput);
      const changed = this.expireDueLeases(Date.now());
      await this.persistIfNeeded(changed);
      return this.buildStatus(resourceKey);
    });
  }

  async listStatuses(): Promise<ResourceLeaseStatus[]> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const changed = this.expireDueLeases(Date.now());
      await this.persistIfNeeded(changed);
      const keys = new Set<string>([
        ...Object.keys(this.data.capacities),
        ...this.data.leases.map((lease) => lease.resourceKey),
        ...Object.keys(this.data.waiters).filter((key) => this.data.waiters[key]?.length),
      ]);
      return [...keys].sort().map((key) => this.buildStatus(key));
    });
  }

  /** Pools the session is queued for, read synchronously for session status projections. */
  getWaitingResourceKeys(sessionId: string): string[] {
    const keys = Object.values(this.data.waiters)
      .flat()
      .filter((waiter) => waiter.waiterSessionId === sessionId)
      .map((waiter) => waiter.resourceKey);
    // Several of the session's commands may wait in one pool.
    return [...new Set(keys)];
  }

  /**
   * Pools the session is queued for, its place in each queue and who holds them,
   * read synchronously by the board stall check and session status projections.
   */
  getLeaseWaits(sessionId: string): ResourceLeaseWait[] {
    return this.getWaitingResourceKeys(sessionId).map((resourceKey) => {
      const waiters = this.getWaiters(resourceKey);
      const index = waiters.findIndex((waiter) => waiter.waiterSessionId === sessionId);
      return {
        resourceKey,
        holderSessionIds: [...new Set(this.getLeases(resourceKey).map((lease) => lease.ownerSessionId))],
        position: index + 1,
        queuedAt: Math.min(
          ...waiters.filter((waiter) => waiter.waiterSessionId === sessionId).map((waiter) => waiter.queuedAt),
        ),
      };
    });
  }

  /**
   * One line on where a command waiting for a held slot stands, for the
   * periodic note its caller prints while it waits: per pool, its place in
   * line, who holds the slots (`sessionLabel` names a session) and how long
   * since a slot last changed hands. A long time there with every slot held by
   * the waiting session itself is how a nested-slot deadlock looks. Null when
   * the command is not in line. Reads loaded state synchronously.
   */
  describeHoldWait(holderIdInput: string, now: number, sessionLabel: (sessionId: string) => string): string | null {
    const holderId = normalizeHolderId(holderIdInput);
    const pools = Object.entries(this.data.waiters).flatMap(([resourceKey, waiters]) => {
      const index = waiters.findIndex((waiter) => waiter.holderId === holderId);
      return index === -1 ? [] : [{ resourceKey, position: index + 1 }];
    });
    if (pools.length === 0) return null;
    return pools
      .map(({ resourceKey, position }) => {
        const leases = this.getLeases(resourceKey);
        const counts = new Map<string, number>();
        for (const lease of leases) counts.set(lease.ownerSessionId, (counts.get(lease.ownerSessionId) ?? 0) + 1);
        const holders = [...counts].map(
          ([sessionId, count]) => `${sessionLabel(sessionId)}${count > 1 ? ` x${count}` : ""}`,
        );
        const held = `${leases.length}/${this.getCapacity(resourceKey)} slots held`;
        const lastChange = Math.max(0, ...leases.map((lease) => lease.acquiredAt));
        return (
          `${resourceKey}: place ${position} in line, ${held}` +
          (holders.length > 0 ? ` by ${holders.join(", ")}` : "") +
          (lastChange > 0 ? `, none changed hands for ${formatLeaseWaitDuration(now - lastChange)}` : "")
        );
      })
      .join("; ");
  }

  async sweepExpiredNow(now = Date.now()): Promise<void> {
    return this.runExclusive(async () => {
      await this.ensureLoaded();
      const expired = this.expireDueLeases(now);
      await this.persistIfNeeded(expired);
    });
  }

  private acquireLoaded(
    input: Required<Omit<ResourceLeaseAcquireInput, "questId">> & { questId?: string },
  ): ResourceLeaseAcquireResult {
    const now = Date.now();
    const capacity = this.getCapacity(input.resourceKey);
    const existing = this.getLeases(input.resourceKey).find(
      (lease) => !lease.holderId && lease.ownerSessionId === input.callerSessionId,
    );
    if (existing) {
      return { status: "already_owned", capacity, lease: existing, waiters: this.getWaiters(input.resourceKey) };
    }
    const slot = this.lowestFreeSlot(input.resourceKey);
    if (slot !== undefined) {
      const lease = this.createLease(input, slot, now);
      this.data.leases.push(lease);
      return { status: "acquired", capacity, lease, waiters: this.getWaiters(input.resourceKey) };
    }
    if (!input.waitIfUnavailable) return { status: "unavailable", ...this.buildStatus(input.resourceKey) };
    const waiter = this.addWaiter(input, now);
    const pool = this.buildStatus(input.resourceKey);
    return {
      status: "queued",
      ...pool,
      waiter,
      position: pool.waiters.findIndex((entry) => entry.id === waiter.id) + 1,
    };
  }

  private expireDueLeases(now: number): boolean {
    const expired = this.data.leases.filter((lease) => lease.expiresAt <= now);
    // Remove only expired records, then fill all free slots. Removing by resource
    // would incorrectly erase still-active siblings in a counted pool.
    this.data.leases = this.data.leases.filter((lease) => lease.expiresAt > now);
    for (const lease of expired) {
      console.log(
        `${LOG_TAG} Expired lease for ${lease.resourceKey} slot ${lease.slot} owned by ${lease.holderId ?? lease.ownerSessionId.slice(0, 8)}`,
      );
      if (lease.holderId) this.wakeHolder(lease.holderId);
    }
    let changed = expired.length > 0;
    // A waiting command whose caller stopped renewing has gone away: it leaves every line.
    for (const resourceKey of Object.keys(this.data.waiters)) {
      const waiters = this.getWaiters(resourceKey);
      const stale = waiters.filter((waiter) => waiter.expiresAt !== undefined && waiter.expiresAt <= now);
      if (stale.length === 0) continue;
      this.setWaiters(
        resourceKey,
        waiters.filter((waiter) => !stale.includes(waiter)),
      );
      for (const waiter of stale) if (waiter.holderId) this.wakeHolder(waiter.holderId);
      changed = true;
    }
    for (const resourceKey of Object.keys(this.data.waiters)) {
      if (this.promoteWaiters(resourceKey, now).length > 0) changed = true;
    }
    return changed;
  }

  private promoteWaiters(resourceKey: string, now: number): ResourceLease[] {
    const waiters = this.getWaiters(resourceKey);
    const promoted: ResourceLease[] = [];
    let slot = this.lowestFreeSlot(resourceKey);
    // Each iteration consumes a waiter and fills a slot, so the loop is bounded
    // by both the queue and the remaining capacity. Newcomers cannot bypass it.
    while (waiters.length > 0 && slot !== undefined) {
      const waiter = waiters.shift()!;
      const lease = this.createLease(
        { ...waiter, callerSessionId: waiter.waiterSessionId, waitIfUnavailable: true },
        slot,
        now,
      );
      if (waiter.holderId) {
        lease.holderId = waiter.holderId;
        // A command waiting in several pools takes this slot and leaves the other lines in the same step.
        this.removeHolderWaiters(waiter.holderId, resourceKey);
      }
      this.data.leases.push(lease);
      promoted.push(lease);
      this.notifyPromotedWaiter(lease, waiter.queuedAt);
      slot = this.lowestFreeSlot(resourceKey);
    }
    this.setWaiters(resourceKey, waiters);
    return promoted;
  }

  private notifyPromotedWaiter(lease: ResourceLease, queuedAt: number): void {
    const owner = lease.holderId ?? lease.ownerSessionId;
    for (const [prefix, onPromoted] of this.systemOwners) {
      if (!owner.startsWith(prefix)) continue;
      // The owner calls back into this manager, so it runs after the current operation.
      setTimeout(() => onPromoted(lease), 0);
      console.log(`${LOG_TAG} Promoted ${owner} for ${lease.resourceKey}`);
      return;
    }
    if (lease.holderId) {
      // Its caller is waiting for exactly this; the session is not interrupted.
      this.wakeHolder(lease.holderId);
      return;
    }
    const lines = [
      `[Resource lease acquired] You now hold \`${lease.resourceKey}\`.`,
      "",
      formatResourceLeaseMessageLine("slot", `${lease.slot} of ${this.getCapacity(lease.resourceKey)}`),
      formatResourceLeaseMessageLine("purpose", lease.purpose),
      formatResourceLeaseMessageLine("acquired", new Date(lease.acquiredAt).toISOString()),
      formatResourceLeaseMessageLine("waited", formatLeaseWaitDuration(lease.acquiredAt - queuedAt)),
      formatResourceLeaseMessageLine("expires", new Date(lease.expiresAt).toISOString()),
      "",
      `Heartbeat with \`takode lease renew ${lease.resourceKey}\`; release with \`takode lease release ${lease.resourceKey}\` when done.`,
    ];
    const delivery = this.bridge.injectUserMessage(lease.ownerSessionId, lines.join("\n"), {
      sessionId: `resource-lease:${lease.resourceKey}`,
      sessionLabel: "Resource Lease",
    });
    console.log(`${LOG_TAG} Promoted waiter for ${lease.resourceKey}: ${delivery}`);
  }

  private createLease(
    input: Required<Omit<ResourceLeaseAcquireInput, "questId">> & { questId?: string },
    slot: number,
    now: number,
  ): ResourceLease {
    return {
      resourceKey: input.resourceKey,
      slot,
      ownerSessionId: input.callerSessionId,
      ...(input.questId ? { questId: input.questId } : {}),
      purpose: input.purpose,
      metadata: input.metadata,
      acquiredAt: now,
      heartbeatAt: now,
      ttlMs: input.ttlMs,
      expiresAt: now + input.ttlMs,
    };
  }

  private addWaiter(
    input: Required<Omit<ResourceLeaseAcquireInput, "questId">> & { questId?: string },
    now: number,
  ): ResourceLeaseWaiter {
    const existing = this.getWaiters(input.resourceKey).find(
      (waiter) => !waiter.holderId && waiter.waiterSessionId === input.callerSessionId,
    );
    if (existing) return existing;

    const waiter: ResourceLeaseWaiter = {
      id: `w${this.data.nextWaiterId++}`,
      resourceKey: input.resourceKey,
      waiterSessionId: input.callerSessionId,
      ...(input.questId ? { questId: input.questId } : {}),
      purpose: input.purpose,
      metadata: input.metadata,
      queuedAt: now,
      ttlMs: input.ttlMs,
    };
    this.setWaiters(input.resourceKey, [...this.getWaiters(input.resourceKey), waiter]);
    return waiter;
  }

  private holdStateLoaded(holderId: string): ResourceLeaseHoldState {
    const lease = this.data.leases.find((entry) => entry.holderId === holderId);
    if (lease) return { status: "held", lease };
    const places = Object.entries(this.data.waiters).flatMap(([resourceKey, waiters]) => {
      const index = waiters.findIndex((waiter) => waiter.holderId === holderId);
      return index === -1 ? [] : [{ resourceKey, position: index + 1 }];
    });
    if (places.length === 0) return { status: "gone" };
    return {
      status: "queued",
      resourceKeys: places.map((place) => place.resourceKey),
      position: Math.min(...places.map((place) => place.position)),
    };
  }

  private checkHolderOwner(holderId: string, callerSessionId: string): void {
    const owners = [
      ...this.data.leases.filter((lease) => lease.holderId === holderId).map((lease) => lease.ownerSessionId),
      ...Object.values(this.data.waiters)
        .flat()
        .filter((waiter) => waiter.holderId === holderId)
        .map((waiter) => waiter.waiterSessionId),
    ];
    if (owners.some((owner) => owner !== callerSessionId)) {
      throw new ResourceLeaseError("forbidden", `${holderId} belongs to another session`);
    }
  }

  /** Remove a holder from every pool's line except `except`'s. Returns whether it was in any. */
  private removeHolderWaiters(holderId: string, except?: string): boolean {
    let removed = false;
    for (const resourceKey of Object.keys(this.data.waiters)) {
      if (resourceKey === except) continue;
      const waiters = this.getWaiters(resourceKey);
      const remaining = waiters.filter((waiter) => waiter.holderId !== holderId);
      if (remaining.length === waiters.length) continue;
      this.setWaiters(resourceKey, remaining);
      removed = true;
    }
    return removed;
  }

  private wakeHolder(holderId: string): void {
    for (const wake of [...(this.holdListeners.get(holderId) ?? [])]) wake();
  }

  private freeSlots(resourceKey: string): number {
    return this.getCapacity(resourceKey) - this.getLeases(resourceKey).length;
  }

  private buildStatus(resourceKey: string): ResourceLeaseStatus {
    const capacity = this.getCapacity(resourceKey);
    const leases = this.getLeases(resourceKey);
    const waiters = this.getWaiters(resourceKey);
    return {
      resourceKey,
      capacity,
      leases,
      waiters,
      available: leases.length < capacity && waiters.length === 0,
    };
  }

  private getCapacity(resourceKey: string): number {
    return Object.hasOwn(this.data.capacities, resourceKey) ? this.data.capacities[resourceKey] : 1;
  }

  private getLeases(resourceKey: string): ResourceLease[] {
    return this.data.leases.filter((lease) => lease.resourceKey === resourceKey).sort((a, b) => a.slot - b.slot);
  }

  private lowestFreeSlot(resourceKey: string): number | undefined {
    const occupied = new Set(this.getLeases(resourceKey).map((lease) => lease.slot));
    // At most occupied.size + 1 probes, even for a very large configured pool.
    for (let slot = 1; slot <= this.getCapacity(resourceKey); slot++) {
      if (!occupied.has(slot)) return slot;
    }
    return undefined;
  }

  private validateSlot(resourceKey: string, slot: number | undefined): number | undefined {
    if (slot !== undefined && (!Number.isSafeInteger(slot) || slot < 1 || slot > this.getCapacity(resourceKey))) {
      throw new ResourceLeaseError("invalid", `slot must be between 1 and ${this.getCapacity(resourceKey)}`);
    }
    return slot;
  }

  private selectLease(
    resourceKey: string,
    caller: string,
    slot: number | undefined,
    action: string,
    force = false,
  ): ResourceLease {
    const leases = this.getLeases(resourceKey);
    const lease =
      slot === undefined
        ? leases.find((entry) => !entry.holderId && entry.ownerSessionId === caller)
        : leases.find((entry) => entry.slot === slot);
    if (lease?.holderId && !force) {
      throw new ResourceLeaseError(
        "conflict",
        `Slot ${lease.slot} of ${resourceKey} is held by a running command (${lease.holderId}); it is freed when that command ends`,
      );
    }
    if (!lease && (slot !== undefined || leases.length === 0)) {
      throw new ResourceLeaseError(
        "not_found",
        `No active lease for ${resourceKey}${slot === undefined ? "" : ` slot ${slot}`}`,
      );
    }
    if (!lease || (!force && lease.ownerSessionId !== caller)) {
      throw new ResourceLeaseError(
        "forbidden",
        `Only ${lease?.ownerSessionId ?? (leases.length === 1 ? leases[0].ownerSessionId : "the slot owner")} can ${action} ${resourceKey}`,
      );
    }
    return lease;
  }

  private getWaiters(resourceKey: string): ResourceLeaseWaiter[] {
    return Object.hasOwn(this.data.waiters, resourceKey) ? [...this.data.waiters[resourceKey]] : [];
  }

  /**
   * Replace a pool's queue. Every session that was or is in it is republished,
   * since joining, leaving or promotion moves the places of everyone behind.
   */
  private setWaiters(resourceKey: string, waiters: ResourceLeaseWaiter[]): void {
    const previous = this.getWaiters(resourceKey);
    if (waiters.length === 0) delete this.data.waiters[resourceKey];
    else this.data.waiters[resourceKey] = waiters;
    const unchanged =
      previous.length === waiters.length && previous.every((waiter, index) => waiter.id === waiters[index]!.id);
    if (unchanged) return;
    const affected = new Set([...previous, ...waiters].map((waiter) => waiter.waiterSessionId));
    for (const sessionId of affected) this.bridge.invalidateSessionNavigation(sessionId);
  }

  private startSweep(): void {
    this.destroy();
    this.sweepTimer = setInterval(() => {
      void this.sweepExpiredNow();
    }, RESOURCE_LEASE_SWEEP_INTERVAL_MS);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (!this.loading) {
      this.loading = this.store.load().then((data) => {
        this.data = data;
        this.loaded = true;
        // Rows projected before the persisted queue loaded showed no lease wait.
        for (const waiter of Object.values(data.waiters).flat()) {
          this.bridge.invalidateSessionNavigation(waiter.waiterSessionId);
        }
      });
    }
    await this.loading;
  }

  private async persistIfNeeded(changed: boolean): Promise<void> {
    if (changed) await this.store.save(this.data);
  }

  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.operationQueue.then(fn, fn);
    this.operationQueue = run.catch(() => undefined);
    return run;
  }
}

function normalizeAcquireInput(
  input: ResourceLeaseAcquireInput,
): Required<Omit<ResourceLeaseAcquireInput, "questId">> & { questId?: string } {
  const purpose = input.purpose.trim();
  if (!purpose) throw new ResourceLeaseError("invalid", "purpose is required");
  if (purpose.length > MAX_PURPOSE_LENGTH) {
    throw new ResourceLeaseError("invalid", `purpose must be ${MAX_PURPOSE_LENGTH} characters or less`);
  }
  const questId = normalizeQuestId(input.questId);
  return {
    resourceKey: normalizeResourceKey(input.resourceKey),
    callerSessionId: normalizeSessionId(input.callerSessionId),
    ...(questId ? { questId } : {}),
    purpose,
    metadata: normalizeMetadata(input.metadata),
    ttlMs: normalizeTtlMs(input.ttlMs) ?? DEFAULT_RESOURCE_LEASE_TTL_MS,
    waitIfUnavailable: input.waitIfUnavailable === true,
  };
}

function normalizeResourceKey(resourceKey: string): string {
  const key = resourceKey.trim().toLowerCase();
  if (!key) throw new ResourceLeaseError("invalid", "resource key is required");
  if (key.length > MAX_RESOURCE_KEY_LENGTH) {
    throw new ResourceLeaseError("invalid", `resource key must be ${MAX_RESOURCE_KEY_LENGTH} characters or less`);
  }
  // Slashes allow branch names in port keys. An optional `@<host>` suffix names
  // the machine a machine-local resource is on.
  if (!/^[a-z0-9][a-z0-9._:/-]*(@[a-z0-9][a-z0-9._-]*)?$/.test(key)) {
    throw new ResourceLeaseError(
      "invalid",
      "resource key must use letters, numbers, dot, underscore, colon, slash, or hyphen, optionally followed by @<host>",
    );
  }
  return key;
}

function normalizeHolderId(holderId: string): string {
  const normalized = holderId.trim();
  if (!/^[a-z]+:[A-Za-z0-9._-]{1,100}$/.test(normalized)) {
    throw new ResourceLeaseError("invalid", "holder id must look like run:<id> or exec:<id>");
  }
  return normalized;
}

function normalizeSessionId(sessionId: string): string {
  const normalized = sessionId.trim();
  if (!normalized) throw new ResourceLeaseError("invalid", "session id is required");
  return normalized;
}

function normalizeQuestId(questId: string | undefined): string | undefined {
  const normalized = questId?.trim().toLowerCase();
  if (!normalized) return undefined;
  if (!/^q-\d+$/.test(normalized)) throw new ResourceLeaseError("invalid", "questId must match q-N");
  return normalized;
}

function normalizeTtlMs(ttlMs: number | undefined): number | undefined {
  if (ttlMs === undefined) return undefined;
  if (!Number.isFinite(ttlMs) || ttlMs < MIN_TTL_MS || ttlMs > MAX_TTL_MS) {
    throw new ResourceLeaseError("invalid", `ttlMs must be between ${MIN_TTL_MS} and ${MAX_TTL_MS} milliseconds`);
  }
  return Math.floor(ttlMs);
}

function normalizeMetadata(metadata: Record<string, string> | undefined): Record<string, string> {
  if (!metadata) return {};
  const entries = Object.entries(metadata)
    .map(([key, value]) => [key.trim(), String(value ?? "").trim()] as const)
    .filter(([key, value]) => key.length > 0 && value.length > 0)
    .slice(0, 20);
  return Object.fromEntries(entries);
}
