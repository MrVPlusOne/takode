import { describe, expect, it, vi } from "vitest";
import type { SyncedProjectionDefinition } from "./synced-projection-runtime.js";
import { createDirectSyncedProjectionDefinition, SyncedProjectionRuntime } from "./synced-projection-runtime.js";

type Source = { dependency: number; unrelated: number; text?: string };
type Subscriber = { allowedKeys: Set<string>; updates: unknown[] };

function definition(
  sources: Map<string, Source>,
  overrides: Partial<SyncedProjectionDefinition<Source, number, { parity: number }, Subscriber>> = {},
): SyncedProjectionDefinition<Source, number, { parity: number }, Subscriber> {
  return {
    projection: "example",
    dependencies: ["dependency"],
    resolveSource: (key) => sources.get(key),
    selectDependencies: (source) => source.dependency,
    dependenciesEqual: Object.is,
    derive: (_source, _key, dependency) => ({ parity: dependency % 2 }),
    valueEqual: (left, right) => left.parity === right.parity,
    authorizeSubscription: (subscriber, key) => subscriber.allowedKeys.has(key),
    ...overrides,
  };
}

function subscribe(runtime: SyncedProjectionRuntime<Subscriber>, subscriber: Subscriber, keys: string[]) {
  return runtime.replaceSubscriptions(
    subscriber,
    keys.map((key) => ({ projection: "example", key })),
    (target, envelope) => target.updates.push(envelope),
  ).snapshots;
}

