import { describe, expect, it, vi } from "vitest";
import type { SyncedProjectionDefinition } from "./synced-projection-runtime.js";
import { SyncedProjectionRuntime } from "./synced-projection-runtime.js";

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
      dependencyEqualSuppressions: 2,
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
