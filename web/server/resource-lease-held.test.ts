import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResourceLeaseManager } from "./resource-lease-manager.js";
import { ResourceLeaseStore } from "./resource-lease-store.js";
import type { ResourceLease } from "./resource-lease-types.js";

/**
 * Held slots: a slot of a pool held by one running command (`takode lease run`,
 * `takode exec --pool`) rather than by a session. They share a pool's capacity,
 * queue and status with session leases, but a session may hold many of them,
 * waiting for one never messages the session, and a command may wait in several
 * pools (one per machine) at once.
 */
describe("held resource lease slots", () => {
  let directory: string;
  let store: ResourceLeaseStore;
  let manager: ResourceLeaseManager;
  const bridge = {
    injectUserMessage: vi.fn(
      (_sessionId: string, _content: string, _source?: { sessionId: string; sessionLabel?: string }) => "sent" as const,
    ),
    invalidateSessionNavigation: vi.fn(),
  };
  const hold = (holderId: string, resourceKeys = ["checks@condor"], callerSessionId = "worker", ttlMs = 60_000) =>
    manager.hold({ resourceKeys, holderId, callerSessionId, purpose: `check ${holderId}`, ttlMs });

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-11-08T12:00:00Z") });
    directory = mkdtempSync(join(tmpdir(), "held-leases-"));
    store = new ResourceLeaseStore("test", directory);
    manager = new ResourceLeaseManager(bridge, store);
    bridge.injectUserMessage.mockClear();
  });

  afterEach(() => {
    manager.destroy();
    rmSync(directory, { recursive: true, force: true });
    vi.useRealTimers();
  });

  // The core gap of session leases: one session (a worker and its sub-agents)
  // gets a slot per running command, up to capacity, and the next one waits
  // in line; promotion wakes the waiting caller without messaging the session.
  it("gives one session a slot per command and promotes a waiter without messaging the session", async () => {
    await manager.configure("checks@condor", 2);
    expect(await hold("run:a")).toMatchObject({ status: "held", lease: { slot: 1, holderId: "run:a" } });
    expect(await hold("run:b")).toMatchObject({ status: "held", lease: { slot: 2 } });
    expect(await hold("run:c")).toEqual({ status: "queued", resourceKeys: ["checks@condor"], position: 1 });
    // Asking again for a holder reports where it stands instead of taking another slot.
    expect(await hold("run:a")).toMatchObject({ status: "held", lease: { slot: 1 } });

    const waiting = manager.waitHold("run:c", "queued", 30_000);
    await manager.releaseHold("run:a", "worker");
    await expect(waiting).resolves.toMatchObject({ status: "held", lease: { slot: 1, holderId: "run:c" } });
    expect(bridge.injectUserMessage).not.toHaveBeenCalled();
    // The session is reported as waiting on the pool once, however many of its commands wait there.
    await hold("run:d");
    await hold("run:e");
    expect(manager.getLeaseWaits("worker")).toEqual([
      { resourceKey: "checks@condor", holderSessionIds: ["worker"], position: 1 },
    ]);
  });

  // Held slots and the session's own lease are separate: holding slots for
  // commands does not make `acquire` report the session as already holding,
  // and session-level renew/release/withdraw never touch a command's slot.
  it("keeps a session's own lease separate from the slots its commands hold", async () => {
    await manager.configure("checks@condor", 3);
    await hold("run:a");
    const own = await manager.acquire({ resourceKey: "checks@condor", callerSessionId: "worker", purpose: "own" });
    expect(own).toMatchObject({ status: "acquired", lease: { slot: 2 } });
    expect(manager.holdsLease("checks@condor", "worker")).toBe(true);
    await manager.release("checks@condor", "worker");
    expect(manager.holdsLease("checks@condor", "worker")).toBe(false);
    // Only the command's slot is left; releasing it by slot without force is refused.
    await expect(manager.release("checks@condor", "worker")).rejects.toThrow(/No active lease|Only/);
    await expect(manager.release("checks@condor", "worker", false, 1)).rejects.toThrow(/held by a running command/);
    expect(await manager.waitHold("run:a", "gone", 0)).toMatchObject({ status: "held" });
  });

  // A command that can run on several machines waits in each machine's pool
  // and takes the first slot that frees, leaving the other lines in the same
  // step, so it never holds two slots or blocks a line it no longer needs.
  it("waits in several pools and takes the first slot that frees, leaving the other lines", async () => {
    await manager.configure("checks@condor", 1);
    await manager.configure("checks@condor2", 1);
    await hold("run:x", ["checks@condor"], "other");
    await hold("run:y", ["checks@condor2"], "other");
    const both = ["checks@condor", "checks@condor2"];
    expect(await hold("run:a", both)).toEqual({ status: "queued", resourceKeys: both, position: 1 });
    expect(await hold("run:b", both)).toMatchObject({ status: "queued", position: 2 });

    await manager.releaseHold("run:y", "other");
    expect(await manager.waitHold("run:a", "queued", 0)).toMatchObject({
      status: "held",
      lease: { resourceKey: "checks@condor2" },
    });
    // run:a left condor's line, so run:b is now first there.
    expect(await manager.waitHold("run:b", "gone", 0)).toEqual({
      status: "queued",
      resourceKeys: both,
      position: 1,
    });
    await manager.releaseHold("run:x", "other");
    expect(await manager.waitHold("run:b", "queued", 0)).toMatchObject({
      status: "held",
      lease: { resourceKey: "checks@condor" },
    });
    expect((await manager.getStatus("checks@condor")).waiters).toEqual([]);
    expect((await manager.getStatus("checks@condor2")).waiters).toEqual([]);
  });

  // With free slots on several machines, the command goes where most are free.
  it("starts on the pool with the most free slots", async () => {
    await manager.configure("checks@condor", 4);
    await manager.configure("checks@condor2", 8);
    expect(await hold("run:a", ["checks@condor", "checks@condor2"])).toMatchObject({
      status: "held",
      lease: { resourceKey: "checks@condor2" },
    });
  });

  // Liveness: a command's slot and its place in line last only as long as
  // their caller renews them, so a caller that died frees both on its own.
  it("frees the slot and the place in line of a holder that stops renewing", async () => {
    await manager.configure("checks@condor", 1);
    await hold("run:a", ["checks@condor"], "worker", 10_000);
    await hold("run:b", ["checks@condor"], "worker", 10_000);
    await hold("run:c", ["checks@condor"], "worker", 10_000);
    vi.setSystemTime(Date.now() + 8_000);
    await manager.renewHold("run:a", "worker");
    await manager.renewHold("run:c", "worker");
    vi.setSystemTime(Date.now() + 8_000);
    await manager.sweepExpiredNow();
    // run:b stopped renewing and left the line; run:a still holds the slot.
    expect(await manager.waitHold("run:b", "queued", 0)).toEqual({ status: "gone" });
    expect(await manager.waitHold("run:a", "gone", 0)).toMatchObject({ status: "held" });
    // run:a stops renewing too; run:c keeps renewing and takes its slot.
    await manager.renewHold("run:c", "worker");
    vi.setSystemTime(Date.now() + 3_000);
    await manager.sweepExpiredNow();
    expect(await manager.waitHold("run:c", "queued", 0)).toMatchObject({ status: "held", lease: { slot: 1 } });
  });

  // A leader can still recover a slot; the command's waiting caller learns it lost it.
  it("lets a leader force-release a held slot and wakes its holder", async () => {
    await manager.configure("checks@condor", 2);
    await hold("run:a");
    const waiting = manager.waitHold("run:a", "held", 30_000);
    await manager.release("checks@condor", "leader", true, 1);
    await expect(waiting).resolves.toEqual({ status: "gone" });
  });

  it("refuses another session's renewal or release of a held slot", async () => {
    await hold("run:a");
    await expect(manager.renewHold("run:a", "intruder")).rejects.toThrow(/another session/);
    await expect(manager.releaseHold("run:a", "intruder")).rejects.toThrow(/another session/);
    await expect(hold("run:a", ["checks@condor"], "intruder")).rejects.toThrow(/another session/);
  });

  // Server components (takode exec) own holders by prefix: they get a callback
  // on promotion instead of a long-poll wake-up.
  it("calls a system owner back when its holder is promoted", async () => {
    const promoted: ResourceLease[] = [];
    manager.registerSystemOwner("exec:", (lease) => promoted.push(lease));
    await hold("run:a");
    await hold("exec:x-1");
    await manager.releaseHold("run:a", "worker");
    await vi.runOnlyPendingTimersAsync();
    expect(promoted).toMatchObject([{ holderId: "exec:x-1", resourceKey: "checks@condor", slot: 1 }]);
  });

  // Held slots and places in line survive a coordinator restart.
  it("keeps holders and the expiry of their places in line across a reload", async () => {
    await hold("run:a");
    await hold("run:b", ["checks@condor"], "worker", 10_000);
    await store.flushForTest();
    const reloaded = new ResourceLeaseManager(bridge, new ResourceLeaseStore("test", directory));
    expect(await reloaded.waitHold("run:a", "gone", 0)).toMatchObject({ status: "held" });
    expect(await reloaded.waitHold("run:b", "gone", 0)).toMatchObject({ status: "queued" });
    vi.setSystemTime(Date.now() + 10_001);
    await reloaded.sweepExpiredNow();
    expect(await reloaded.waitHold("run:b", "queued", 0)).toEqual({ status: "gone" });
    reloaded.destroy();
  });
});
