import {
  SYNCED_PROJECTION_SCHEMA_VERSION,
  isValidSyncedProjectionIdentity,
  syncedProjectionEntryId,
  type SyncedProjectionEnvelope,
  type SyncedProjectionSubscription,
  type SyncedProjectionSubscriptionIdentity,
} from "../shared/synced-projection.js";

export interface SyncedProjectionDefinition<TSource, TDependencies, TValue, TSubscriber> {
  projection: string;
  dependencies: readonly string[];
  resolveSource: (key: string) => TSource | undefined;
  selectDependencies: (source: TSource, key: string) => TDependencies;
  dependenciesEqual: (left: TDependencies, right: TDependencies) => boolean;
  derive: (source: TSource, key: string, dependencies: TDependencies) => TValue;
  valueEqual: (left: TValue, right: TValue) => boolean;
  authorizeSubscription: (subscriber: TSubscriber, key: string, source: TSource) => boolean;
  maxValueBytes?: number;
}

export interface SyncedProjectionRuntimeProjectionMetrics {
  invalidations: number;
  batches: number;
  dependencySelections: number;
  dependencyEqualSuppressions: number;
  derivations: number;
  equalValueSuppressions: number;
  updates: number;
  snapshots: number;
  subscriptionsAccepted: number;
  subscriptionsRejected: number;
  oversizeValuesRejected: number;
  derivationErrors: number;
  deliveryErrors: number;
  /** Cumulative bytes of distinct values accepted into the cache. */
  valueBytes: number;
  /** Current serialized value bytes retained for this projection. */
  cachedValueBytes: number;
  /** Cumulative serialized value bytes returned through snapshot reads. */
  snapshotValueBytes: number;
  /** Cumulative serialized value bytes for logical update publications. */
  updateValueBytes: number;
  /** Successful individual subscriber deliveries. */
  deliveries: number;
  /** Cumulative serialized value bytes across successful deliveries. */
  deliveredValueBytes: number;
}

export interface SyncedProjectionRuntimeMetrics extends SyncedProjectionRuntimeProjectionMetrics {
  projections: Record<string, SyncedProjectionRuntimeProjectionMetrics>;
}

export interface SyncedProjectionRuntimeOptions {
  generation: string;
  maxValueBytes?: number;
  maxSubscriptionsPerSubscriber?: number;
  onError?: (error: unknown, context: { projection: string; key: string; phase: "derive" | "deliver" }) => void;
}

export interface SyncedProjectionSubscriptionReplacement {
  snapshots: SyncedProjectionEnvelope[];
  acceptedSubscriptions: SyncedProjectionSubscriptionIdentity[];
}

type AnyDefinition<TSubscriber> = SyncedProjectionDefinition<unknown, unknown, unknown, TSubscriber>;

type CacheEntry = {
  dependencies: unknown;
  value: unknown;
  revision: number;
  valueBytes: number;
};

type SubscriberState<TSubscriber> = {
  ids: Set<string>;
  deliver: (subscriber: TSubscriber, envelope: SyncedProjectionEnvelope) => void;
};

const DEFAULT_MAX_VALUE_BYTES = 32 * 1024;
const DEFAULT_MAX_SUBSCRIPTIONS = 2_000;

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

function createProjectionMetrics(): SyncedProjectionRuntimeProjectionMetrics {
  return {
    invalidations: 0,
    batches: 0,
    dependencySelections: 0,
    dependencyEqualSuppressions: 0,
    derivations: 0,
    equalValueSuppressions: 0,
    updates: 0,
    snapshots: 0,
    subscriptionsAccepted: 0,
    subscriptionsRejected: 0,
    oversizeValuesRejected: 0,
    derivationErrors: 0,
    deliveryErrors: 0,
    valueBytes: 0,
    cachedValueBytes: 0,
    snapshotValueBytes: 0,
    updateValueBytes: 0,
    deliveries: 0,
    deliveredValueBytes: 0,
  };
}

function createMetrics(): SyncedProjectionRuntimeMetrics {
  return { ...createProjectionMetrics(), projections: {} };
}

/**
 * Dependency-free runtime for small server-authored UI projections.
 *
 * Definitions own source lookup and semantic equality. The runtime owns
 * invalidation batching, bounded cached values, per-key revisions, and scoped
 * subscriber delivery. Projection updates are direct notifications rather than
 * replay-buffer events; reconnect convergence always comes from snapshots.
 */
