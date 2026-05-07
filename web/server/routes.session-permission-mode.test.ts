import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerSessionPermissionModeRoute } from "./routes/session-permission-mode.js";

function createPermissionModeRouteApp(
  sessions: Record<string, { backendType?: string; herdedBy?: string; isOrchestrator?: boolean }>,
) {
  const api = new Hono();
  const launcher = {
    resolveSessionId: vi.fn((id: string) => (sessions[id] ? id : null)),
    getSession: vi.fn((id: string) => sessions[id] ?? null),
  };
  const wsBridge = {
    getOrCreateSession: vi.fn(),
    setSessionPermissionMode: vi.fn(async () => true),
  };
  registerSessionPermissionModeRoute(api, {
    launcher,
    wsBridge,
    resolveId: (raw: string) => launcher.resolveSessionId(raw),
  } as any);
  return { api, launcher, wsBridge };
}

describe("session permission mode route", () => {
  it("updates a Codex session with a backend-native profile", async () => {
    // The runtime route should accept the stored Codex profile values produced
    // by UI and CLI normalization.
    const { api, wsBridge } = createPermissionModeRouteApp({
      leader: { backendType: "codex", isOrchestrator: true },
      worker: { backendType: "codex", herdedBy: "leader" },
    });

    const res = await api.request("/sessions/worker/permission-mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "codex-auto-review", leaderSessionId: "leader" }),
    });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      sessionId: "worker",
      permissionMode: "codex-auto-review",
    });
    expect(wsBridge.getOrCreateSession).toHaveBeenCalledWith("worker", "codex");
    expect(wsBridge.setSessionPermissionMode).toHaveBeenCalledWith("worker", "codex-auto-review");
  });

  it("rejects legacy Claude modes for Codex runtime updates", async () => {
    // Session creation still migrates legacy modes, but runtime updates should
    // be explicit backend-native values after the permission model simplification.
    const { api, wsBridge } = createPermissionModeRouteApp({
      worker: { backendType: "codex" },
    });

    const res = await api.request("/sessions/worker/permission-mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "plan" }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Unsupported permission mode for codex session: plan" });
    expect(wsBridge.setSessionPermissionMode).not.toHaveBeenCalled();
  });

  it("rejects Codex profiles for Claude runtime updates", async () => {
    // Backend-specific validation prevents a leader command from silently
    // applying a Codex profile to a Claude worker.
    const { api, wsBridge } = createPermissionModeRouteApp({
      worker: { backendType: "claude" },
    });

    const res = await api.request("/sessions/worker/permission-mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "codex-full-access" }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Unsupported permission mode for claude session: codex-full-access",
    });
    expect(wsBridge.setSessionPermissionMode).not.toHaveBeenCalled();
  });

  it("rejects unsupported backend types before touching bridge state", async () => {
    // Unknown backends should fail clearly instead of being treated as Claude.
    const { api, wsBridge } = createPermissionModeRouteApp({
      worker: { backendType: "unknown-backend" },
    });

    const res = await api.request("/sessions/worker/permission-mode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "default" }),
    });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "Unsupported backend for permission modes: unknown-backend",
    });
    expect(wsBridge.setSessionPermissionMode).not.toHaveBeenCalled();
  });
});
