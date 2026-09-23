import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResourceLeaseManager } from "./resource-lease-manager.js";
import { ResourceLeaseStore } from "./resource-lease-store.js";

function createBridge() {
  return {
    injectUserMessage: vi.fn(() => "sent" as const),
  };
}

describe("ResourceLeaseManager", () => {
  let tempDir: string;
  let bridge: ReturnType<typeof createBridge>;
  let manager: ResourceLeaseManager;

  beforeEach(async () => {
    vi.useFakeTimers({ now: new Date("2026-04-29T12:00:00Z") });
    tempDir = mkdtempSync(join(tmpdir(), "resource-leases-"));
    bridge = createBridge();
    manager = new ResourceLeaseManager(bridge, new ResourceLeaseStore("test-server", tempDir));
    await manager.startAll();
  });

  afterEach(() => {
    manager.destroy();
    rmSync(tempDir, { recursive: true, force: true });
    vi.useRealTimers();
  });

  it("acquires a named resource with quest, metadata, and default TTL", async () => {
    const result = await manager.acquire({
      resourceKey: "Dev-Server:Companion",
      callerSessionId: "session-1",
      questId: "q-979",
      purpose: "Run E2E verification",
      metadata: { url: "http://localhost:5174", empty: "" },
    });

    expect(result.status).toBe("acquired");
    if (result.status !== "acquired") throw new Error("expected acquired");
    expect(result.lease).toMatchObject({
      resourceKey: "dev-server:companion",
      ownerSessionId: "session-1",
      questId: "q-979",
      purpose: "Run E2E verification",
      metadata: { url: "http://localhost:5174" },
      ttlMs: 30 * 60_000,
    });
    expect(result.lease.expiresAt).toBe(Date.now() + 30 * 60_000);
  });

  it("queues waiters and promotes the first waiter on release", async () => {
    await manager.acquire({
      resourceKey: "agent-browser",
      callerSessionId: "owner",
      purpose: "Inspect UI",
    });
    const queuedOne = await manager.acquire({
      resourceKey: "agent-browser",
      callerSessionId: "waiter-1",
      purpose: "Run mobile check",
      waitIfUnavailable: true,
    });
    const queuedTwo = await manager.acquire({
      resourceKey: "agent-browser",
      callerSessionId: "waiter-2",
      purpose: "Run desktop check",
      waitIfUnavailable: true,
    });

    expect(queuedOne.status).toBe("queued");
    expect(queuedTwo.status).toBe("queued");

    const released = await manager.release("agent-browser", "owner");

    expect(released.promoted).toMatchObject({
      resourceKey: "agent-browser",
      ownerSessionId: "waiter-1",
      purpose: "Run mobile check",
    });
    expect(released.waiters).toHaveLength(1);
    expect(released.waiters[0].waiterSessionId).toBe("waiter-2");
    expect(bridge.injectUserMessage).toHaveBeenCalledWith(
      "waiter-1",
      expect.stringContaining("You now hold `agent-browser`."),
      { sessionId: "resource-lease:agent-browser", sessionLabel: "Resource Lease" },
    );
  });

  it("promotes the first waiter when a lease expires", async () => {
    await manager.acquire({
      resourceKey: "dev-server:companion",
      callerSessionId: "owner",
      purpose: "Use server",
      ttlMs: 10_000,
    });
    await manager.acquire({
      resourceKey: "dev-server:companion",
      callerSessionId: "waiter",
      purpose: "Need server next",
      waitIfUnavailable: true,
    });

    vi.advanceTimersByTime(10_001);
    const status = await manager.getStatus("dev-server:companion");

    expect(status.lease).toMatchObject({
      ownerSessionId: "waiter",
      purpose: "Need server next",
    });
    expect(status.waiters).toEqual([]);
    expect(bridge.injectUserMessage).toHaveBeenCalledWith(
      "waiter",
      expect.stringContaining("Heartbeat with `takode lease renew dev-server:companion`"),
      { sessionId: "resource-lease:dev-server:companion", sessionLabel: "Resource Lease" },
    );
  });

  it("renews only by owner and extends heartbeat/expiry", async () => {
    await manager.acquire({
      resourceKey: "agent-browser",
      callerSessionId: "owner",
      purpose: "Inspect UI",
      ttlMs: 10_000,
    });

    await expect(
      manager.renew({ resourceKey: "agent-browser", callerSessionId: "other", ttlMs: 20_000 }),
    ).rejects.toMatchObject({ code: "forbidden" });

    vi.advanceTimersByTime(1_000);
    const renewed = await manager.renew({ resourceKey: "agent-browser", callerSessionId: "owner", ttlMs: 20_000 });

    expect(renewed.heartbeatAt).toBe(Date.now());
    expect(renewed.expiresAt).toBe(Date.now() + 20_000);
  });

  it("persists leases and waiters through a new manager instance", async () => {
    await manager.acquire({
      resourceKey: "dev-server:companion",
      callerSessionId: "owner",
      purpose: "Use server",
    });
    await manager.acquire({
      resourceKey: "dev-server:companion",
      callerSessionId: "waiter",
      purpose: "Use server next",
      waitIfUnavailable: true,
    });
    manager.destroy();

    const restored = new ResourceLeaseManager(bridge, new ResourceLeaseStore("test-server", tempDir));
    await restored.startAll();
    const status = await restored.getStatus("dev-server:companion");
    restored.destroy();

    expect(status.lease?.ownerSessionId).toBe("owner");
    expect(status.waiters).toHaveLength(1);
    expect(status.waiters[0].waiterSessionId).toBe("waiter");
  });

  it("force-releases the current holder while preserving FIFO and persisted ownership", async () => {
    // The route grants leader authority; the manager still owns the single
    // serialized release and the ordinary queue transition.
    await manager.acquire({ resourceKey: "agent-browser", callerSessionId: "owner", purpose: "Inspect UI" });
    for (const callerSessionId of ["first", "second"]) {
      await manager.wait({
        resourceKey: "agent-browser",
        callerSessionId,
        purpose: "Next inspection",
        waitIfUnavailable: true,
      });
    }

    const result = await manager.release("agent-browser", "leader", true);
    expect(result.released.ownerSessionId).toBe("owner");
    expect(result.promoted?.ownerSessionId).toBe("first");
    expect(result.waiters.map((waiter) => waiter.waiterSessionId)).toEqual(["second"]);
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);

    const restored = new ResourceLeaseManager(bridge, new ResourceLeaseStore("test-server", tempDir));
    try {
      expect((await restored.getStatus("agent-browser")).lease?.ownerSessionId).toBe("first");
    } finally {
      restored.destroy();
    }
  });

  it("force-releases an expired record without also releasing its successor", async () => {
    // Move the clock without running the sweep: the release itself must not
    // expire the owner, promote the first waiter, then force-release that waiter.
    await manager.acquire({
      resourceKey: "agent-browser",
      callerSessionId: "owner",
      purpose: "Inspect UI",
      ttlMs: 10_000,
    });
    for (const callerSessionId of ["first", "second"]) {
      await manager.wait({
        resourceKey: "agent-browser",
        callerSessionId,
        purpose: "Next inspection",
        waitIfUnavailable: true,
      });
    }
    vi.setSystemTime(Date.now() + 10_001);

    const result = await manager.release("agent-browser", "leader", true);
    expect(result.released.ownerSessionId).toBe("owner");
    expect(result.promoted?.ownerSessionId).toBe("first");
    expect(result.waiters.map((waiter) => waiter.waiterSessionId)).toEqual(["second"]);
    expect((await manager.getStatus("agent-browser")).lease?.ownerSessionId).toBe("first");
    expect(bridge.injectUserMessage).toHaveBeenCalledTimes(1);
  });

  it("force release reports a missing lease without creating a reservation", async () => {
    // A recovery command is a release, never an acquisition or fabricated success.
    await expect(manager.release("agent-browser", "leader", true)).rejects.toMatchObject({ code: "not_found" });
    expect((await manager.getStatus("agent-browser")).available).toBe(true);
    expect(bridge.injectUserMessage).not.toHaveBeenCalled();
  });
});