export class SyncedProjectionRuntime<TSubscriber> {
  readonly generation: string;
  private readonly maxValueBytes: number;
  private readonly maxSubscriptionsPerSubscriber: number;
  private readonly onError?: SyncedProjectionRuntimeOptions["onError"];
  private readonly definitions = new Map<string, AnyDefinition<TSubscriber>>();
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Set<string>();
  private readonly subscribers = new Map<TSubscriber, SubscriberState<TSubscriber>>();
  private readonly metrics = createMetrics();
  private transactionDepth = 0;
  private flushScheduled = false;
  private flushing = false;

  constructor(options: SyncedProjectionRuntimeOptions) {
    if (!isValidSyncedProjectionIdentity(options.generation)) {
      throw new Error("Synced projection generation must be a non-empty bounded identity");
    }
    this.generation = options.generation;
    this.maxValueBytes = options.maxValueBytes ?? DEFAULT_MAX_VALUE_BYTES;
    this.maxSubscriptionsPerSubscriber = options.maxSubscriptionsPerSubscriber ?? DEFAULT_MAX_SUBSCRIPTIONS;
    this.onError = options.onError;
  }

  register<TSource, TDependencies, TValue>(
    definition: SyncedProjectionDefinition<TSource, TDependencies, TValue, TSubscriber>,
  ): void {
    if (!isValidSyncedProjectionIdentity(definition.projection)) {
      throw new Error(`Invalid synced projection identity: ${definition.projection}`);
    }
    if (this.definitions.has(definition.projection)) {
      throw new Error(`Synced projection already registered: ${definition.projection}`);
    }
    if (
      definition.dependencies.length === 0 ||
      definition.dependencies.some((name) => !isValidSyncedProjectionIdentity(name))
    ) {
      throw new Error(`Synced projection ${definition.projection} must declare bounded dependency identities`);
    }
    this.definitions.set(definition.projection, definition as AnyDefinition<TSubscriber>);
    this.metrics.projections[definition.projection] = createProjectionMetrics();
  }

  invalidate(projection: string, key: string): boolean {
    if (!this.definitions.has(projection) || !isValidSyncedProjectionIdentity(key)) return false;
    this.pending.add(syncedProjectionEntryId(projection, key));
    this.metrics.invalidations += 1;
    this.projectionMetrics(projection).invalidations += 1;
    this.scheduleFlush();
    return true;
  }

  transaction<TResult>(operation: () => TResult): TResult {
    this.transactionDepth += 1;
    try {
      return operation();
    } finally {
      this.transactionDepth -= 1;
      this.scheduleFlush();
    }
  }

  getSnapshot<TValue = unknown>(projection: string, key: string): SyncedProjectionEnvelope<TValue> | null {
    if (!isValidSyncedProjectionIdentity(projection) || !isValidSyncedProjectionIdentity(key)) return null;
    const entryId = syncedProjectionEntryId(projection, key);
    const publish = this.pending.delete(entryId);
    const entry = this.recompute(entryId, publish);
    if (!entry) return null;
    this.metrics.snapshots += 1;
    this.metrics.snapshotValueBytes += entry.valueBytes;
    const projectionMetrics = this.projectionMetrics(projection);
    projectionMetrics.snapshots += 1;
    projectionMetrics.snapshotValueBytes += entry.valueBytes;
    return this.envelope<TValue>(projection, key, entry);
  }

  replaceSubscriptions(
    subscriber: TSubscriber,
    subscriptions: readonly SyncedProjectionSubscription[] | unknown,
    deliver: SubscriberState<TSubscriber>["deliver"],
  ): SyncedProjectionSubscriptionReplacement {
    const requested = Array.isArray(subscriptions) ? subscriptions : [];
    if (!Array.isArray(subscriptions)) this.metrics.subscriptionsRejected += 1;
    const accepted: Array<{ projection: string; key: string; id: string }> = [];
    const seen = new Set<string>();
    for (const request of requested.slice(0, this.maxSubscriptionsPerSubscriber)) {
      if (!request || typeof request !== "object") {
        this.metrics.subscriptionsRejected += 1;
        continue;
      }
      const definition = this.definitions.get(request.projection);
      if (!definition || !isValidSyncedProjectionIdentity(request.key)) {
        this.metrics.subscriptionsRejected += 1;
        if (definition) this.projectionMetrics(request.projection).subscriptionsRejected += 1;
        continue;
      }
      const id = syncedProjectionEntryId(request.projection, request.key);
      if (seen.has(id)) continue;
      const source = definition.resolveSource(request.key);
      if (source === undefined || !definition.authorizeSubscription(subscriber, request.key, source)) {
        this.metrics.subscriptionsRejected += 1;
        this.projectionMetrics(request.projection).subscriptionsRejected += 1;
        continue;
      }
      seen.add(id);
      accepted.push({ projection: request.projection, key: request.key, id });
    }
    if (requested.length > this.maxSubscriptionsPerSubscriber) {
      this.metrics.subscriptionsRejected += requested.length - this.maxSubscriptionsPerSubscriber;
    }

    // Snapshot before installing the new subscriber set: recomputation may
    // publish to established subscribers, while this subscriber gets exactly
    // one authoritative snapshot per accepted key below.
    const resolved = accepted.flatMap(({ projection, key, id }) => {
      const snapshot = this.getSnapshot(projection, key);
      if (!snapshot) {
        this.metrics.subscriptionsRejected += 1;
        this.projectionMetrics(projection).subscriptionsRejected += 1;
        return [];
      }
      this.metrics.subscriptionsAccepted += 1;
      this.projectionMetrics(projection).subscriptionsAccepted += 1;
      return [{ projection, key, id, snapshot }];
    });
    this.subscribers.set(subscriber, {
      ids: new Set(resolved.map(({ id }) => id)),
      deliver,
    });
    return {
      snapshots: resolved.map(({ snapshot }) => snapshot),
      acceptedSubscriptions: resolved.map(({ projection, key }) => ({ projection, key })),
    };
  }

