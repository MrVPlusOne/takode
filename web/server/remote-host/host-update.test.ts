import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HostAgent } from "./host-agent.js";
import { HOST_UPDATE_SETTLE_MS, HostLinkManager } from "./host-link-manager.js";
import { hostCanRestart, type BridgeTurnView } from "./host-restart-gate.js";
import { readCheckoutCommit, switchCheckoutToCommit } from "./host-update.js";
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

describe("host builds and auto-update over the link", () => {
  const hostId = "host-1";
  let manager: HostLinkManager;
  let agent: HostAgent | null = null;
  let link: FakeHostLink | null = null;
  let clock = 0;

  function startAgent(options: { build?: string | null; update?: (commit: string) => Promise<void> }): HostAgent {
    const started = new HostAgent({
      coordinatorUrl: "http://coordinator.test",
      token: "token",
      apiProxyPort: 45_678,
      reconnectDelayMs: 20,
      log: () => {},
      connect: () => {
        link = new FakeHostLink(manager, hostId);
        return link.agentSide;
      },
      ...options,
    });
    started.start();
    return started;
  }

  /** Let `elapsedMs` pass (by default the settle time), then run the coordinator's heartbeat tick. */
  function tick(elapsedMs = HOST_UPDATE_SETTLE_MS): void {
    clock += elapsedMs;
    // The host's own heartbeat keeps the link from counting as stale.
    manager.handleMessage(hostId, link!.coordinatorSide, JSON.stringify({ t: "heartbeat" }));
    (manager as unknown as { tick(): void }).tick();
  }

  beforeEach(() => {
    clock = 1_000_000;
    manager = new HostLinkManager({ build: COORDINATOR_BUILD, now: () => clock });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    agent?.stop();
    agent = null;
    vi.restoreAllMocks();
  });

  // The host reports its commit; the coordinator flags a different one and a
  // missing one (an older node), but not its own.
  it("reports the host build and whether it differs from the coordinator's", async () => {
    agent = startAgent({ build: HOST_BUILD });
    await waitFor(() => manager.status(hostId).online);
    expect(manager.status(hostId)).toMatchObject({ build: HOST_BUILD, buildMismatch: true, autoUpdate: false });
    agent.stop();

    agent = startAgent({ build: COORDINATOR_BUILD });
    await waitFor(() => manager.status(hostId).build === COORDINATOR_BUILD);
    expect(manager.status(hostId).buildMismatch).toBe(false);
    agent.stop();

    agent = startAgent({});
    await waitFor(() => manager.status(hostId).build === null && manager.status(hostId).online);
    expect(manager.status(hostId).buildMismatch).toBe(true);
  });

  // Auto-update is sent only to a host that offered it, only once the restart
  // gate says no turn would end, and only once per host instance.
  it("asks an auto-updating host to switch to the coordinator's commit once it can restart", async () => {
    let idle = false;
    manager.updateBlocker = () => (idle ? null : "its sessions finish their turns");
    const requested: string[] = [];
    agent = startAgent({ build: HOST_BUILD, update: async (commit) => void requested.push(commit) });
    await waitFor(() => manager.status(hostId).online);
    expect(manager.status(hostId)).toMatchObject({ autoUpdate: true, updating: false });
    expect(requested).toEqual([]);

    idle = true;
    tick();
    await waitFor(() => requested.length === 1);
    expect(requested).toEqual([COORDINATOR_BUILD]);
    expect(manager.status(hostId).updating).toBe(true);

    tick();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requested).toHaveLength(1);
  });

  // Right after a coordinator restart the host reconnects and the coordinator
  // takes over or starts its sessions; those can look idle for a moment before
  // they resume a turn or ask again for a permission. The update waits until
  // nothing has started on the host for the settle time.
  it("waits until nothing has started on the host for a while", async () => {
    manager.updateBlocker = () => null;
    const requested: string[] = [];
    agent = startAgent({ build: HOST_BUILD, update: async (commit) => void requested.push(commit) });
    await waitFor(() => manager.status(hostId).online);

    tick(0);
    manager.spawn(hostId, { command: process.execPath, args: ["-e", ""], env: {} });
    tick(HOST_UPDATE_SETTLE_MS - 1);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(requested).toEqual([]);
    expect(manager.status(hostId).updating).toBe(false);

    tick();
    await waitFor(() => requested.length === 1);
  });

  // The restart ends every process on the host. Its sessions are stopped first
  // (as an idle stop would), so they relaunch on their next message instead of
  // reporting a crashed process; only then is the host asked to update.
  it("stops the host's sessions before asking it to update", async () => {
    manager.updateBlocker = () => null;
    const events: string[] = [];
    let finishStopping = () => {};
    manager.prepareHostUpdate = (stoppingHost) => {
      events.push(`stop ${stoppingHost}`);
      return new Promise<boolean>((resolve) => (finishStopping = () => resolve(true)));
    };
    agent = startAgent({ build: HOST_BUILD, update: async (commit) => void events.push(`update ${commit}`) });
    await waitFor(() => manager.status(hostId).online);

    tick();
    expect(events).toEqual([`stop ${hostId}`]);
    expect(manager.status(hostId).updating).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(events).toHaveLength(1);

    finishStopping();
    await waitFor(() => events.length === 2);
    expect(events[1]).toBe(`update ${COORDINATOR_BUILD}`);
  });

  // If the link drops while the sessions are being stopped, the update is not
  // lost: the same host instance is asked again once it is back and settled.
  it("asks again when the host dropped off while its sessions were stopping", async () => {
    manager.updateBlocker = () => null;
    let finishStopping = () => {};
    manager.prepareHostUpdate = () => new Promise<boolean>((resolve) => (finishStopping = () => resolve(true)));
    const requested: string[] = [];
    agent = startAgent({ build: HOST_BUILD, update: async (commit) => void requested.push(commit) });
    await waitFor(() => manager.status(hostId).online);

    tick();
    link!.drop();
    await waitFor(() => !manager.status(hostId).online);
    finishStopping();
    await waitFor(() => !manager.status(hostId).updating);
    expect(requested).toEqual([]);

    await waitFor(() => manager.status(hostId).online);
    manager.prepareHostUpdate = async () => true;
    tick();
    await waitFor(() => requested.length === 1);
  });

  // A host without --auto-update is never asked, however idle it is.
  it("never updates a host that did not opt in", async () => {
    manager.updateBlocker = () => null;
    agent = startAgent({ build: HOST_BUILD });
    await waitFor(() => manager.status(hostId).online);
    const from = link!.sentToHost.length;
    tick();
    expect(link!.sentToHost.slice(from).some((message) => message.t === "update")).toBe(false);
  });

  // A failed switch is reported back and shown; the host keeps running.
  it("records why a host could not update", async () => {
    manager.updateBlocker = () => null;
    agent = startAgent({
      build: HOST_BUILD,
      update: async () => {
        throw new Error("The Takode checkout has uncommitted changes");
      },
    });
    await waitFor(() => manager.status(hostId).online);
    tick();
    await waitFor(() => manager.status(hostId).updateError !== null);
    expect(manager.status(hostId)).toMatchObject({
      online: true,
      updating: false,
      updateError: "The Takode checkout has uncommitted changes",
    });
  });

  // A host operation still goes to a host on another build, but if it fails
  // there the error names the build difference instead of failing bare.
  it("names the build difference when a host operation fails on a mismatched host", async () => {
    agent = startAgent({ build: HOST_BUILD });
    await waitFor(() => manager.status(hostId).online);
    await expect(
      manager.request(hostId, { kind: "operation", name: "operationFromTheFuture", args: [] }, 5_000),
    ).rejects.toThrow(
      /Unknown host operation: operationFromTheFuture \(host host-1 runs Takode aaaaaaaa and this server runs cccccccc; update takode on the host\)/,
    );
  });
});

