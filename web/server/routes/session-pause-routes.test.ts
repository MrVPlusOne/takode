import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { registerSessionPauseRoutes } from "./session-pause-routes.js";

function createApp(overrides: { archived?: boolean } = {}) {
  const pause = { pausedAt: 123, queuedMessages: [] };
  const wsBridge = {
    pauseSession: vi.fn(() => pause),
    unpauseSession: vi.fn(async () => ({ queued: 2 })),
    getSession: vi.fn(() => ({ id: "s1", state: { pause } })),
  };
  const launcher = {
    getSession: vi.fn(() => ({ sessionId: "s1", archived: overrides.archived ?? false })),
  };
  const app = new Hono();
  registerSessionPauseRoutes(app, {
    launcher,
    wsBridge,
    resolveId: (id: string) => id,
  } as any);
  return { app, wsBridge };
}

describe("session pause routes", () => {
  it("pauses and unpauses sessions through the bridge", async () => {
    const { app, wsBridge } = createApp();

    const pauseRes = await app.request("/sessions/s1/pause", {
      method: "POST",
      body: JSON.stringify({ reason: "runaway loop", pausedBy: "operator" }),
    });
    expect(pauseRes.status).toBe(200);
    expect(await pauseRes.json()).toEqual({
      ok: true,
      sessionId: "s1",
      pause: { pausedAt: 123, queuedMessages: [] },
      queued: 0,
    });
    expect(wsBridge.pauseSession).toHaveBeenCalledWith("s1", { reason: "runaway loop", pausedBy: "operator" });

    const unpauseRes = await app.request("/sessions/s1/unpause", { method: "POST" });
    expect(unpauseRes.status).toBe(200);
    expect(await unpauseRes.json()).toEqual({ ok: true, sessionId: "s1", wasPaused: true, resumed: 2 });
    expect(wsBridge.unpauseSession).toHaveBeenCalledWith("s1");
  });

  it("rejects pausing archived sessions", async () => {
    const { app, wsBridge } = createApp({ archived: true });

    const res = await app.request("/sessions/s1/pause", { method: "POST" });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "Cannot pause archived session" });
    expect(wsBridge.pauseSession).not.toHaveBeenCalled();
  });
});
