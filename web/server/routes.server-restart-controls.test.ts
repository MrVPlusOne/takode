import { beforeEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";

vi.mock("./settings-manager.js", () => ({
  getSettings: vi.fn(() => ({
    namerConfig: { backend: "claude" },
    transcriptionConfig: { apiKey: "", baseUrl: "https://api.openai.com/v1", enhancementEnabled: true },
    editorConfig: { editor: "none" },
    questmasterViewMode: "cards",
  })),
  updateSettings: vi.fn(() => ({})),
  getServerName: vi.fn(() => ""),
  setServerName: vi.fn(),
  getServerId: vi.fn(() => "test-server"),
  getClaudeUserDefaultModel: vi.fn(async () => ""),
  getCodexUserDefaultModel: vi.fn(async () => ""),
  STT_MODELS: [],
}));

vi.mock("./path-resolver.js", () => ({
  resolveBinary: vi.fn(() => null),
  getEnrichedPath: vi.fn(() => process.env.PATH ?? ""),
}));

import { createSettingsRoutes } from "./routes/settings.js";

interface MockBridgeSession {
  id: string;
  isGenerating: boolean;
  pendingPermissions: Map<string, unknown>;
}

describe("server restart controls", () => {
  let app: Hono;
  let launcher: {
    listSessions: ReturnType<typeof vi.fn>;
    getSessionNum: ReturnType<typeof vi.fn>;
  };
  let routeBrowserMessage: ReturnType<typeof vi.fn>;
  let requestRestart: ReturnType<typeof vi.fn>;
  let bridgeSessions: Map<string, MockBridgeSession>;

  beforeEach(() => {
    vi.clearAllMocks();
    bridgeSessions = new Map<string, MockBridgeSession>();
    routeBrowserMessage = vi.fn(async () => {});
    requestRestart = vi.fn();
    launcher = {
      listSessions: vi.fn(() => []),
      getSessionNum: vi.fn((sessionId: string) => ({ leader: 5, worker: 11, approval: 17 })[sessionId] ?? null),
    };
    const wsBridge = {
      getSession: vi.fn((sessionId: string) => bridgeSessions.get(sessionId) ?? null),
      routeBrowserMessage,
    };

    app = new Hono();
    app.route(
      "/api",
      createSettingsRoutes({
        launcher,
        wsBridge,
        options: { requestRestart },
        pushoverNotifier: undefined,
      } as any),
    );
  });

  it("blocks restart when a session only has pending permissions", async () => {
    launcher.listSessions.mockReturnValue([{ sessionId: "approval", state: "connected", name: "Needs approval" }]);
    bridgeSessions.set("approval", {
      id: "approval",
      isGenerating: false,
      pendingPermissions: new Map([["perm-1", {}]]),
    });

    const res = await app.request("/api/server/restart", { method: "POST" });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error:
        "Cannot restart while 1 session(s) are still blocking restart readiness. Please stop them first: Needs approval",
    });
    expect(requestRestart).not.toHaveBeenCalled();
  });

  it("interrupts restart blockers in child-before-leader order with user semantics", async () => {
    launcher.listSessions.mockReturnValue([
      { sessionId: "leader", state: "connected", name: "Leader session" },
      { sessionId: "worker", state: "connected", name: "Worker session", herdedBy: "leader" },
      { sessionId: "approval", state: "connected", name: "Needs approval" },
      { sessionId: "idle", state: "connected", name: "Idle session" },
    ]);
    bridgeSessions.set("leader", {
      id: "leader",
      isGenerating: true,
      pendingPermissions: new Map(),
    });
    bridgeSessions.set("worker", {
      id: "worker",
      isGenerating: true,
      pendingPermissions: new Map(),
    });
    bridgeSessions.set("approval", {
      id: "approval",
      isGenerating: false,
      pendingPermissions: new Map([
        ["perm-1", {}],
        ["perm-2", {}],
      ]),
    });
    bridgeSessions.set("idle", {
      id: "idle",
      isGenerating: false,
      pendingPermissions: new Map(),
    });

    const res = await app.request("/api/server/interrupt-all", { method: "POST" });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(routeBrowserMessage.mock.calls.map(([session]) => session.id)).toEqual(["worker", "leader", "approval"]);
    expect(routeBrowserMessage.mock.calls.map(([, msg]) => msg)).toEqual([
      { type: "interrupt", interruptSource: "user" },
      { type: "interrupt", interruptSource: "user" },
      { type: "interrupt", interruptSource: "user" },
    ]);
    expect(body).toEqual({
      ok: true,
      interrupted: [
        { sessionId: "worker", label: "Worker session", reasons: ["running"] },
        { sessionId: "leader", label: "Leader session", reasons: ["running"] },
        { sessionId: "approval", label: "Needs approval", reasons: ["2 pending permissions"] },
      ],
      skipped: [],
      failures: [],
    });
  });
});
