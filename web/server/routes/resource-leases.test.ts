import { Hono } from "hono";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResourceLeaseManager } from "../resource-lease-manager.js";
import { ResourceLeaseStore } from "../resource-lease-store.js";
import { createResourceLeaseRoutes } from "./resource-leases.js";
import { validateCompanionAuth } from "./auth.js";

function authHeaders(sessionId: string) {
  return {
    "content-type": "application/json",
    "x-companion-session-id": sessionId,
    "x-companion-auth-token": `test-token-${sessionId}`,
  };
}

describe("resource lease routes", () => {
  let tempDir: string;
  let manager: ResourceLeaseManager;
  let app: Hono;
  let launcherSessions: Map<
    string,
    {
      sessionId: string;
      sessionNum?: number;
      name?: string;
      isOrchestrator?: boolean;
      archived?: boolean;
      herdedBy?: string;
      hostId?: string;
    }
  >;

  beforeEach(async () => {
    launcherSessions = new Map([
      ["owner", { sessionId: "owner", sessionNum: 1370, name: "Owner Execute" }],
      ["waiter", { sessionId: "waiter", sessionNum: 1364, name: "Waiter Execute" }],
      ["leader", { sessionId: "leader", isOrchestrator: true }],
      ["other", { sessionId: "other" }],
      ["remote", { sessionId: "remote", hostId: "host-1" }],
    ]);
    tempDir = mkdtempSync(join(tmpdir(), "resource-lease-routes-"));
    manager = new ResourceLeaseManager(
      { injectUserMessage: vi.fn(() => "sent" as const), invalidateSessionNavigation: vi.fn() },
      new ResourceLeaseStore("route-test", tempDir),
    );
    await manager.startAll();
    const launcher = {
      getSession: (sessionId: string) => launcherSessions.get(sessionId),
      getSessionNum: (sessionId: string) => launcherSessions.get(sessionId)?.sessionNum,
      verifySessionAuthToken: (sessionId: string, token: string) => token === `test-token-${sessionId}`,
      remoteHosts: { registry: { get: async (id: string) => ({ id, name: "devbox", createdAt: 0 }) } },
    };
    app = new Hono();
    app.route(
      "/api",
      createResourceLeaseRoutes({
        resourceLeaseManager: manager,
        launcher,
        wsBridge: {
          getSession: (sessionId: string) => ({
            state: { claimedQuestId: sessionId === "owner" ? "q-979" : undefined },
          }),
        },
        authenticateTakodeCaller: (c: any) => {
          return validateCompanionAuth(c, launcher as any, (id) => (launcherSessions.has(id) ? id : null), {
            required: true,
          });
        },
      } as any),
    );
  });

  afterEach(() => {
    manager.destroy();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("acquires with caller ownership and default claimed quest", async () => {
    const response = await app.request("/api/resource-leases/dev-server:companion/acquire", {
      method: "POST",
      headers: authHeaders("owner"),
      body: JSON.stringify({ purpose: "Run local verification", metadata: { url: "http://localhost:5174" } }),
    });

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.result.lease).toMatchObject({
      resourceKey: "dev-server:companion",
      ownerSessionId: "owner",
      ownerSessionNum: 1370,
      ownerSessionName: "Owner Execute",
      questId: "q-979",
      metadata: { url: "http://localhost:5174" },
    });
  });

  // The same key names a different machine's resource for a session on a remote
  // host, so a dev server there never blocks one on the coordinator's machine.
  it("qualifies a remote session's lease keys with its host name", async () => {
    const acquire = (sessionId: string, key: string) =>
      app.request(`/api/resource-leases/${key}/acquire`, {
        method: "POST",
        headers: authHeaders(sessionId),
        body: JSON.stringify({ purpose: "Run dev server" }),
      });

    const remote = await (await acquire("remote", "dev-server:companion")).json();
    expect(remote.result.lease.resourceKey).toBe("dev-server:companion@devbox");
    const local = await (await acquire("owner", "dev-server:companion")).json();
    expect(local.result.lease.resourceKey).toBe("dev-server:companion");

    // Naming the host explicitly reaches that host's pool from anywhere.
    const explicit = await (await acquire("other", "dev-server:companion@devbox")).json();
    expect(explicit.result).toMatchObject({ status: "unavailable", leases: [{ ownerSessionId: "remote" }] });
  });

  // A port lease guards a remote branch that every machine pushes to, so a
  // remote session and a local session porting to the same branch must queue
  // in one pool, while another branch of the same repo stays independent.
  it("shares a port lease for one repository branch across machines", async () => {
    const acquire = (sessionId: string, key: string) =>
      app.request(`/api/resource-leases/${encodeURIComponent(key)}/acquire`, {
        method: "POST",
        headers: authHeaders(sessionId),
        body: JSON.stringify({ purpose: "Port a change", wait: true }),
      });

    const remote = await (await acquire("remote", "port:companion:jiayi")).json();
    expect(remote.result).toMatchObject({ status: "acquired", lease: { resourceKey: "port:companion:jiayi" } });
    const local = await (await acquire("owner", "port:companion:jiayi")).json();
    expect(local.result).toMatchObject({ status: "queued", leases: [{ ownerSessionId: "remote" }] });

    // Branch names may contain slashes; each branch is its own pool.
    const otherBranch = await (await acquire("other", "port:companion:jiayi/feature")).json();
    expect(otherBranch.result).toMatchObject({
      status: "acquired",
      lease: { resourceKey: "port:companion:jiayi/feature" },
    });

    // Releasing on the remote machine hands the branch to the local waiter.
    const released = await app.request(`/api/resource-leases/${encodeURIComponent("port:companion:jiayi")}/release`, {
      method: "POST",
      headers: authHeaders("remote"),
    });
    expect((await released.json()).result.promoted).toMatchObject({ ownerSessionId: "owner" });
  });

  it("enriches queued acquire responses with owner and waiter session labels", async () => {
    await app.request("/api/resource-leases/agent-browser/acquire", {
      method: "POST",
      headers: authHeaders("owner"),
      body: JSON.stringify({ purpose: "Inspect UI" }),
    });

    const response = await app.request("/api/resource-leases/agent-browser/acquire", {
      method: "POST",
      headers: authHeaders("waiter"),
      body: JSON.stringify({ purpose: "Need browser next", wait: true }),
    });

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.result).toMatchObject({
      status: "queued",
      position: 1,
      leases: [
        {
          ownerSessionId: "owner",
          ownerSessionNum: 1370,
          ownerSessionName: "Owner Execute",
          questId: "q-979",
          purpose: "Inspect UI",
        },
      ],
      waiter: {
        waiterSessionId: "waiter",
        waiterSessionNum: 1364,
        waiterSessionName: "Waiter Execute",
        purpose: "Need browser next",
      },
    });
    expect(body.result.waiters).toHaveLength(1);
    expect(body.result.waiters[0]).toMatchObject({
      waiterSessionId: "waiter",
      waiterSessionNum: 1364,
      waiterSessionName: "Waiter Execute",
    });
  });

  it("rejects release from a non-owner session", async () => {
    await app.request("/api/resource-leases/agent-browser/acquire", {
      method: "POST",
      headers: authHeaders("owner"),
      body: JSON.stringify({ purpose: "Inspect UI" }),
    });

    const response = await app.request("/api/resource-leases/agent-browser/release", {
      method: "POST",
      headers: authHeaders("other"),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Only owner can release agent-browser" });
  });

  it.each([
    { name: "another herd's worker", archived: false, herdedBy: "different-leader", isOrchestrator: false },
    { name: "an archived worker", archived: true, herdedBy: undefined, isOrchestrator: false },
    { name: "another leader", archived: false, herdedBy: undefined, isOrchestrator: true },
  ])("allows explicit leader recovery of $name and promotes the FIFO waiter", async (owner) => {
    // The approved authority is server-wide; it must not silently acquire herd,
    // archive or owner-role gates. No process or session lifecycle API is involved.
    Object.assign(launcherSessions.get("owner")!, owner);
    await manager.acquire({ resourceKey: "agent-browser", callerSessionId: "owner", purpose: "Inspect UI" });
    await manager.wait({
      resourceKey: "agent-browser",
      callerSessionId: "waiter",
      purpose: "Next inspection",
      waitIfUnavailable: true,
    });
    const response = await app.request("/api/resource-leases/agent-browser/release", {
      method: "POST",
      headers: authHeaders("leader"),
      body: JSON.stringify({ force: true }),
    });
    expect(response.status).toBe(200);
    expect((await response.json()).result).toMatchObject({
      released: { ownerSessionId: "owner" },
      promoted: { ownerSessionId: "waiter" },
      waiters: [],
    });
  });

  it.each([
    { name: "an ordinary worker", headers: authHeaders("waiter") },
    { name: "an ordinary owner", headers: authHeaders("owner") },
    { name: "a missing credential", headers: { "content-type": "application/json" } },
    {
      name: "a forged leader identity",
      headers: { ...authHeaders("leader"), "x-companion-auth-token": "test-token-waiter" },
    },
  ])("rejects force release from $name without modifying the lease", async ({ headers }) => {
    // Exercise the real auth validator: client-supplied identity/role fields
    // cannot turn a worker or an unauthenticated request into a leader.
    await manager.acquire({ resourceKey: "agent-browser", callerSessionId: "owner", purpose: "Inspect UI" });
    const response = await app.request("/api/resource-leases/agent-browser/release", {
      method: "POST",
      headers,
      body: JSON.stringify({ force: true, callerSessionId: "leader", isOrchestrator: true }),
    });
    expect(response.status).toBe(403);
    expect((await manager.getStatus("agent-browser")).leases[0]?.ownerSessionId).toBe("owner");
  });

  it("requires an explicit force flag even for a leader, while ordinary owner release still works", async () => {
    // The new override must not make all leader release calls privileged.
    await manager.acquire({ resourceKey: "agent-browser", callerSessionId: "owner", purpose: "Inspect UI" });
    const denied = await app.request("/api/resource-leases/agent-browser/release", {
      method: "POST",
      headers: authHeaders("leader"),
    });
    expect(denied.status).toBe(403);
    const released = await app.request("/api/resource-leases/agent-browser/release", {
      method: "POST",
      headers: authHeaders("owner"),
    });
    expect(released.status).toBe(200);
    expect((await manager.getStatus("agent-browser")).available).toBe(true);
  });
  it("authenticates capacity changes and per-slot operations through the canonical pool API", async () => {
    // Caller role comes from server authentication, never from request fields.
    const post = (action: string, caller: string, body: object) =>
      app.request(`/api/resource-leases/test-server/${action}`, {
        method: "POST",
        headers: authHeaders(caller),
        body: JSON.stringify(body),
      });
    expect((await post("configure", "owner", { capacity: 3, isOrchestrator: true })).status).toBe(403);
    expect((await post("configure", "leader", { capacity: 0 })).status).toBe(400);
    expect((await post("configure", "leader", { capacity: 3 })).status).toBe(200);
    for (const caller of ["owner", "waiter", "other"]) {
      expect((await post("acquire", caller, { purpose: "Check", callerSessionId: "leader" })).status).toBe(201);
    }
    const full = await (await post("acquire", "leader", { purpose: "Next" })).json();
    expect(full.result).toMatchObject({ status: "unavailable", capacity: 3, resourceKey: "test-server" });
    expect(full.result.leases.map((lease: any) => lease.slot)).toEqual([1, 2, 3]);
    expect(full.result).not.toHaveProperty("lease");
    expect((await post("configure", "leader", { capacity: 4 })).status).toBe(409);
    expect((await post("configure", "leader", { capacity: 3 })).status).toBe(200);
    expect((await post("renew", "owner", { slot: 2 })).status).toBe(403);
    expect((await post("heartbeat", "owner", { slot: 1, ttl: "1m" })).status).toBe(200);
    expect((await post("release", "owner", { slot: 2, force: true })).status).toBe(403);
    expect((await post("release", "leader", { force: true })).status).toBe(400);
    expect((await post("release", "leader", { force: true, slot: "2" })).status).toBe(400);
    const released = await (await post("release", "leader", { force: true, slot: 2 })).json();
    expect(released.result.released).toMatchObject({ slot: 2, ownerSessionId: "waiter" });
    const status = await (
      await app.request("/api/resource-leases/test-server", { headers: authHeaders("leader") })
    ).json();
    expect(status.resource.capacity).toBe(3);
    expect(status.resource.leases.map((lease: any) => lease.slot)).toEqual([1, 3]);
    expect(status.resource.leases[0]).toMatchObject({ ownerSessionNum: 1370, ownerSessionName: "Owner Execute" });
    expect(status.resource).not.toHaveProperty("lease");
  });
});
