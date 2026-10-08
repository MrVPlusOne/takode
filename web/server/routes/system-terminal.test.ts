import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HostLinkManager } from "../remote-host/host-link-manager.js";
import { configureRemoteMachines } from "../remote-host/session-machine.js";
import { createSystemRoutes } from "./system.js";
import type { RouteContext } from "./context.js";

function createTestApp(sessions: Record<string, { host_id?: string }>, spawn: ReturnType<typeof vi.fn>): Hono {
  const app = new Hono();
  app.route(
    "/api",
    createSystemRoutes({
      launcher: { getPort: () => 3456 },
      wsBridge: { getSession: (id: string) => (sessions[id] ? { state: sessions[id] } : undefined) },
      sessionStore: {},
      worktreeTracker: {},
      terminalManager: { spawn, getInfo: () => null, kill: () => {} },
      resolveId: (raw: string) => raw,
      authenticateTakodeCaller: () => ({ response: new Response(null, { status: 401 }) }),
      authenticateCompanionCallerOptional: () => null,
      execAsync: async () => "",
      execCaptureStdoutAsync: async () => "",
      pathExists: async () => false,
      ROUTES_DIR: "/tmp",
      WEB_DIR: "/tmp",
      buildOrchestratorSystemPrompt: () => "",
      resolveInitialModeState: () => ({ permissionMode: "default", askPermission: false, uiMode: "agent" }),
    } as unknown as RouteContext),
  );
  return app;
}

function spawnRequest(body: object) {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("terminal spawn route", () => {
  afterEach(() => configureRemoteMachines(null));

  // A session's terminal opens on the machine holding its files: the route
  // passes the session's host to the terminal manager.
  it("opens a remote session's terminal on its host", async () => {
    const links = new HostLinkManager();
    vi.spyOn(links, "status").mockReturnValue({ hostId: "host-1", online: true, lastSeenAt: 1, processes: 0 });
    const request = vi.spyOn(links, "request").mockResolvedValue({
      kind: "stat",
      stat: { size: 0, isFile: false, isDirectory: true, mtimeMs: 0 },
    });
    configureRemoteMachines(links);
    const spawn = vi.fn(() => "terminal-1");
    const app = createTestApp({ remote: { host_id: "host-1" }, local: {} }, spawn);

    const remote = await app.request("/api/terminal/spawn", spawnRequest({ cwd: "/work", sessionId: "remote" }));
    expect(await remote.json()).toEqual({ terminalId: "terminal-1" });
    expect(spawn).toHaveBeenLastCalledWith("remote", "/work", undefined, undefined, "host-1");

    expect(request).toHaveBeenCalledWith("host-1", { kind: "stat", path: "/work" }, expect.any(Number));

    await app.request("/api/terminal/spawn", spawnRequest({ cwd: "/here", sessionId: "local" }));
    expect(spawn).toHaveBeenLastCalledWith("local", "/here", undefined, undefined, undefined);
  });

  // A shell that cannot start on the host would exit before the browser
  // attaches, so the route checks the host folder and reports the problem itself.
  it("reports a folder missing on the session's host", async () => {
    const links = new HostLinkManager();
    vi.spyOn(links, "status").mockReturnValue({ hostId: "host-1", online: true, lastSeenAt: 1, processes: 0 });
    vi.spyOn(links, "request").mockResolvedValue({ kind: "stat", stat: null });
    configureRemoteMachines(links);
    const spawn = vi.fn();
    const app = createTestApp({ remote: { host_id: "host-1" } }, spawn);

    const response = await app.request("/api/terminal/spawn", spawnRequest({ cwd: "/gone", sessionId: "remote" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("does not exist on the session's host");
    expect(spawn).not.toHaveBeenCalled();
  });

  // An interactive shell that would only start when the host returns is
  // confusing, so an offline host is reported instead of queueing the start.
  it("refuses while the session's host is offline", async () => {
    configureRemoteMachines(new HostLinkManager());
    const spawn = vi.fn();
    const app = createTestApp({ remote: { host_id: "host-1" } }, spawn);

    const response = await app.request("/api/terminal/spawn", spawnRequest({ cwd: "/work", sessionId: "remote" }));
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain("host is offline");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("reports a folder the shell cannot start in", async () => {
    const spawn = vi.fn(() => {
      throw new Error("Cannot open a terminal in /gone: the folder does not exist or is not accessible");
    });
    const app = createTestApp({}, spawn);

    const response = await app.request("/api/terminal/spawn", spawnRequest({ cwd: "/gone" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Cannot open a terminal in /gone");
  });
});
