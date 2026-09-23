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
    }
  >;

  beforeEach(async () => {
    launcherSessions = new Map([
      ["owner", { sessionId: "owner", sessionNum: 1370, name: "Owner Execute" }],
      ["waiter", { sessionId: "waiter", sessionNum: 1364, name: "Waiter Execute" }],
      ["leader", { sessionId: "leader", isOrchestrator: true }],
      ["other", { sessionId: "other" }],
    ]);
    tempDir = mkdtempSync(join(tmpdir(), "resource-lease-routes-"));
    manager = new ResourceLeaseManager(
      { injectUserMessage: vi.fn(() => "sent" as const) },
      new ResourceLeaseStore("route-test", tempDir),
    );
    await manager.startAll();
    const launcher = {
      getSession: (sessionId: string) => launcherSessions.get(sessionId),
      getSessionNum: (sessionId: string) => launcherSessions.get(sessionId)?.sessionNum,
      verifySessionAuthToken: (sessionId: string, token: string) => token === `test-token-${sessionId}`,
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
      lease: {
        ownerSessionId: "owner",
        ownerSessionNum: 1370,
        ownerSessionName: "Owner Execute",
        questId: "q-979",
        purpose: "Inspect UI",
      },
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
    expect((await manager.getStatus("agent-browser")).lease?.ownerSessionId).toBe("owner");
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
});
