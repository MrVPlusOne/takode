import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createSessionsRoutes } from "./routes/sessions.js";

function makeRoute(result: "closed" | "not-open" | "not-closable" | "not-found") {
  const closeLeaderThreadTab = vi.fn(() => result);
  const ctx = {
    launcher: { getSession: vi.fn(), getSessionNum: vi.fn() },
    wsBridge: {
      getSession: vi.fn(() => null),
      getSyncedProjectionController: () => ({ closeLeaderThreadTab }),
      broadcastToSession: vi.fn(),
      broadcastGlobal: vi.fn(),
      closeSession: vi.fn(),
    },
    sessionStore: {},
    worktreeTracker: {},
    terminalManager: {},
    prPoller: undefined,
    imageStore: undefined,
    timerManager: undefined,
    resolveId: vi.fn((raw: string) => (raw === "leader" || raw === "2851" ? "leader" : null)),
    authenticateTakodeCaller: vi.fn(),
    authenticateCompanionCallerOptional: vi.fn(() => null),
    execAsync: vi.fn(),
    execCaptureStdoutAsync: vi.fn(),
    pathExists: vi.fn(async () => false),
    ROUTES_DIR: "/repo/web/server/routes",
    WEB_DIR: "/repo/web",
    buildOrchestratorSystemPrompt: vi.fn(() => ""),
    resolveInitialModeState: vi.fn(() => ({ permissionMode: "default", askPermission: false, uiMode: "agent" })),
  } as any;
  const app = new Hono();
  app.route("/api", createSessionsRoutes(ctx));
  return { app, closeLeaderThreadTab };
}

const close = (app: Hono, session = "2851", thread = "q-12") =>
  app.request(`/api/sessions/${session}/leader-thread-tabs/${thread}/close`, { method: "POST" });

describe("POST /api/sessions/:id/leader-thread-tabs/:threadKey/close", () => {
  it("asks the server to close a leader's tab, resolving the session reference", async () => {
    // Attention lists close tabs of leaders the browser is not viewing through this route.
    const { app, closeLeaderThreadTab } = makeRoute("closed");
    const response = await close(app);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, closed: true });
    expect(closeLeaderThreadTab).toHaveBeenCalledWith("leader", "q-12");
  });

  it("refuses an active tab and unknown sessions, and treats an already closed tab as done", async () => {
    expect((await close(makeRoute("not-closable").app)).status).toBe(409);
    expect((await close(makeRoute("not-found").app)).status).toBe(404);
    expect((await close(makeRoute("closed").app, "nope")).status).toBe(404);
    const notOpen = await close(makeRoute("not-open").app);
    expect(notOpen.status).toBe(200);
    expect(await notOpen.json()).toEqual({ ok: true, closed: false });
  });
});
