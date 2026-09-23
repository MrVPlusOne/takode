import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResourceLeaseManager } from "./resource-lease-manager.js";
import { ResourceLeaseStore } from "./resource-lease-store.js";

describe("counted resource leases", () => {
  let directory: string;
  let store: ResourceLeaseStore;
  let manager: ResourceLeaseManager;
  const bridge = {
    injectUserMessage: vi.fn(
      (_sessionId: string, _content: string, _source?: { sessionId: string; sessionLabel?: string }) => "sent" as const,
    ),
  };
  const acquire = (callerSessionId: string, ttlMs = 60_000, waitIfUnavailable = true) =>
    manager.acquire({ resourceKey: "test-server", callerSessionId, purpose: "Check pool", ttlMs, waitIfUnavailable });

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-09-23T12:00:00Z") });
    directory = mkdtempSync(join(tmpdir(), "counted-leases-"));
    store = new ResourceLeaseStore("test", directory);
    manager = new ResourceLeaseManager(bridge, store);
    bridge.injectUserMessage.mockClear();
  });

  afterEach(() => {
    manager.destroy();
    rmSync(directory, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it("serializes concurrent acquisition, deduplicates owners/waiters and reuses the lowest slot in FIFO order", async () => {
    // Concurrent requests must obey both capacity and one-slot-per-session.
    await manager.configure("test-server", 3);
    const first = await Promise.all(["a", "b", "c", "a", "d", "e", "d"].map((id) => acquire(id)));
    expect(first.map((result) => result.status)).toEqual([
      "acquired",
      "acquired",
      "acquired",
      "already_owned",
      "queued",
      "queued",
      "queued",
    ]);
    expect(first[0]).toMatchObject({ capacity: 3, lease: { slot: 1 } });
    expect(first[3]).toMatchObject({ lease: { slot: 1 } });
    expect(first[4]).toMatchObject({ position: 1, capacity: 3 });
    expect(first[6]).toMatchObject({ position: 1 });
    const released = await manager.release("test-server", "b");
    expect(released.promoted).toMatchObject({ slot: 2, ownerSessionId: "d" });
    expect((await acquire("newcomer", 60_000, false)).status).toBe("unavailable");
    const status = await manager.getStatus("test-server");
    expect(status.leases.map((lease) => [lease.slot, lease.ownerSessionId])).toEqual([
      [1, "a"],
      [2, "d"],
      [3, "c"],
    ]);
    expect(status.waiters.map((waiter) => waiter.waiterSessionId)).toEqual(["e"]);
    expect(bridge.injectUserMessage).toHaveBeenCalledWith("d", expect.stringContaining("Slot: 2 of 3"), {
      sessionId: "resource-lease:test-server",
      sessionLabel: "Resource Lease",
    });
  });

  it("expires several slots independently, keeping a renewed sibling intact and filling FIFO before newcomers", async () => {
    // Advance the clock without firing timers: this tests reconciliation on the
    // actual acquire path as well as simultaneous expiry of two distinct slots.
    await manager.configure("test-server", 3);
    await acquire("a", 5_000);
    await acquire("b", 5_000);
    await acquire("c", 5_000);
    await manager.renew({ resourceKey: "test-server", callerSessionId: "b", slot: 2, ttlMs: 60_000 });
    await acquire("d");
    await acquire("e");
    vi.setSystemTime(Date.now() + 5_001);
    expect((await acquire("f", 60_000, false)).status).toBe("unavailable");
    const status = await manager.getStatus("test-server");
    expect(status.leases.map((lease) => [lease.slot, lease.ownerSessionId])).toEqual([
      [1, "d"],
      [2, "b"],
      [3, "e"],
    ]);
    expect(status.waiters).toEqual([]);
    expect(bridge.injectUserMessage.mock.calls.map(([id]) => id)).toEqual(["d", "e"]);
  });

  it("checks explicit slot ownership and requires a slot for counted force release", async () => {
    // Neither a supplied slot nor leader-style intent grants ordinary ownership.
    await manager.configure("test-server", 3);
    await acquire("a");
    await acquire("b", 5_000);
    await acquire("c");
    await acquire("d");
    await acquire("e");
    await expect(manager.release("test-server", "a", false, 2)).rejects.toMatchObject({ code: "forbidden" });
    await expect(manager.renew({ resourceKey: "test-server", callerSessionId: "a", slot: 2 })).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(manager.release("test-server", "leader", true)).rejects.toMatchObject({ code: "invalid" });
    await expect(manager.release("test-server", "leader", true, 4)).rejects.toMatchObject({ code: "invalid" });
    vi.setSystemTime(Date.now() + 5_001);
    const result = await manager.release("test-server", "leader", true, 2);
    expect(result.released).toMatchObject({ ownerSessionId: "b", slot: 2 });
    expect(result.promoted).toMatchObject({ ownerSessionId: "d", slot: 2 });
    expect(result.waiters.map((waiter) => waiter.waiterSessionId)).toEqual(["e"]);
    expect((await manager.getStatus("test-server")).leases.map((lease) => lease.ownerSessionId)).toEqual([
      "a",
      "d",
      "c",
    ]);
  });

  it("allows only idle capacity changes, preserves no-op configuration and persists configured empty pools", async () => {
    // Both raising and lowering capacity must leave occupied slot identities alone.
    await manager.configure("test-server", 3);
    await acquire("a");
    const before = readFileSync(store.getPathForTest(), "utf8");
    await manager.configure("test-server", 3);
    expect(readFileSync(store.getPathForTest(), "utf8")).toBe(before);
    for (const capacity of [2, 4]) {
      await expect(manager.configure("test-server", capacity)).rejects.toMatchObject({ code: "conflict" });
    }
    for (const capacity of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(manager.configure("test-server", capacity)).rejects.toMatchObject({ code: "invalid" });
    }
    await manager.release("test-server", "a");
    await manager.configure("test-server", 2);
    manager.destroy();
    manager = new ResourceLeaseManager(bridge, store);
    expect(await manager.listStatuses()).toEqual([
      { resourceKey: "test-server", capacity: 2, leases: [], waiters: [], available: true },
    ]);
    expect(await manager.getStatus("unconfigured")).toMatchObject({ capacity: 1, available: true });
    // Resource keys may also be ordinary Object prototype names.
    expect(await manager.getStatus("constructor")).toMatchObject({ capacity: 1, waiters: [] });
  });

  it("preserves singleton owners, times, metadata and waiters through v1 migration and a v2 restart", async () => {
    // This raw fixture is isolated; never migrate or rewrite the real lease store.
    const lease = {
      resourceKey: "test-server",
      ownerSessionId: "a",
      purpose: "Original purpose",
      metadata: { port: "4567" },
      questId: "q-42",
      acquiredAt: Date.now() - 1_000,
      heartbeatAt: Date.now() - 500,
      ttlMs: 60_000,
      expiresAt: Date.now() + 59_500,
    };
    const waiter = {
      id: "w7",
      resourceKey: "test-server",
      waiterSessionId: "b",
      purpose: "Queued purpose",
      metadata: { path: "/test" },
      questId: "q-43",
      queuedAt: Date.now() - 100,
      ttlMs: 30_000,
    };
    writeFileSync(
      store.getPathForTest(),
      JSON.stringify({ version: 1, nextWaiterId: 8, leases: [lease], waiters: { "test-server": [waiter] } }),
    );
    expect(await manager.getStatus("test-server")).toEqual({
      resourceKey: "test-server",
      capacity: 1,
      leases: [{ ...lease, slot: 1 }],
      waiters: [waiter],
      available: false,
    });
    await acquire("c");
    expect(JSON.parse(readFileSync(store.getPathForTest(), "utf8"))).toMatchObject({
      version: 2,
      nextWaiterId: 9,
      leases: [{ ...lease, slot: 1 }],
    });
    manager.destroy();
    manager = new ResourceLeaseManager(bridge, store);
    const released = await manager.release("test-server", "a");
    expect(released.promoted).toMatchObject({
      ownerSessionId: "b",
      slot: 1,
      purpose: waiter.purpose,
      metadata: waiter.metadata,
      ttlMs: waiter.ttlMs,
    });
    expect(released.waiters.map((entry) => entry.id)).toEqual(["w8"]);
  });

  it("restores counted slots/capacity/queue and fills a persisted empty pool before accepting newcomers", async () => {
    // Restart recovery must not favor a new caller over already-persisted waiters.
    await manager.configure("test-server", 3);
    for (const id of ["a", "b", "c", "d", "e"]) await acquire(id);
    const before = await manager.getStatus("test-server");
    manager.destroy();
    manager = new ResourceLeaseManager(bridge, store);
    expect(await manager.getStatus("test-server")).toEqual(before);
    const data = await store.load();
    data.leases = [];
    await store.save(data);
    manager.destroy();
    manager = new ResourceLeaseManager(bridge, store);
    expect(await acquire("newcomer")).toMatchObject({ status: "acquired", lease: { slot: 3 } });
    expect((await manager.getStatus("test-server")).leases.map((lease) => lease.ownerSessionId)).toEqual([
      "d",
      "e",
      "newcomer",
    ]);
  });
});
