import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerSessionConfigRoutes } from "./session-config-routes.js";

function makeSessionState(overrides: Record<string, unknown> = {}) {
  return {
    session_id: "s1",
    backend_type: "codex",
    model: "gpt-5.4",
    cwd: "/repo",
    tools: [],
    permissionMode: "codex-default",
    claude_code_version: "",
    mcp_servers: [],
    agents: [],
    slash_commands: [],
    skills: [],
    total_cost_usd: 0,
    num_turns: 0,
    context_used_percent: 0,
    is_compacting: false,
    git_branch: "",
    is_worktree: false,
    is_containerized: false,
    repo_root: "",
    git_ahead: 0,
    git_behind: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
    ...overrides,
  };
}

function createApp(options: { backendConnected?: boolean; info?: Record<string, unknown> } = {}) {
  const info = {
    sessionId: "s1",
    backendType: "codex",
    model: "gpt-5.4",
    permissionMode: "codex-default",
    cwd: "/repo",
    state: "connected",
    codexServiceTier: null,
    ...options.info,
  };
  const session = {
    id: "s1",
    backendType: info.backendType,
    state: makeSessionState({ backend_type: info.backendType, model: info.model, permissionMode: info.permissionMode }),
  };
  const launcher = {
    getSession: vi.fn(() => info),
    updateSessionLaunchConfig: vi.fn((_id: string, patch: Record<string, unknown>) => {
      Object.assign(info, patch);
      return info;
    }),
  };
  const wsBridge = {
    getOrCreateSession: vi.fn(() => session),
    isBackendConnected: vi.fn(() => options.backendConnected ?? true),
    setSessionModel: vi.fn(async () => true),
    setSessionPermissionMode: vi.fn(async () => true),
    setCodexServiceTier: vi.fn(async () => true),
    broadcastToSession: vi.fn(),
    persistSessionById: vi.fn(),
  };
  const app = new Hono();
  registerSessionConfigRoutes(app, {
    launcher,
    wsBridge,
    resolveId: (id: string) => id,
  } as any);
  return { app, launcher, wsBridge, info, session };
}

describe("session config routes", () => {
  it("applies Codex service tier immediately without restart", async () => {
    const { app, launcher, wsBridge, info } = createApp();

    const res = await app.request("/sessions/s1/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codexServiceTier: "priority" }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      restartRequired: false,
      immediateFields: ["codexServiceTier"],
      session: { codexServiceTier: "priority" },
    });
    expect(info.codexServiceTier).toBe("priority");
    expect(launcher.updateSessionLaunchConfig).toHaveBeenCalledWith("s1", { codexServiceTier: "priority" });
    expect(wsBridge.setCodexServiceTier).toHaveBeenCalledWith("s1", "priority");
    expect(wsBridge.broadcastToSession).not.toHaveBeenCalled();
  });

  it("persists Codex restart-required settings without invoking immediate handlers", async () => {
    const { app, launcher, wsBridge, session } = createApp();

    const res = await app.request("/sessions/s1/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codexReasoningEffort: "high", codexMaxContextLength: 240000 }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      restartRequired: true,
      restartRequiredFields: ["codexReasoningEffort", "codexMaxContextLength"],
      sessionState: { codex_reasoning_effort: "high", codex_max_context_length: 240000 },
    });
    expect(launcher.updateSessionLaunchConfig).toHaveBeenCalledWith("s1", {
      codexReasoningEffort: "high",
      codexMaxContextLength: 240000,
    });
    expect(wsBridge.setCodexServiceTier).not.toHaveBeenCalled();
    expect(wsBridge.broadcastToSession).toHaveBeenCalledWith("s1", {
      type: "session_update",
      session: { codex_reasoning_effort: "high", codex_max_context_length: 240000 },
    });
    expect(wsBridge.persistSessionById).toHaveBeenCalledWith("s1");
    expect((session.state as Record<string, unknown>).codex_max_context_length).toBe(240000);
  });

  it("rejects unsupported Claude max context values", async () => {
    const { app } = createApp({ info: { backendType: "claude", permissionMode: "default" } });

    const res = await app.request("/sessions/s1/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claudeMaxContextLength: 200000 }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "claudeMaxContextLength currently supports only 1000000 or null",
    });
  });
});
