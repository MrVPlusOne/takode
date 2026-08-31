import {
  isValidSyncedProjectionIdentity,
  syncedProjectionEntryId,
  type SyncedProjectionEnvelope,
  type SyncedProjectionPatchEnvelope,
  type SyncedProjectionSubscription,
  type SyncedProjectionSubscriptionIdentity,
} from "../shared/synced-projection.js";
import { jsonUtf8ByteLength } from "../shared/synced-projection-codec.js";

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
  createPatch?: (previous: TValue, next: TValue) => unknown;
}

export interface DirectSyncedProjectionDefinitionOptions<TSource, TValue, TSubscriber> {
  descriptor: {
    projection: string;
    equal: (left: TValue, right: TValue) => boolean;
    maxValueBytes: number;
  };
  dependencies: readonly string[];
  resolveSource: (key: string) => TSource | undefined;
  selectValue: (source: TSource, key: string) => TValue;
  authorizeSubscription: (subscriber: TSubscriber, key: string, source: TSource) => boolean;
  createPatch?: (previous: TValue, next: TValue) => unknown;
}

/** Define a projection whose selected dependency value is already its final wire value. */
export function createDirectSyncedProjectionDefinition<TSource, TValue, TSubscriber>(
  options: DirectSyncedProjectionDefinitionOptions<TSource, TValue, TSubscriber>,
): SyncedProjectionDefinition<TSource, TValue, TValue, TSubscriber> {
  return {
    projection: options.descriptor.projection,
    dependencies: options.dependencies,
    resolveSource: options.resolveSource,
    selectDependencies: options.selectValue,
    dependenciesEqual: options.descriptor.equal,
    derive: (_source, _key, value) => value,
    valueEqual: options.descriptor.equal,
    authorizeSubscription: options.authorizeSubscription,
    maxValueBytes: options.descriptor.maxValueBytes,
    createPatch: options.createPatch,
  };
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

type SyncedProjectionUpdateEnvelope = SyncedProjectionEnvelope | SyncedProjectionPatchEnvelope;

type SubscriberState<TSubscriber> = {
  ids: Set<string>;
  deliver: (subscriber: TSubscriber, envelope: SyncedProjectionUpdateEnvelope) => void;
};

const DEFAULT_MAX_VALUE_BYTES = 32 * 1024;
const DEFAULT_MAX_SUBSCRIPTIONS = 2_000;

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
  /** Keys whose source changed and must be recomputed before the next snapshot or publication. */
  private readonly dirty = new Set<string>();
  /** Dirty keys queued for publication because at least one subscriber currently exists. */
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
    const entryId = syncedProjectionEntryId(projection, key);
    this.dirty.add(entryId);
    if (this.hasSubscribersForEntryId(entryId)) this.pending.add(entryId);
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
    const shouldRecompute = this.dirty.has(entryId) || !this.cache.has(entryId);
    const publish = shouldRecompute && (this.pending.delete(entryId) || this.hasSubscribersForEntryId(entryId));
    const entry = shouldRecompute ? this.recompute(entryId, publish) : this.cache.get(entryId);
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

    // Detach this subscriber before resolving snapshots so a dirty
    // recomputation can still publish to other established subscribers while
    // the replacing subscriber receives each accepted revision exactly once
    // through the returned snapshot set below.
    this.subscribers.delete(subscriber);
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

  hasSubscribers(projection: string, key: string): boolean {
    if (!isValidSyncedProjectionIdentity(projection) || !isValidSyncedProjectionIdentity(key)) return false;
    return this.hasSubscribersForEntryId(syncedProjectionEntryId(projection, key));
  }

  removeKey(projection: string, key: string): boolean {
    if (!isValidSyncedProjectionIdentity(projection) || !isValidSyncedProjectionIdentity(key)) return false;
    const entryId = syncedProjectionEntryId(projection, key);
    const removedDirty = this.dirty.delete(entryId);
    const removedPending = this.pending.delete(entryId);
    const prior = this.cache.get(entryId);
    const removedCache = this.cache.delete(entryId);
    if (prior) {
      this.metrics.cachedValueBytes -= prior.valueBytes;
      this.projectionMetrics(projection).cachedValueBytes -= prior.valueBytes;
    }
    for (const state of this.subscribers.values()) state.ids.delete(entryId);
    return removedDirty || removedPending || removedCache;
  }

  flush(): void {
    this.flushScheduled = false;
    if (this.flushing || this.transactionDepth > 0 || this.pending.size === 0) return;
    const batch = [...this.pending].filter((entryId) => this.hasSubscribersForEntryId(entryId));
    this.pending.clear();
    if (batch.length === 0) return;
    this.flushing = true;
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

  private hasSubscribersForEntryId(entryId: string): boolean {
    for (const state of this.subscribers.values()) {
      if (state.ids.has(entryId)) return true;
    }
    return false;
  }

  private recompute(entryId: string, publish: boolean): CacheEntry | null {
    const separator = entryId.indexOf("\u0000");
    const projection = entryId.slice(0, separator);
    const key = entryId.slice(separator + 1);
    const definition = this.definitions.get(projection);
    if (!definition) return null;
    const wasDirty = this.dirty.delete(entryId);
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

      const valueBytes = jsonUtf8ByteLength(value);
      if (valueBytes === null) throw new Error("Synced projection value is not JSON serializable");
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
      if (publish) this.publish(projection, key, entryId, entry, prior);
      return entry;
    } catch (error) {
      if (wasDirty) this.dirty.add(entryId);
      this.metrics.derivationErrors += 1;
      this.projectionMetrics(projection).derivationErrors += 1;
      this.onError?.(error, { projection, key, phase: "derive" });
      return this.cache.get(entryId) ?? null;
    }
  }

  private publish(
    projection: string,
    key: string,
    entryId: string,
    entry: CacheEntry,
    prior: CacheEntry | undefined,
  ): void {
    const definition = this.definitions.get(projection);
    const patch = prior && definition?.createPatch ? definition.createPatch(prior.value, entry.value) : undefined;
    const envelope: SyncedProjectionUpdateEnvelope =
      patch === undefined
        ? this.envelope(projection, key, entry)
        : { projection, key, generation: this.generation, revision: entry.revision, patch };
    const updateBytes = jsonUtf8ByteLength("patch" in envelope ? envelope.patch : envelope.value);
    if (updateBytes === null) {
      this.metrics.deliveryErrors += 1;
      this.projectionMetrics(projection).deliveryErrors += 1;
      this.onError?.(new Error("Synced projection update is not JSON serializable"), {
        projection,
        key,
        phase: "deliver",
      });
      return;
    }
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
        this.metrics.deliveredValueBytes += updateBytes;
        const projectionMetrics = this.projectionMetrics(projection);
        projectionMetrics.deliveries += 1;
        projectionMetrics.deliveredValueBytes += updateBytes;
      } catch (error) {
        this.metrics.deliveryErrors += 1;
        this.projectionMetrics(projection).deliveryErrors += 1;
        this.onError?.(error, { projection, key, phase: "deliver" });
        this.subscribers.delete(subscriber);
      }
    }
    if (delivered > 0) {
      this.metrics.updates += 1;
      this.metrics.updateValueBytes += updateBytes;
      const projectionMetrics = this.projectionMetrics(projection);
      projectionMetrics.updates += 1;
      projectionMetrics.updateValueBytes += updateBytes;
    }
  }

  private envelope<TValue = unknown>(
    projection: string,
    key: string,
    entry: CacheEntry,
  ): SyncedProjectionEnvelope<TValue> {
    return {
      projection,
      key,
      generation: this.generation,
      revision: entry.revision,
      value: entry.value as TValue,
    };
  }
}
