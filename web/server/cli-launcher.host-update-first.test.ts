import { vi } from "vitest";

// Capture what the launcher hands the Claude adapter instead of running Claude.
// Each adapter launch is one load of the session's history by a backend.
const sdkAdapterLaunches = vi.hoisted(() => [] as Array<{ sessionId: string; options: any }>);
vi.mock("./claude-sdk-adapter.js", () => ({
  ClaudeSdkAdapter: class {
    started = Promise.resolve(true);
    constructor(sessionId: string, options: any) {
      sdkAdapterLaunches.push({ sessionId, options });
    }
  },
}));

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CliLauncher } from "./cli-launcher.js";
import { SessionStore } from "./session-store.js";
import { HostAgent } from "./remote-host/host-agent.js";
import { HostLinkManager, type RemoteProcess } from "./remote-host/host-link-manager.js";
import { LOCAL_HOST_ID, type HostRegistry } from "./remote-host/host-registry.js";
import { HostUpdateSessions } from "./remote-host/host-update-sessions.js";
import { FakeHostLink } from "./test-fixtures/fake-host-link.js";

/** Stands in for a session's backend process: echoes stdin in upper case. */
const ECHO_PROGRAM = "process.stdin.on('data', (chunk) => process.stdout.write(String(chunk).toUpperCase()));";
const OLD_BUILD = "a".repeat(40);
const NEW_BUILD = "c".repeat(40);

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function readLine(proc: RemoteProcess): Promise<string> {
  return new Promise((resolve) => proc.stdout.once("data", (chunk: Buffer) => resolve(chunk.toString("utf-8"))));
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * After Restart Server onto new code, this machine's node still runs the old
 * build and the sessions' processes. The restarted server used to take those
 * processes over (each session loading its history), then update the node,
 * which ended them, so the sessions loaded their histories a second time. Now
 * the node is updated first: nothing is taken over on the old build, and each
 * session starts once, on the new one.
 */
describe("updating this machine's node before restoring its sessions", () => {
  let tempDir: string;
  let store: SessionStore;
  let manager: HostLinkManager;
  let agents: HostAgent[];
  let link: FakeHostLink | null;
  let updates: string[];
  let stoppedHosts: string[];

  /** A node on `build` that records the update it is asked for; the test restarts it. */
  function startNode(build: string): HostAgent {
    const agent = new HostAgent({
      coordinatorUrl: "http://127.0.0.1:3456",
      token: "token",
      apiProxyPort: 45_678,
      reconnectDelayMs: 20,
      log: () => {},
      connect: () => {
        link = new FakeHostLink(manager, LOCAL_HOST_ID);
        return link.agentSide;
      },
      build,
      update: async (commit) => void updates.push(commit),
    });
    agents.push(agent);
    agent.start();
    return agent;
  }

  beforeEach(() => {
    sdkAdapterLaunches.length = 0;
    tempDir = mkdtempSync(join(tmpdir(), "host-update-first-test-"));
    store = new SessionStore(tempDir);
    manager = new HostLinkManager({ build: OLD_BUILD });
    agents = [];
    link = null;
    updates = [];
    stoppedHosts = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const agent of agents) agent.stop();
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  /**
   * The old server's session process running under the node, then a server
   * restarted by Restart Server onto NEW_BUILD, wired as `index.ts` wires it.
   * The node reconnects to it once `link.drop()` is called.
   */
  async function restartServerOntoNewBuild() {
    const node = startNode(OLD_BUILD);
    await waitFor(() => manager.status(LOCAL_HOST_ID).online);
    const original = manager.spawn(LOCAL_HOST_ID, { command: process.execPath, args: ["-e", ECHO_PROGRAM], env: {} });
    await waitFor(() => original.started && original.pid !== undefined);
    store.saveLauncher([
      {
        sessionId: "s-1",
        hostProcId: original.procId,
        state: "connected",
        backendType: "claude-sdk",
        cliSessionId: "claude-conversation",
        cwd: tempDir,
        createdAt: Date.now(),
      },
    ]);
    await store.flushAll();

    manager = new HostLinkManager({ build: NEW_BUILD });
    manager.immediateUpdates = true;
    const launcher = new CliLauncher(3456, { serverId: "test-server-id" });
    launcher.setStore(store);
    launcher.setRemoteHosts({ registry: {} as HostRegistry, links: manager, useLocalNode: () => true });
    await launcher.restoreFromDisk();
    const sessions = new HostUpdateSessions({
      sessions: () => launcher.listSessions(),
      awaitingReattach: (sessionId) => launcher.isAwaitingHostReattach(sessionId),
      bridgeSession: () => undefined,
      coordinatorStartedAt: Date.now(),
      landingRunOn: () => false,
      testRunHolders: () => [],
      interrupt: async () => {},
      holdHerdEvents: () => {},
      stopSessions: async (hostId) => void stoppedHosts.push(hostId),
      continueSession: () => {},
    });
    manager.updateBlocker = (hostId, mode, timing) => sessions.blocker(hostId, mode, timing);
    manager.prepareHostUpdate = (hostId, mode) => sessions.prepare(hostId, mode);
    const ended: string[] = [];
    launcher.onLeftoverProcessEndedCallback((sessionId) => ended.push(sessionId));
    return { launcher, node, original, ended };
  }

  /** The node restarts onto the new build, as `takode node` does after switching its checkout. */
  async function restartNode(node: HostAgent): Promise<void> {
    await node.stop();
    startNode(NEW_BUILD);
    await waitFor(() => manager.status(LOCAL_HOST_ID).online && !manager.status(LOCAL_HOST_ID).buildMismatch);
  }

  it("updates the node before taking over its processes, so each session loads its history once", async () => {
    const { launcher, node, original, ended } = await restartServerOntoNewBuild();
    expect(launcher.isAwaitingHostReattach("s-1")).toBe(true);

    link!.drop();
    await waitFor(() => updates.length === 1);
    expect(updates).toEqual([NEW_BUILD]);
    // Nothing used the old build: no takeover, and no sessions to stop for the update.
    expect(manager.updatesFirst(LOCAL_HOST_ID)).toBe(true);
    expect(sdkAdapterLaunches).toHaveLength(0);
    expect(stoppedHosts).toEqual([]);
    expect(launcher.isAwaitingHostReattach("s-1")).toBe(true);

    // The update ends the old process; the session is stopped like an idle one.
    await restartNode(node);
    await waitFor(() => launcher.getSession("s-1")?.state === "exited");
    expect(isRunning(original.pid!)).toBe(false);
    expect(ended).toEqual(["s-1"]);
    expect(launcher.isAwaitingHostReattach("s-1")).toBe(false);
    expect(sdkAdapterLaunches).toHaveLength(0);

    // Its next start is its only one, on the new build.
    await launcher.relaunch("s-1");
    expect(sdkAdapterLaunches).toHaveLength(1);
    const { options } = sdkAdapterLaunches[0]!;
    expect(options.reattach).toBeFalsy();
    const proc = options.spawnProcess({
      command: process.execPath,
      args: ["-e", ECHO_PROGRAM],
      env: { PATH: process.env.PATH },
      signal: new AbortController().signal,
    });
    const line = readLine(proc);
    proc.stdin.write("new build\n");
    expect(await line).toBe("NEW BUILD\n");
    proc.kill("SIGTERM");
  });

  // A session can be woken while its node is about to update (a browser opens
  // it). It does not take over the old process, which the update ends anyway;
  // it starts a new one, which waits for the node's next instance.
  it("starts a session woken during the update on the node's new build", async () => {
    const { launcher, node, original } = await restartServerOntoNewBuild();
    link!.drop();
    await waitFor(() => updates.length === 1);

    await launcher.relaunch("s-1");
    expect(sdkAdapterLaunches).toHaveLength(1);
    const { options } = sdkAdapterLaunches[0]!;
    expect(options.reattach).toBeFalsy();
    const proc = options.spawnProcess({
      command: process.execPath,
      args: ["-e", ECHO_PROGRAM],
      env: { PATH: process.env.PATH },
      signal: new AbortController().signal,
    });
    expect(proc.procId).not.toBe(original.procId);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(proc.started).toBe(false);

    await restartNode(node);
    await waitFor(() => proc.started);
    const line = readLine(proc);
    proc.stdin.write("started once\n");
    expect(await line).toBe("STARTED ONCE\n");
    expect(isRunning(original.pid!)).toBe(false);
    proc.kill("SIGTERM");
  });

  // An update that cannot go first (here it fails on the node) leaves the node
  // on its build: the sessions then take over their processes there as before.
  it("takes the processes over after all when the node does not update", async () => {
    const { launcher, original } = await restartServerOntoNewBuild();
    link!.drop();
    await waitFor(() => updates.length === 1);
    manager.handleMessage(
      LOCAL_HOST_ID,
      link!.coordinatorSide,
      JSON.stringify({ t: "update_failed", commit: NEW_BUILD, error: "The checkout has uncommitted changes" }),
    );

    await waitFor(() => sdkAdapterLaunches.length === 1);
    expect(manager.updatesFirst(LOCAL_HOST_ID)).toBe(false);
    const { options } = sdkAdapterLaunches[0]!;
    expect(options.reattach).toBe(true);
    const proc = options.spawnProcess({ command: "claude", args: [], env: {}, signal: new AbortController().signal });
    expect(proc.procId).toBe(original.procId);
    const line = readLine(proc);
    proc.stdin.write("still running\n");
    expect(await line).toBe("STILL RUNNING\n");
    await waitFor(() => launcher.getSession("s-1")?.state === "connected");
    proc.kill("SIGTERM");
  });
});