  resync(subscriber: TSubscriber, projection: string, key: string): SyncedProjectionEnvelope | null {
    if (!isValidSyncedProjectionIdentity(projection) || !isValidSyncedProjectionIdentity(key)) {
      this.metrics.subscriptionsRejected += 1;
      return null;
    }
    const state = this.subscribers.get(subscriber);
    const id = syncedProjectionEntryId(projection, key);
    if (!state?.ids.has(id)) {
      this.metrics.subscriptionsRejected += 1;
      return null;
    }
    const definition = this.definitions.get(projection);
    const source = definition?.resolveSource(key);
    if (!definition || source === undefined || !definition.authorizeSubscription(subscriber, key, source)) {
      this.metrics.subscriptionsRejected += 1;
      state.ids.delete(id);
      return null;
    }
    return this.getSnapshot(projection, key);
  }

  removeSubscriber(subscriber: TSubscriber): void {
    this.subscribers.delete(subscriber);
  }

  hasSubscription(subscriber: TSubscriber, projection: string, key: string): boolean {
    if (!isValidSyncedProjectionIdentity(projection) || !isValidSyncedProjectionIdentity(key)) return false;
    return this.subscribers.get(subscriber)?.ids.has(syncedProjectionEntryId(projection, key)) ?? false;
  }

  removeKey(projection: string, key: string): boolean {
    if (!isValidSyncedProjectionIdentity(projection) || !isValidSyncedProjectionIdentity(key)) return false;
    const entryId = syncedProjectionEntryId(projection, key);
    const removedPending = this.pending.delete(entryId);
    const prior = this.cache.get(entryId);
    const removedCache = this.cache.delete(entryId);
    if (prior) {
      this.metrics.cachedValueBytes -= prior.valueBytes;
      this.projectionMetrics(projection).cachedValueBytes -= prior.valueBytes;
    }
    for (const state of this.subscribers.values()) state.ids.delete(entryId);
    return removedPending || removedCache;
  }

  flush(): void {
    this.flushScheduled = false;
    if (this.flushing || this.transactionDepth > 0 || this.pending.size === 0) return;
    this.flushing = true;
    const batch = [...this.pending];
    this.pending.clear();
    this.metrics.batches += 1;
    const batchProjections = new Set(batch.map((entryId) => entryId.slice(0, entryId.indexOf("\u0000"))));
    for (const projection of batchProjections) this.projectionMetrics(projection).batches += 1;
    try {
      for (const entryId of batch) this.recompute(entryId, true);
    } finally {
      this.flushing = false;
      this.scheduleFlush();
    }
  }

  async flushForTest(): Promise<void> {
    for (let pass = 0; pass < 100; pass += 1) {
      await Promise.resolve();
      this.flush();
      if (!this.flushScheduled && !this.flushing && this.pending.size === 0) return;
    }
    throw new Error("Synced projection runtime did not settle after 100 flush passes");
  }

  getMetrics(): Readonly<SyncedProjectionRuntimeMetrics> {
    return {
      ...this.metrics,
      projections: Object.fromEntries(
        Object.entries(this.metrics.projections).map(([projection, metrics]) => [projection, { ...metrics }]),
      ),
    };
  }

  private projectionMetrics(projection: string): SyncedProjectionRuntimeProjectionMetrics {
    return (this.metrics.projections[projection] ??= createProjectionMetrics());
  }

  private scheduleFlush(): void {
    if (this.transactionDepth > 0 || this.flushing || this.pending.size === 0 || this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => this.flush());
  }