describe("SyncedProjectionRuntime", () => {
  it("defines direct-value projections without duplicated equality or identity plumbing", () => {
    const equal = vi.fn((left: { parity: number }, right: { parity: number }) => left.parity === right.parity);
    const selectValue = vi.fn((source: Source) => ({ parity: source.dependency % 2 }));
    const direct = createDirectSyncedProjectionDefinition<Source, { parity: number }, Subscriber>({
      descriptor: { projection: "direct", equal, maxValueBytes: 128 },
      dependencies: ["dependency"],
      resolveSource: () => ({ dependency: 1, unrelated: 0 }),
      selectValue,
      authorizeSubscription: () => true,
    });
    const source = { dependency: 2, unrelated: 0 };
    const value = direct.selectDependencies(source, "a");

    expect(value).toEqual({ parity: 0 });
    expect(direct.derive(source, "a", value)).toBe(value);
    expect(direct.dependenciesEqual(value, { parity: 0 })).toBe(true);
    expect(direct.valueEqual(value, { parity: 1 })).toBe(false);
    expect(direct.maxValueBytes).toBe(128);
    expect(selectValue).toHaveBeenCalledOnce();
    expect(equal).toHaveBeenCalledTimes(2);
  });

  it("batches invalidations, filters equal dependencies, and advances revisions only for semantic changes", async () => {
    const sources = new Map<string, Source>([["a", { dependency: 1, unrelated: 0 }]]);
    const runtime = new SyncedProjectionRuntime<Subscriber>({ generation: "generation-a" });
    const selectDependencies = vi.fn((source: Source) => source.dependency);
    const derive = vi.fn((_source: Source, _key: string, dependency: number) => ({ parity: dependency % 2 }));
    runtime.register(definition(sources, { selectDependencies, derive }));
    const subscriber = { allowedKeys: new Set(["a"]), updates: [] as unknown[] };

    const [initial] = subscribe(runtime, subscriber, ["a"]);
    expect(initial).toMatchObject({ generation: "generation-a", revision: 1, value: { parity: 1 } });

    sources.get("a")!.unrelated += 1;
    runtime.invalidate("example", "a");
    await runtime.flushForTest();
    expect(selectDependencies).toHaveBeenCalledTimes(2);
    expect(derive).toHaveBeenCalledTimes(1);
    expect(subscriber.updates).toEqual([]);

    runtime.transaction(() => {
      sources.get("a")!.dependency = 2;
      runtime.invalidate("example", "a");
      runtime.invalidate("example", "a");
    });
    await runtime.flushForTest();
    expect(subscriber.updates).toEqual([
      expect.objectContaining({ generation: "generation-a", revision: 2, value: { parity: 0 } }),
    ]);

    sources.get("a")!.dependency = 4;
    runtime.invalidate("example", "a");
    await runtime.flushForTest();
    expect(subscriber.updates).toHaveLength(1);
    expect(runtime.getSnapshot("example", "a")).toMatchObject({ revision: 2, value: { parity: 0 } });
    const metrics = runtime.getMetrics();
    expect(metrics).toMatchObject({
      batches: 3,
      dependencyEqualSuppressions: 1,
      equalValueSuppressions: 1,
      updates: 1,
      deliveries: 1,
    });
    expect(metrics.valueBytes).toBeGreaterThan(0);
    expect(metrics.snapshotValueBytes).toBeGreaterThan(0);
    expect(metrics.updateValueBytes).toBeGreaterThan(0);
    expect(metrics.deliveredValueBytes).toBeGreaterThan(0);
    expect(metrics.projections.example).toMatchObject({
      invalidations: 4,
      batches: 3,
      updates: 1,
      deliveries: 1,
    });
    expect(metrics.projections.example?.cachedValueBytes).toBeGreaterThan(0);
  });

  it("publishes one field patch for a coalesced invalidation burst", async () => {
    const sources = new Map<string, Source>([["a", { dependency: 1, unrelated: 0 }]]);
    const runtime = new SyncedProjectionRuntime<Subscriber>({ generation: "generation-a" });
    runtime.register(
      definition(sources, {
        createPatch: (_previous, next) => ({ parity: next.parity }),
      }),
    );
    const subscriber = { allowedKeys: new Set(["a"]), updates: [] as unknown[] };

    expect(subscribe(runtime, subscriber, ["a"])[0]).toMatchObject({
      revision: 1,
      value: { parity: 1 },
    });
    sources.get("a")!.dependency = 2;
    runtime.invalidate("example", "a");
    sources.get("a")!.dependency = 4;
    runtime.invalidate("example", "a");
    await runtime.flushForTest();

    expect(subscriber.updates).toEqual([
      {
        projection: "example",
        key: "a",
        generation: "generation-a",
        revision: 2,
        patch: { parity: 0 },
      },
    ]);
    expect(runtime.getSnapshot("example", "a")).toMatchObject({ revision: 2, value: { parity: 0 } });
    expect(runtime.getMetrics()).toMatchObject({
      invalidations: 2,
      batches: 1,
      updates: 1,
      deliveries: 1,
    });
  });

  it("keeps no-subscriber invalidations dirty until a snapshot requests the value", async () => {
    const sources = new Map<string, Source>([["a", { dependency: 1, unrelated: 0 }]]);
    const runtime = new SyncedProjectionRuntime<Subscriber>({ generation: "generation-a" });
    const selectDependencies = vi.fn((source: Source) => source.dependency);
    const derive = vi.fn((_source: Source, _key: string, dependency: number) => ({ parity: dependency % 2 }));
    runtime.register(definition(sources, { selectDependencies, derive }));

    runtime.invalidate("example", "a");
    await runtime.flushForTest();

    expect(selectDependencies).not.toHaveBeenCalled();
    expect(derive).not.toHaveBeenCalled();
    expect(runtime.getMetrics()).toMatchObject({
      invalidations: 1,
      batches: 0,
      dependencySelections: 0,
      derivations: 0,
      valueBytes: 0,
      cachedValueBytes: 0,
    });

    expect(runtime.getSnapshot("example", "a")).toMatchObject({ revision: 1, value: { parity: 1 } });
    expect(selectDependencies).toHaveBeenCalledTimes(1);
    expect(derive).toHaveBeenCalledTimes(1);

    sources.get("a")!.dependency = 2;
    runtime.invalidate("example", "a");
    await runtime.flushForTest();
    expect(selectDependencies).toHaveBeenCalledTimes(1);
    expect(derive).toHaveBeenCalledTimes(1);

    expect(runtime.getSnapshot("example", "a")).toMatchObject({ revision: 2, value: { parity: 0 } });
    expect(selectDependencies).toHaveBeenCalledTimes(2);
    expect(derive).toHaveBeenCalledTimes(2);
  });

  it("reuses a clean cached value for later subscribers and reconnect snapshots", () => {
    const sources = new Map<string, Source>([["a", { dependency: 1, unrelated: 0 }]]);
    const runtime = new SyncedProjectionRuntime<Subscriber>({ generation: "generation-a" });
    const selectDependencies = vi.fn((source: Source) => source.dependency);
    const derive = vi.fn((_source: Source, _key: string, dependency: number) => ({ parity: dependency % 2 }));
    const authorizeSubscription = vi.fn((subscriber: Subscriber, key: string) => subscriber.allowedKeys.has(key));
    runtime.register(definition(sources, { selectDependencies, derive, authorizeSubscription }));
    const first = { allowedKeys: new Set(["a"]), updates: [] as unknown[] };
    const second = { allowedKeys: new Set(["a"]), updates: [] as unknown[] };
    const reconnect = { allowedKeys: new Set(["a"]), updates: [] as unknown[] };

    expect(subscribe(runtime, first, ["a"])[0]).toMatchObject({ revision: 1, value: { parity: 1 } });
    expect(subscribe(runtime, second, ["a"])[0]).toMatchObject({ revision: 1, value: { parity: 1 } });
    runtime.removeSubscriber(first);
    runtime.removeSubscriber(second);
    expect(subscribe(runtime, reconnect, ["a"])[0]).toMatchObject({ revision: 1, value: { parity: 1 } });

    expect(authorizeSubscription).toHaveBeenCalledTimes(3);
    expect(selectDependencies).toHaveBeenCalledTimes(1);
    expect(derive).toHaveBeenCalledTimes(1);
    expect(runtime.getMetrics()).toMatchObject({
      dependencySelections: 1,
      derivations: 1,
      snapshots: 3,
      subscriptionsAccepted: 3,
    });
  });

  it("authorizes and scopes subscriptions by projection key", async () => {
    const sources = new Map<string, Source>([
      ["a", { dependency: 1, unrelated: 0 }],
      ["b", { dependency: 1, unrelated: 0 }],
    ]);
    const runtime = new SyncedProjectionRuntime<Subscriber>({ generation: "generation-a" });
    runtime.register(definition(sources));
    const onlyA = { allowedKeys: new Set(["a"]), updates: [] as unknown[] };
    const onlyB = { allowedKeys: new Set(["b"]), updates: [] as unknown[] };

    expect(runtime.hasSubscribers("example", "a")).toBe(false);
    expect(subscribe(runtime, onlyA, ["a", "b"])).toHaveLength(1);
    expect(runtime.hasSubscription(onlyA, "example", "a")).toBe(true);
    expect(runtime.hasSubscription(onlyA, "example", "b")).toBe(false);
    expect(subscribe(runtime, onlyB, ["b"])).toHaveLength(1);
    expect(runtime.hasSubscribers("example", "a")).toBe(true);
    expect(runtime.hasSubscribers("example", "b")).toBe(true);
    sources.get("a")!.dependency = 2;
    runtime.invalidate("example", "a");
    await runtime.flushForTest();

    expect(onlyA.updates).toHaveLength(1);
    expect(onlyB.updates).toHaveLength(0);
    expect(runtime.resync(onlyB, "example", "a")).toBeNull();
    expect(runtime.getMetrics().subscriptionsRejected).toBe(2);
    runtime.removeSubscriber(onlyA);
    expect(runtime.hasSubscribers("example", "a")).toBe(false);
    expect(runtime.hasSubscribers("example", "b")).toBe(true);
  });

  it("rejects oversized values without caching or publishing them", async () => {
    const sources = new Map<string, Source>([["a", { dependency: 1, unrelated: 0, text: "too large" }]]);
    const onError = vi.fn();
    const runtime = new SyncedProjectionRuntime<Subscriber>({
      generation: "generation-a",
      maxValueBytes: 8,
      onError,
    });
    runtime.register(
      definition(sources, {
        derive: (source) => ({ parity: source.text?.length ?? 0 }),
      }),
    );

    expect(runtime.getSnapshot("example", "a")).toBeNull();
    expect(runtime.getMetrics()).toMatchObject({ oversizeValuesRejected: 1, derivationErrors: 1, updates: 0 });
    expect(onError).toHaveBeenCalledWith(expect.any(Error), {
      projection: "example",
      key: "a",
      phase: "derive",
    });
  });

  it("publishes a dirty recomputation to existing subscribers before returning a snapshot", () => {
    const sources = new Map<string, Source>([["a", { dependency: 1, unrelated: 0 }]]);
    const runtime = new SyncedProjectionRuntime<Subscriber>({ generation: "generation-a" });
    runtime.register(definition(sources));
    const subscriber = { allowedKeys: new Set(["a"]), updates: [] as unknown[] };
    subscribe(runtime, subscriber, ["a"]);

    sources.get("a")!.dependency = 2;
    runtime.invalidate("example", "a");
    const snapshot = runtime.getSnapshot("example", "a");

    expect(snapshot).toMatchObject({ revision: 2, value: { parity: 0 } });
    expect(subscriber.updates).toEqual([expect.objectContaining({ revision: 2, value: { parity: 0 } })]);
  });

  it("delivers a dirty same-subscriber replacement only through its authoritative snapshot", async () => {
    const sources = new Map<string, Source>([["a", { dependency: 1, unrelated: 0 }]]);
    const runtime = new SyncedProjectionRuntime<Subscriber>({ generation: "generation-a" });
    runtime.register(definition(sources));
    const replacing = { allowedKeys: new Set(["a"]), updates: [] as unknown[] };
    const established = { allowedKeys: new Set(["a"]), updates: [] as unknown[] };
    subscribe(runtime, replacing, ["a"]);
    subscribe(runtime, established, ["a"]);

    sources.get("a")!.dependency = 2;
    runtime.invalidate("example", "a");
    const replacement = runtime.replaceSubscriptions(
      replacing,
      [{ projection: "example", key: "a" }],
      (target, envelope) => target.updates.push(envelope),
    );
    await runtime.flushForTest();

    expect(replacement.snapshots).toEqual([expect.objectContaining({ revision: 2, value: { parity: 0 } })]);
    expect(replacing.updates).toEqual([]);
    expect(established.updates).toEqual([expect.objectContaining({ revision: 2, value: { parity: 0 } })]);
  });

  it("removes cached keys and detaches them from every subscriber", async () => {
    const sources = new Map<string, Source>([["a", { dependency: 1, unrelated: 0 }]]);
    const runtime = new SyncedProjectionRuntime<Subscriber>({ generation: "generation-a" });
    runtime.register(definition(sources));
    const subscriber = { allowedKeys: new Set(["a"]), updates: [] as unknown[] };
    subscribe(runtime, subscriber, ["a"]);

    expect(runtime.getMetrics().projections.example?.cachedValueBytes).toBeGreaterThan(0);
    expect(runtime.removeKey("example", "a")).toBe(true);
    expect(runtime.getMetrics().projections.example?.cachedValueBytes).toBe(0);
    expect(runtime.hasSubscription(subscriber, "example", "a")).toBe(false);
    sources.get("a")!.dependency = 2;
    runtime.invalidate("example", "a");
    await runtime.flushForTest();

    expect(subscriber.updates).toEqual([]);
    expect(runtime.getSnapshot("example", "a")).toMatchObject({ revision: 1, value: { parity: 0 } });
  });
});
