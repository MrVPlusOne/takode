import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerTakodeReconnectRoute } from "./takode-reconnect.js";

function createTestApp() {
  const launcherSessions = new Map<string, any>([
    ["leader", { sessionId: "leader", isOrchestrator: true }],
    ["offline", { sessionId: "offline", sessionNum: 2, backendType: "codex", herdedBy: "leader" }],
    ["healthy", { sessionId: "healthy", sessionNum: 3, backendType: "codex", herdedBy: "leader" }],
    ["busy", { sessionId: "busy", sessionNum: 4, backendType: "codex", herdedBy: "leader" }],
    ["foreign", { sessionId: "foreign", sessionNum: 5, backendType: "codex", herdedBy: "other" }],
  ]);
  const bridgeSessions = new Map<string, any>([
    [
      "offline",
      {
        id: "offline",
        backendType: "codex",
        state: { backend_state: "recovery_suppressed", pause: null },
        isGenerating: false,
      },
    ],
    [
      "healthy",
      { id: "healthy", backendType: "codex", state: { backend_state: "connected", pause: null }, isGenerating: false },
    ],
    [
      "busy",
      { id: "busy", backendType: "codex", state: { backend_state: "disconnected", pause: null }, isGenerating: true },
    ],
    [
      "foreign",
      {
        id: "foreign",
        backendType: "codex",
        state: { backend_state: "disconnected", pause: null },
        isGenerating: false,
      },
    ],
  ]);
  const relaunch = vi.fn(async () => ({ ok: true }));
  const injectUserMessage = vi.fn();
  const api = new Hono();
  registerTakodeReconnectRoute(api, {
    launcher: {
      getSession: (id: string) => launcherSessions.get(id),
      getHerdedSessions: () => [
        launcherSessions.get("offline"),
        launcherSessions.get("healthy"),
        launcherSessions.get("busy"),
      ],
      relaunch,
    },
    wsBridge: {
      getSession: (id: string) => bridgeSessions.get(id),
      isBackendConnected: (id: string) => id === "healthy",
      clearCodexAutomaticRecoverySuppression: vi.fn(),
      markCodexAutoRecoveryFailed: vi.fn(),
      persistSessionById: vi.fn(),
      broadcastToSession: vi.fn(),
      injectUserMessage,
    },
    authenticateTakodeCaller: vi.fn(() => ({ callerId: "leader", caller: launcherSessions.get("leader") })),
    resolveId: (ref: string) => (launcherSessions.has(ref) ? ref : null),
  } as any);
  const app = new Hono();
  app.route("/api", api);
  return { app, relaunch, bridgeSessions, injectUserMessage };
}

describe("leader worker reconnect route", () => {
  it("reconnects eligible herded workers and safely skips healthy or generating workers", async () => {
    const { app, relaunch, bridgeSessions, injectUserMessage } = createTestApp();
    const response = await app.request("/api/takode/reconnect", {
      method: "POST",
      body: JSON.stringify({ all: true }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      requested: 3,
      started: 1,
      skipped: 2,
      failed: 0,
      results: [
        { sessionId: "offline", status: "started", reason: "reconnect_started" },
        { sessionId: "healthy", status: "skipped", reason: "already_connected" },
        { sessionId: "busy", status: "skipped", reason: "generating" },
      ],
    });
    expect(bridgeSessions.get("offline")?.state).toMatchObject({
      backend_state: "recovering",
      backend_reconnect: { attempt: 1, maxAttempts: 5 },
    });
    expect(relaunch).toHaveBeenCalledTimes(1);
    expect(relaunch).toHaveBeenCalledWith("offline");
    expect(injectUserMessage).not.toHaveBeenCalled();
  });

  it("reports unowned and unknown selected sessions without reconnecting them", async () => {
    const { app, relaunch } = createTestApp();
    const response = await app.request("/api/takode/reconnect", {
      method: "POST",
      body: JSON.stringify({ workerIds: ["foreign", "missing"] }),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      started: 0,
      skipped: 2,
      results: [
        { ref: "foreign", status: "skipped", reason: "not_owned" },
        { ref: "missing", status: "skipped", reason: "not_found" },
      ],
    });
    expect(relaunch).not.toHaveBeenCalled();
  });
});