describe("hostCanRestart", () => {
  const STARTED_AT = 1_000;
  const idle: BridgeTurnView = { isGenerating: false, pendingPermissions: { size: 0 }, messageHistory: [] };

  function check(bridge: BridgeTurnView, options: { awaitingReattach?: boolean; state?: string } = {}) {
    return hostCanRestart("h1", {
      sessions: [
        { sessionId: "s1", hostId: "h1", state: options.state ?? "connected" },
        // Sessions on other hosts and archived ones never block.
        { sessionId: "other", hostId: "h2", state: "connected" },
        { sessionId: "archived", hostId: "h1", state: "connected", archived: true },
      ],
      awaitingReattach: () => options.awaitingReattach ?? false,
      bridgeSession: (sessionId) =>
        sessionId === "s1" ? bridge : { ...idle, isGenerating: true, pendingPermissions: { size: 1 } },
      coordinatorStartedAt: STARTED_AT,
    });
  }

  it("allows a restart only when every live session on the host is idle", () => {
    expect(check(idle)).toBe(true);
    expect(check({ ...idle, isGenerating: true })).toBe(false);
    expect(check({ ...idle, pendingPermissions: { size: 1 } })).toBe(false);
    expect(check(idle, { awaitingReattach: true })).toBe(false);
    // An exited session has no process a restart could end.
    expect(check({ ...idle, isGenerating: true }, { state: "exited" })).toBe(true);
  });

  // After a coordinator restart the bridge does not know a taken-over process's
  // turn, so a turn opened before the restart and never finished counts as running.
  it("treats a turn left open before this coordinator started as running", () => {
    const openBefore = [{ type: "result" }, { type: "user_message", timestamp: STARTED_AT - 1 }, { type: "assistant" }];
    expect(check({ ...idle, messageHistory: openBefore })).toBe(false);
    expect(check({ ...idle, messageHistory: [...openBefore, { type: "result" }] })).toBe(true);
    // A turn this coordinator saw start is tracked by the bridge itself.
    expect(check({ ...idle, messageHistory: [{ type: "user_message", timestamp: STARTED_AT + 1 }] })).toBe(true);
  });

  // This machine's node runs sessions that have no host but saved a node
  // process id; a busy one blocks restarting that node, while a session started
  // directly here does not.
  it("counts the sessions this machine's node runs", () => {
    const busy = { ...idle, isGenerating: true };
    const local = (session: { sessionId: string; hostProcId?: string }) =>
      hostCanRestart("local", {
        sessions: [{ ...session, state: "connected" }],
        awaitingReattach: () => false,
        bridgeSession: () => busy,
        coordinatorStartedAt: STARTED_AT,
      });
    expect(local({ sessionId: "on-node", hostProcId: "p" })).toBe(false);
    expect(local({ sessionId: "direct" })).toBe(true);
  });
});

