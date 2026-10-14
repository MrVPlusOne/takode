import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostLinkManager } from "./host-link-manager.js";
import { HostRegistry, LOCAL_HOST_ID } from "./host-registry.js";
import { LocalNode, localCoordinatorUrl } from "./local-node.js";

/**
 * LocalNode keeps this machine's node in line with its setting. These tests
 * replace the process side (start, recognize, signal) and the link status, and
 * drive the clock, so each decision is checked without running a node.
 */
describe("LocalNode", () => {
  let dir: string;
  let registry: HostRegistry;
  let now: number;
  let link: { online: boolean; processes: number; released: string[] };
  let running: Set<number>;
  let started: string[][];
  let signals: Array<[number, string]>;
  let nextPid: number;
  let node: LocalNode;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "local-node-"));
    registry = new HostRegistry(join(dir, "hosts", "server-1.json"));
    now = 1_000_000;
    link = { online: false, processes: 0, released: [] };
    running = new Set();
    started = [];
    signals = [];
    nextPid = 500;
    const links = {
      status: () => ({
        hostId: LOCAL_HOST_ID,
        online: link.online,
        processes: link.processes,
      }),
      release: (_hostId: string, reason: string) => link.released.push(reason),
      onStatusChange: () => () => {},
    } as unknown as HostLinkManager;
    node = new LocalNode({
      serverId: "server-1",
      coordinatorUrl: "http://127.0.0.1:3456",
      nodeScript: "/takode/web/bin/takode-node.ts",
      registry,
      links,
      companionDir: dir,
      now: () => now,
      log: () => {},
      startProcess: async (args) => {
        started.push(args);
        running.add(nextPid);
        return nextPid++;
      },
      isNodeProcess: async (pid) => running.has(pid),
      signal: (pid, signal) => {
        signals.push([pid, signal]);
        running.delete(pid);
      },
    });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // The first check starts the node with a token only it and this server know.
  // Sessions start under it from then on: launched before it connects, their
  // processes start when it does.
  it("starts the node with a private token the registry accepts", async () => {
    expect(node.ready()).toBe(false);
    await node.check();
    const tokenFile = join(dir, "hosts", "server-1-local-node.token");
    expect(started).toEqual([
      [
        "/takode/web/bin/takode-node.ts",
        "--coordinator",
        "http://127.0.0.1:3456",
        "--token-file",
        tokenFile,
        "--shared-checkout",
        "--allow-insecure",
      ],
    ]);
    expect((await stat(tokenFile)).mode & 0o777).toBe(0o600);
    expect(await registry.authenticate((await readFile(tokenFile, "utf-8")).trim())).toMatchObject({
      id: LOCAL_HOST_ID,
    });
    expect(node.ready()).toBe(true);
    link.online = true;
    expect(node.ready()).toBe(true);
  });

  // A server that starts while its node is still running (it outlived the
  // previous server) lets it reconnect, and keeps its token. A node that does
  // not connect within the grace period is replaced, and processes waiting
  // for it are released.
  it("waits for a running node to reconnect and replaces one that never does", async () => {
    await node.check();
    const token = await readFile(join(dir, "hosts", "server-1-local-node.token"), "utf-8");
    await node.check();
    now += 10_000;
    await node.check();
    expect(started).toHaveLength(1);
    expect(signals).toEqual([]);

    expect(node.ready()).toBe(true);

    now += 30_000;
    await node.check();
    expect(signals).toEqual([[500, "SIGTERM"]]);
    expect(link.released).toEqual(["This machine's node is not running"]);
    expect(started).toHaveLength(2);
    expect(await readFile(join(dir, "hosts", "server-1-local-node.token"), "utf-8")).toBe(token);
    // Released sessions start again directly rather than waiting on another node that may not come.
    expect(node.ready()).toBe(false);

    // The replacement gets its own grace period.
    now += 10_000;
    await node.check();
    expect(started).toHaveLength(2);

    // Once a node connects, sessions start under it again.
    link.online = true;
    await node.check();
    expect(node.ready()).toBe(true);
  });

  // A node that exited (to update, or a crash) is started again at once.
  it("starts a new node when the old one is gone", async () => {
    await node.check();
    running.clear();
    await node.check();
    expect(started).toHaveLength(2);
    expect(link.released).toEqual([]);
  });

  // There is no off mode: a connected node stays, also while it runs no
  // sessions, and nothing waiting for it is released.
  it("keeps a connected node running even when it runs no sessions", async () => {
    await node.check();
    link.online = true;
    link.processes = 0;
    await node.check();
    now += 60_000;
    await node.check();
    expect(node.ready()).toBe(true);
    expect(started).toHaveLength(1);
    expect(signals).toEqual([]);
    expect(link.released).toEqual([]);
  });

  // A server stop ends the node, and nothing starts it again while the server
  // finishes stopping, even though the node now shows as gone.
  it("ends the node when the server stops and does not start another", async () => {
    await node.check();
    link.online = true;
    await node.shutdown();
    expect(signals).toEqual([[500, "SIGTERM"]]);

    link.online = false;
    await node.check();
    expect(started).toHaveLength(1);
  });

  // A restarting server stops listening, so its node cannot stay connected.
  // Replacing the node then would end the sessions the next server is to take
  // over, so once supervision stops nothing replaces or starts a node.
  it("leaves a disconnected node alone once supervision stops for a restart", async () => {
    await node.check();
    link.online = true;
    await node.check();
    node.stop();

    link.online = false;
    await node.check();
    now += 60_000;
    await node.check();
    expect(signals).toEqual([]);
    expect(link.released).toEqual([]);
    expect(started).toHaveLength(1);
  });

  // The node reaches this server on an address of this machine.
  it("builds the URL a node on this machine connects to", () => {
    expect(localCoordinatorUrl("0.0.0.0", 3456)).toBe("http://127.0.0.1:3456");
    expect(localCoordinatorUrl("::", 3456)).toBe("http://127.0.0.1:3456");
    expect(localCoordinatorUrl("100.64.0.7", 3456)).toBe("http://100.64.0.7:3456");
    expect(localCoordinatorUrl("fd00::7", 3456)).toBe("http://[fd00::7]:3456");
  });
});
