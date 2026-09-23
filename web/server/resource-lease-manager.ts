import { DEFAULT_RESOURCE_LEASE_TTL_MS, RESOURCE_LEASE_SWEEP_INTERVAL_MS } from "./resource-lease-types.js";
import type {
  ResourceLease,
  ResourceLeaseAcquireInput,
  ResourceLeaseAcquireResult,
  ResourceLeaseFile,
  ResourceLeaseReleaseResult,
  ResourceLeaseRenewInput,
  ResourceLeaseStatus,
  ResourceLeaseWaiter,
  ResourceLeaseWaitInput,
} from "./resource-lease-types.js";
import { emptyResourceLeaseFile, ResourceLeaseStore } from "./resource-lease-store.js";

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
}

export class ResourceLeaseManager {
  private data: ResourceLeaseFile = emptyResourceLeaseFile();
  private loaded = false;
  private loading: Promise<void> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private operationQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private bridge: ResourceLeaseBridge,
    private store = new ResourceLeaseStore(),
  ) {}

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
      if (capacity !== this.getCapacity(resourceKey) && this.getLeases(resourceKey).length > 0) {
        throw new ResourceLeaseError("conflict", "Capacity can change only when no slots are leased");
      }
      if (this.data.capacities[resourceKey] !== capacity) {
        this.data.capacities[resourceKey] = capacity;
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
      const promoted = this.promoteWaiters(resourceKey, Date.now())[0] ?? null;
      await this.persistIfNeeded(true);
      return { released: lease, promoted, waiters: this.getWaiters(resourceKey) };
    });
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
    const existing = this.getLeases(input.resourceKey).find((lease) => lease.ownerSessionId === input.callerSessionId);
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
        `${LOG_TAG} Expired lease for ${lease.resourceKey} slot ${lease.slot} owned by ${lease.ownerSessionId.slice(0, 8)}`,
      );
    }
    let changed = expired.length > 0;
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
      this.data.leases.push(lease);
      promoted.push(lease);
      this.notifyPromotedWaiter(lease);
      slot = this.lowestFreeSlot(resourceKey);
    }
    this.setWaiters(resourceKey, waiters);
    return promoted;
  }

  private notifyPromotedWaiter(lease: ResourceLease): void {
    const lines = [
      `[Resource lease acquired] You now hold \`${lease.resourceKey}\`.`,
      "",
      `Slot: ${lease.slot} of ${this.getCapacity(lease.resourceKey)}`,
      `Purpose: ${lease.purpose}`,
      `Expires: ${new Date(lease.expiresAt).toISOString()}`,
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
      (waiter) => waiter.waiterSessionId === input.callerSessionId,
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

  private buildStatus(resourceKey: string): ResourceLeaseStatus {
    const capacity = this.getCapacity(resourceKey);
    const leases = this.getLeases(resourceKey);
    const waiters = this.getWaiters(resourceKey);
    return { resourceKey, capacity, leases, waiters, available: leases.length < capacity && waiters.length === 0 };
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
        ? leases.find((entry) => entry.ownerSessionId === caller)
        : leases.find((entry) => entry.slot === slot);
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

  private setWaiters(resourceKey: string, waiters: ResourceLeaseWaiter[]): void {
    if (waiters.length === 0) delete this.data.waiters[resourceKey];
    else this.data.waiters[resourceKey] = waiters;
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
  if (!/^[a-z0-9][a-z0-9._:-]*$/.test(key)) {
    throw new ResourceLeaseError(
      "invalid",
      "resource key must use letters, numbers, dot, underscore, colon, or hyphen",
    );
  }
  return key;
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
