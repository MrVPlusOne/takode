import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { ResourceLeaseManager } from "../server/resource-lease-manager.js";
import { ResourceLeaseStore } from "../server/resource-lease-store.js";
import { createResourceLeaseRoutes } from "../server/routes/resource-leases.js";
import { validateCompanionAuth } from "../server/routes/auth.js";

/**
 * `takode lease run` end to end: the real CLI process against the real lease
 * routes and manager on a local port. It waits quietly while the pool is full,
 * runs the command with its slot, passes the exit code through and gives the
 * slot back.
 */
describe("takode lease run", () => {
  let directory: string;
  let manager: ResourceLeaseManager;
  let server: ReturnType<typeof Bun.serve>;
  const injected: string[] = [];

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "lease-run-"));
    manager = new ResourceLeaseManager(
      { injectUserMessage: (_id, text) => (injected.push(text), "sent"), invalidateSessionNavigation: () => {} },
      new ResourceLeaseStore("test", directory),
    );
    await manager.startAll();
    const launcher = {
      getSession: (sessionId: string) => ({ sessionId }),
      getSessionNum: () => undefined,
      verifySessionAuthToken: (sessionId: string, token: string) => token === `token-${sessionId}`,
    };
    const app = new Hono();
    app.get("/api/takode/me", (c) => c.json({ sessionId: "worker", isOrchestrator: false }));
    app.route(
      "/api",
      createResourceLeaseRoutes({
        resourceLeaseManager: manager,
        launcher,
        wsBridge: { getSession: () => undefined },
        authenticateTakodeCaller: (c: any) => validateCompanionAuth(c, launcher as any, (id) => id, { required: true }),
      } as any),
    );
    server = Bun.serve({ port: 0, fetch: app.fetch });
  });

  afterEach(() => {
    server.stop(true);
    manager.destroy();
    rmSync(directory, { recursive: true, force: true });
  });

  function runCli(args: string[]) {
    const takodePath = fileURLToPath(new URL("./takode.ts", import.meta.url));
    const child = spawn(process.execPath, [takodePath, "lease", "run", ...args], {
      env: { ...process.env, COMPANION_SESSION_ID: "worker", COMPANION_AUTH_TOKEN: "token-worker" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    return {
      done: once(child, "close").then(([code]) => ({ code: code as number, stdout, stderr })),
      stderr: () => stderr,
    };
  }

  it("waits for a slot, runs the command with it, passes its exit code and frees the slot", async () => {
    await manager.configure("checks", 1);
    await manager.hold({ resourceKeys: ["checks"], holderId: "run:other", callerSessionId: "other", purpose: "busy" });
    const cli = runCli(["checks", "--port", String(server.port), "--", 'echo "slot=$TAKODE_LEASE_SLOT"; exit 3']);
    // It is in line, quietly: no message to the session, only a note on its own stderr.
    const deadline = Date.now() + 10_000;
    while ((await manager.getStatus("checks")).waiters.length === 0) {
      if (Date.now() > deadline) throw new Error(`never queued: ${cli.stderr()}`);
      await Bun.sleep(20);
    }
    await manager.releaseHold("run:other");
    const result = await cli.done;
    expect(result).toMatchObject({ code: 3, stdout: "slot=1\n" });
    expect(result.stderr).toContain("waiting for a slot of checks (place 1 in line)");
    expect(await manager.getStatus("checks")).toMatchObject({ leases: [], waiters: [] });
    expect(injected).toEqual([]);
  });

  // Nesting is allowed but warned about: a command holding a slot that starts
  // another command waiting for the same pool can deadlock once outer commands
  // hold every slot. Here the outer command really runs the inner CLI, which
  // finds the outer slot in its environment, warns, and still runs.
  it("warns when a command holding a slot asks for another, and still runs it", async () => {
    await manager.configure("checks", 2);
    const takodePath = fileURLToPath(new URL("./takode.ts", import.meta.url));
    const inner = `${process.execPath} ${takodePath} lease run checks --port ${server.port} -- echo inner`;
    const result = await runCli(["checks", "--port", String(server.port), "--", inner]).done;
    expect(result).toMatchObject({ code: 0, stdout: "inner\n" });
    expect(result.stderr).toContain(
      "Warning: this command already runs inside slot 1 of checks and now waits for a slot of checks",
    );
    expect(await manager.getStatus("checks")).toMatchObject({ leases: [], waiters: [] });
  });

  // Several arguments run as a program and its arguments, without a shell.
  it("runs several arguments as a program without a shell", async () => {
    const result = await runCli(["checks", "--port", String(server.port), "--", "printf", "%s|", "a b", "$HOME"]).done;
    expect(result).toMatchObject({ code: 0, stdout: "a b|$HOME|" });
  });
});