describe("switchCheckoutToCommit", () => {
  let root: string;
  let origin: string;
  let checkout: string;

  const git = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "Test",
        GIT_AUTHOR_EMAIL: "test@example.com",
        GIT_COMMITTER_NAME: "Test",
        GIT_COMMITTER_EMAIL: "test@example.com",
      },
    }).trim();

  function commitFile(cwd: string, content: string): string {
    writeFileSync(join(cwd, "file.txt"), content);
    git(cwd, "add", "file.txt");
    git(cwd, "commit", "-q", "-m", content);
    return git(cwd, "rev-parse", "HEAD");
  }

  // A disposable origin repo and a clone standing in for a host's Takode checkout.
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "takode-host-update-"));
    origin = join(root, "origin");
    checkout = join(root, "checkout");
    execFileSync("git", ["init", "-q", "-b", "main", origin]);
    commitFile(origin, "one");
    execFileSync("git", ["clone", "-q", origin, checkout]);
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("fetches a newer commit, checks it out exactly and installs", async () => {
    const target = commitFile(origin, "two");
    const installs: string[] = [];
    await switchCheckoutToCommit(checkout, target, async (dir) => void installs.push(dir));
    expect(await readCheckoutCommit(checkout)).toBe(target);
    expect(installs).toEqual([checkout]);
    // The branch the checkout was on is left where it was.
    expect(git(checkout, "rev-parse", "main")).not.toBe(target);
  });

  // Local edits to tracked files are never overwritten.
  it("refuses a checkout with uncommitted changes", async () => {
    const target = commitFile(origin, "two");
    writeFileSync(join(checkout, "file.txt"), "local edit");
    await expect(switchCheckoutToCommit(checkout, target, async () => {})).rejects.toThrow(/uncommitted changes/);
    expect(git(checkout, "rev-parse", "HEAD")).not.toBe(target);
  });

  it("reports a commit the remote does not have", async () => {
    const before = git(checkout, "rev-parse", "HEAD");
    await expect(switchCheckoutToCommit(checkout, "d".repeat(40), async () => {})).rejects.toThrow(/not available/);
    expect(git(checkout, "rev-parse", "HEAD")).toBe(before);
  });

  // A failed install must not leave the host on code whose dependencies are missing.
  it("returns to the previous checkout when the install fails", async () => {
    const target = commitFile(origin, "two");
    let calls = 0;
    await expect(
      switchCheckoutToCommit(checkout, target, async () => {
        if (calls++ === 0) throw new Error("lockfile out of date");
      }),
    ).rejects.toThrow(/lockfile out of date/);
    expect(git(checkout, "symbolic-ref", "--short", "HEAD")).toBe("main");
    expect(calls).toBe(2);
  });

  it("reads no commit outside a Git checkout", async () => {
    expect(await readCheckoutCommit(root)).toBeNull();
  });
});
