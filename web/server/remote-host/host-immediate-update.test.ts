import type { CoordinatorToHost } from "../../shared/host-protocol.js";
import { HostAgent } from "./host-agent.js";
import {
  HOST_IMMEDIATE_UPDATE_SETTLE_MS,
  HOST_UPDATE_RESTART_TIMEOUT_MS,
  HostLinkManager,
} from "./host-link-manager.js";
import type { HostUpdateMode } from "./host-update-sessions.js";
import { FakeHostLink } from "../test-fixtures/fake-host-link.js";

const COORDINATOR_BUILD = "c".repeat(40);
const HOST_BUILD = "a".repeat(40);

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/**
 * Host updates right after the user's Restart Server: the coordinator updates
 * an auto-updating host on another build without waiting for its sessions to
 * go idle, holds commands while the node restarts, and says when the node is
 * back (or could not update) so interrupted turns can continue.
 */
describe("immediate host updates after Restart Server", () => {
  const hostId = "host-1";
  let manager: HostLinkManager;
  let agents: HostAgent[] = [];
  let link: FakeHostLink | null = null;
  let clock = 0;
  let modes: HostUpdateMode[] = [];
  let updates: string[] = [];

  function startAgent(options: { build: string; update?: (commit: string) => Promise<void> }): HostAgent {
    const agent = new HostAgent({
      coordinatorUrl: "http://coordinator.test",
      token: "token",
      apiProxyPort: 45_678,
      reconnectDelayMs: 20,
      log: () => {},
      connect: () => {
        link = new FakeHostLink(manager, hostId);
        return link.agentSide;
      },
      update: options.update ?? (async (commit) => void updates.push(commit)),
      build: options.build,
    });
    agents.push(agent);
    agent.start();
    return agent;
  }

  function tick(elapsedMs: number): void {
    clock += elapsedMs;
    manager.handleMessage(hostId, link!.coordinatorSide, JSON.stringify({ t: "heartbeat" }));
    (manager as unknown as { tick(): void }).tick();
  }

  /** Every message the coordinator sends the current link from now on. */
  function recordSent(): () => CoordinatorToHost[] {
    const current = link!;
    const from = current.sentToHost.length;
    return () => current.sentToHost.slice(from);
  }

  beforeEach(() => {
    clock = 1_000_000;
    modes = [];
    updates = [];
    manager = new HostLinkManager({ build: COORDINATOR_BUILD, now: () => clock });
    manager.immediateUpdates = true;
    // Sessions are "in turns": a non-immediate update would wait.
    manager.updateBlocker = (_host, mode) => {
      modes.push(mode);
      return mode === "immediate" ? null : "its sessions finish their turns";
    };
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    for (const agent of agents) agent.stop();
    agents = [];
    vi.restoreAllMocks();
  });

  // The update goes out after a short settle even though sessions are in
  // turns; afterwards the host reports which update it is waiting for.
  it("updates a busy host shortly after it connects", async () => {
    startAgent({ build: HOST_BUILD });
    await waitFor(() => manager.status(hostId).online);
    expect(manager.status(hostId).updateWaitingFor).toBeNull();

    tick(HOST_IMMEDIATE_UPDATE_SETTLE_MS - 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(updates).toEqual([]);

    tick(1);
    await waitFor(() => updates.length === 1);
    expect(updates).toEqual([COORDINATOR_BUILD]);
    expect(modes).toContain("immediate");
    expect(modes).not.toContain("when_idle");
  });

  // The immediate update is a one-off for this coordinator: a host that comes
  // back on another build again (say restarted by hand) waits for idle.
  it("updates each host immediately only once", async () => {
    const restarted: string[] = [];
    manager.onHostRestarted = (host) => restarted.push(host);
    const first = startAgent({ build: HOST_BUILD });
    await waitFor(() => manager.status(hostId).online);
    tick(HOST_IMMEDIATE_UPDATE_SETTLE_MS);
    await waitFor(() => updates.length === 1);

    first.stop();
    await waitFor(() => !manager.status(hostId).online);
    startAgent({ build: HOST_BUILD });
    await waitFor(() => manager.status(hostId).online);
    // The node restarted: interrupted turns may go on.
    expect(restarted).toEqual([hostId]);
    expect(manager.status(hostId).updateWaitingFor).toBe("its sessions finish their turns");

    tick(60 * 60_000);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(updates).toHaveLength(1);
  });

  // Getting the sessions ready can call the update off (a landing run began);
  // nothing is sent and a later tick tries again.
  it("tries again when the sessions could not be got ready", async () => {
    let ready = false;
    manager.prepareHostUpdate = async () => ready;
    startAgent({ build: HOST_BUILD });
    await waitFor(() => manager.status(hostId).online);

    tick(HOST_IMMEDIATE_UPDATE_SETTLE_MS);
    await waitFor(() => !manager.status(hostId).updating);
    expect(updates).toEqual([]);

    ready = true;
    tick(1);
    await waitFor(() => updates.length === 1);
  });

  // A session relaunched while the node is restarting would start on the old
  // node and end with it, so its spawn waits for the new instance.
  it("holds commands while the node restarts and sends them to its next instance", async () => {
    const old = startAgent({ build: HOST_BUILD });
    await waitFor(() => manager.status(hostId).online);
    tick(HOST_IMMEDIATE_UPDATE_SETTLE_MS);
    await waitFor(() => updates.length === 1);

    const sent = recordSent();
    const proc = manager.spawn(hostId, {
      command: process.execPath,
      args: ["-e", "process.stdout.write('new build')"],
      env: {},
    });
    let output = "";
    proc.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(sent().filter((message) => message.t === "command")).toEqual([]);
    // Nor is a Codex launch prepared on the instance that is about to end.
    await expect(
      manager.request(hostId, { kind: "prepare_codex", sessionId: "s1", info: {}, options: {} }, 1_000),
    ).rejects.toThrow(/restarting for an update/);

    old.stop();
    await waitFor(() => !manager.status(hostId).online);
    startAgent({ build: COORDINATOR_BUILD });
    await waitFor(() => output === "new build");
    expect(manager.status(hostId)).toMatchObject({ buildMismatch: false, updating: false });
  });

  // A failed update leaves the node running its build: what waited is sent
  // to it, and the interrupted turns go on there.
  it("releases held commands when the update fails", async () => {
    const restarted: string[] = [];
    manager.onHostRestarted = (host) => restarted.push(host);
    let failUpdate = (_error: Error) => {};
    startAgent({
      build: HOST_BUILD,
      update: () => new Promise<void>((_resolve, reject) => (failUpdate = reject)),
    });
    await waitFor(() => manager.status(hostId).online);
    tick(HOST_IMMEDIATE_UPDATE_SETTLE_MS);
    await waitFor(() => manager.status(hostId).updating);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const proc = manager.spawn(hostId, {
      command: process.execPath,
      args: ["-e", "process.stdout.write('old build')"],
      env: {},
    });
    let output = "";
    proc.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    failUpdate(new Error("The Takode checkout has uncommitted changes"));

    await waitFor(() => output === "old build");
    expect(restarted).toEqual([hostId]);
    expect(manager.status(hostId).updateError).toBe("The Takode checkout has uncommitted changes");
  });

  /** Start a process on the host that prints `text`, and collect its output. */
  function spawnPrinting(text: string): { output: () => string } {
    const proc = manager.spawn(hostId, {
      command: process.execPath,
      args: ["-e", `process.stdout.write(${JSON.stringify(text)})`],
      env: {},
    });
    let output = "";
    proc.stdout.on("data", (chunk: Buffer) => (output += chunk.toString()));
    return { output: () => output };
  }

  // The incident behind this test: the node was asked to update, its link
  // dropped, the update failed while it was down (so the node's report went
  // nowhere), and the same node reconnected on its old build. Everything
  // started there waited for a restart that never came, so creating a session
  // there hung. The coordinator now asks the reconnected node again; its
  // second attempt reports on the live link, which releases what was held.
  it("recovers when the node's update failure was lost while the link was down", async () => {
    const restarted: string[] = [];
    manager.onHostRestarted = (host) => restarted.push(host);
    const attempts: Array<(error: Error) => void> = [];
    startAgent({
      build: HOST_BUILD,
      update: () => new Promise<void>((_resolve, reject) => attempts.push(reject)),
    });
    await waitFor(() => manager.status(hostId).online);
    tick(HOST_IMMEDIATE_UPDATE_SETTLE_MS);
    await waitFor(() => attempts.length === 1);

    link!.drop();
    attempts[0]!(new Error("Could not fetch: network is unreachable"));
    await waitFor(() => manager.status(hostId).online);
    expect(manager.startBlocker(hostId)).toMatch(/restarting for a Takode update/);
    const proc = spawnPrinting("old build");

    await waitFor(() => attempts.length === 2);
    attempts[1]!(new Error("The Takode checkout has uncommitted changes"));
    await waitFor(() => proc.output() === "old build");
    expect(manager.status(hostId).updateError).toBe("The Takode checkout has uncommitted changes");
    expect(manager.startBlocker(hostId)).toBeNull();
    expect(restarted).toEqual([hostId]);
  });

  // A node whose update is still running when its link comes back ignores the
  // repeated request instead of starting a second update.
  it("does not start a second update on a node that is still updating", async () => {
    const attempts: Array<() => void> = [];
    startAgent({ build: HOST_BUILD, update: () => new Promise<void>((resolve) => attempts.push(resolve)) });
    await waitFor(() => manager.status(hostId).online);
    tick(HOST_IMMEDIATE_UPDATE_SETTLE_MS);
    await waitFor(() => attempts.length === 1);

    link!.drop();
    await waitFor(() => manager.status(hostId).online);
    await waitFor(() => link!.sentToHost.some((message) => message.t === "update"));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(attempts).toHaveLength(1);
    expect(manager.status(hostId).updating).toBe(true);
  });

  // An update that never brings the node back, such as a fetch that hangs,
  // must not hold the host's commands forever: after the deadline the update
  // counts as failed and they run on the node's current build.
  it("gives up on an update that never brings the node back", async () => {
    const restarted: string[] = [];
    manager.onHostRestarted = (host) => restarted.push(host);
    startAgent({ build: HOST_BUILD, update: () => new Promise<void>(() => {}) });
    await waitFor(() => manager.status(hostId).online);
    tick(HOST_IMMEDIATE_UPDATE_SETTLE_MS);
    await waitFor(() => manager.status(hostId).updating);
    await new Promise((resolve) => setTimeout(resolve, 30));

    const proc = spawnPrinting("old build");
    tick(HOST_UPDATE_RESTART_TIMEOUT_MS - 1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(proc.output()).toBe("");

    tick(2);
    await waitFor(() => proc.output() === "old build");
    expect(manager.status(hostId).updateError).toMatch(/did not come back on the new build/);
    expect(restarted).toEqual([hostId]);
    // Not asked again until the node restarts.
    tick(HOST_IMMEDIATE_UPDATE_SETTLE_MS);
    expect(manager.status(hostId).updating).toBe(false);
  });

  // Session creation asks first whether the host can start a process now.
  it("says why a new process cannot start on the host", async () => {
    expect(manager.startBlocker(hostId)).toBe("is offline");
    const agent = startAgent({ build: HOST_BUILD, update: () => new Promise<void>(() => {}) });
    await waitFor(() => manager.status(hostId).online);
    expect(manager.startBlocker(hostId)).toBeNull();
    tick(HOST_IMMEDIATE_UPDATE_SETTLE_MS);
    await waitFor(() => manager.startBlocker(hostId) !== null);
    expect(manager.startBlocker(hostId)).toMatch(/restarting for a Takode update/);
    agent.stop();
    await waitFor(() => !manager.status(hostId).online);
    expect(manager.startBlocker(hostId)).toBe("is offline");
  });
});
