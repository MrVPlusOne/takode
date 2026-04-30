import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createTakodeRoutes } from "./routes/takode.js";

function createTestApp(options?: {
  callerId?: string;
  launcherSession?: Record<string, unknown> | null;
  bridgeSession?: Record<string, unknown> | null;
  checkpointResult?: Record<string, unknown>;
}) {
  const checkpoint = vi.fn(
    () =>
      options?.checkpointResult ?? {
        ok: true,
        streamed: true,
        reason: "streamed",
        msgRange: { from: 10, to: 12 },
      },
  );
  const app = new Hono();
  app.route(
    "/api",
    createTakodeRoutes({
      launcher: {
        getSessionNum: vi.fn(() => 7),
        getSession: vi.fn(() => options?.launcherSession ?? { sessionId: "worker-1", herdedBy: "leader-1" }),
      },
      wsBridge: {
        getSession: vi.fn(() => options?.bridgeSession ?? { sessionId: "worker-1" }),
        emitWorkerStreamCheckpoint: checkpoint,
      },
      authenticateTakodeCaller: vi.fn(() => ({
        callerId: options?.callerId ?? "worker-1",
        caller: { sessionId: options?.callerId ?? "worker-1", isOrchestrator: false },
      })),
      resolveId: (id: string) => id,
    } as any),
  );
  return { app, checkpoint };
}

describe("POST /api/sessions/:id/worker-stream", () => {
  it("allows a herded worker to stream its own checkpoint", async () => {
    const { app, checkpoint } = createTestApp();

    const res = await app.request("/api/sessions/worker-1/worker-stream", { method: "POST" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      ok: true,
      streamed: true,
      reason: "streamed",
      msgRange: { from: 10, to: 12 },
    });
    expect(checkpoint).toHaveBeenCalledWith("worker-1");
  });

  it("rejects checkpoint requests for another session", async () => {
    const { app, checkpoint } = createTestApp({ callerId: "worker-1" });

    const res = await app.request("/api/sessions/worker-2/worker-stream", { method: "POST" });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({
      error: "Can only stream checkpoints from your own session",
    });
    expect(checkpoint).not.toHaveBeenCalled();
  });

  it("requires the caller session to be herded", async () => {
    const { app, checkpoint } = createTestApp({ launcherSession: { sessionId: "worker-1" } });

    const res = await app.request("/api/sessions/worker-1/worker-stream", { method: "POST" });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({
      error: "worker-stream requires a herded worker or reviewer session",
    });
    expect(checkpoint).not.toHaveBeenCalled();
  });

  it("returns clean no-op checkpoint results", async () => {
    const { app } = createTestApp({
      checkpointResult: { ok: true, streamed: false, reason: "no_activity" },
    });

    const res = await app.request("/api/sessions/worker-1/worker-stream", { method: "POST" });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, streamed: false, reason: "no_activity" });
  });
});