  private recompute(entryId: string, publish: boolean): CacheEntry | null {
    const separator = entryId.indexOf("\u0000");
    const projection = entryId.slice(0, separator);
    const key = entryId.slice(separator + 1);
    const definition = this.definitions.get(projection);
    if (!definition) return null;
    const source = definition.resolveSource(key);
    if (source === undefined) {
      const prior = this.cache.get(entryId);
      this.cache.delete(entryId);
      if (prior) {
        this.metrics.cachedValueBytes -= prior.valueBytes;
        this.projectionMetrics(projection).cachedValueBytes -= prior.valueBytes;
      }
      return null;
    }

    try {
      const dependencies = definition.selectDependencies(source, key);
      this.metrics.dependencySelections += 1;
      const projectionMetrics = this.projectionMetrics(projection);
      projectionMetrics.dependencySelections += 1;
      const prior = this.cache.get(entryId);
      if (prior && definition.dependenciesEqual(prior.dependencies, dependencies)) {
        this.metrics.dependencyEqualSuppressions += 1;
        projectionMetrics.dependencyEqualSuppressions += 1;
        return prior;
      }

      const value = definition.derive(source, key, dependencies);
      this.metrics.derivations += 1;
      projectionMetrics.derivations += 1;
      if (prior && definition.valueEqual(prior.value, value)) {
        prior.dependencies = dependencies;
        this.metrics.equalValueSuppressions += 1;
        projectionMetrics.equalValueSuppressions += 1;
        return prior;
      }

      const serialized = JSON.stringify(value);
      if (serialized === undefined) throw new Error("Synced projection value is not JSON serializable");
      const valueBytes = utf8ByteLength(serialized);
      const maxValueBytes = Math.min(definition.maxValueBytes ?? this.maxValueBytes, this.maxValueBytes);
      if (valueBytes > maxValueBytes) {
        this.metrics.oversizeValuesRejected += 1;
        projectionMetrics.oversizeValuesRejected += 1;
        throw new Error(
          `Synced projection ${projection}/${key} value is ${valueBytes} bytes; maximum is ${maxValueBytes}`,
        );
      }

      const entry: CacheEntry = {
        dependencies,
        value,
        revision: prior ? prior.revision + 1 : 1,
        valueBytes,
      };
      this.cache.set(entryId, entry);
      this.metrics.valueBytes += valueBytes;
      this.metrics.cachedValueBytes += valueBytes - (prior?.valueBytes ?? 0);
      projectionMetrics.valueBytes += valueBytes;
      projectionMetrics.cachedValueBytes += valueBytes - (prior?.valueBytes ?? 0);
      if (publish) this.publish(projection, key, entryId, entry);
      return entry;
    } catch (error) {
      this.metrics.derivationErrors += 1;
      this.projectionMetrics(projection).derivationErrors += 1;
      this.onError?.(error, { projection, key, phase: "derive" });
      return this.cache.get(entryId) ?? null;
    }
  }

  private publish(projection: string, key: string, entryId: string, entry: CacheEntry): void {
    const envelope = this.envelope(projection, key, entry);
    const definition = this.definitions.get(projection);
    const source = definition?.resolveSource(key);
    let delivered = 0;
    for (const [subscriber, state] of this.subscribers) {
      if (!state.ids.has(entryId)) continue;
      if (!definition || source === undefined || !definition.authorizeSubscription(subscriber, key, source)) {
        state.ids.delete(entryId);
        continue;
      }
      try {
        state.deliver(subscriber, envelope);
        delivered += 1;
        this.metrics.deliveries += 1;
        this.metrics.deliveredValueBytes += entry.valueBytes;
        const projectionMetrics = this.projectionMetrics(projection);
        projectionMetrics.deliveries += 1;
        projectionMetrics.deliveredValueBytes += entry.valueBytes;
      } catch (error) {
        this.metrics.deliveryErrors += 1;
        this.projectionMetrics(projection).deliveryErrors += 1;
        this.onError?.(error, { projection, key, phase: "deliver" });
        this.subscribers.delete(subscriber);
      }
    }
    if (delivered > 0) {
      this.metrics.updates += 1;
      this.metrics.updateValueBytes += entry.valueBytes;
      const projectionMetrics = this.projectionMetrics(projection);
      projectionMetrics.updates += 1;
      projectionMetrics.updateValueBytes += entry.valueBytes;
    }
  }

  private envelope<TValue = unknown>(
    projection: string,
    key: string,
    entry: CacheEntry,
  ): SyncedProjectionEnvelope<TValue> {
    return {
      schemaVersion: SYNCED_PROJECTION_SCHEMA_VERSION,
      projection,
      key,
      generation: this.generation,
      revision: entry.revision,
      value: entry.value as TValue,
    };
  }
}
