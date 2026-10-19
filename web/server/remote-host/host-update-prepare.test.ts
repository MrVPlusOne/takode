import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HostToCoordinator } from "../../shared/host-protocol.js";
import { HostAgent, type HostAgentOptions } from "./host-agent.js";
import { HOST_UPDATE_SETTLE_MS, HostLinkManager } from "./host-link-manager.js";
import {
  createUpdateBundle,
  prepareCheckoutForCommit,
  readCheckoutCommit,
  switchCheckoutToCommit,
} from "./host-update.js";
import { FakeHostLink } from "../test-fixtures/fake-host-link.js";

const hostId = "host-1";

async function waitFor(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

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

/**
 * A coordinator on another machine whose host link carries one host, with
 * the heartbeat tick driven by the test. The host agent's update hooks come
 * from each test.
 */
function linkedHost(build: string) {
  let clock = 1_000_000;
  let link: FakeHostLink | null = null;
  const manager = new HostLinkManager({ build, now: () => clock });
  manager.updateBlocker = () => null;
  const startAgent = (options: Pick<HostAgentOptions, "update" | "prepareUpdate">) => {
    const agent = new HostAgent({
      coordinatorUrl: "http://coordinator.test",
      token: "token",
      apiProxyPort: 45_678,
      reconnectDelayMs: 20,
      build: "a".repeat(40),
      log: () => {},
      connect: () => {
        link = new FakeHostLink(manager, hostId);
        return link.agentSide;
      },
      ...options,
    });
    agent.start();
    return agent;
  };
  /** Let the settle time pass and run the coordinator's heartbeat tick. */
  const tick = () => {
    clock += HOST_UPDATE_SETTLE_MS;
    manager.handleMessage(hostId, link!.coordinatorSide, JSON.stringify({ t: "heartbeat" } as HostToCoordinator));
    (manager as unknown as { tick(): void }).tick();
  };
  return { manager, startAgent, tick, link: () => link! };
}

describe("preparing a host update before stopping its sessions", () => {
  const COORDINATOR_BUILD = "c".repeat(40);
  let agent: HostAgent | null = null;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    agent?.stop();
    agent = null;
    vi.restoreAllMocks();
  });

  // The order that matters: the host first says whether it has the commit;
  // when it cannot get it from its own remote, the coordinator sends a bundle
  // built from the commits the host has. Only once the host is ready are its
  // sessions stopped and the update sent.
  it("sends the missing Git objects, then stops the sessions, then updates", async () => {
    const host = linkedHost(COORDINATOR_BUILD);
    const events: string[] = [];
    host.manager.updateBundle = async (commit, haves) => {
      events.push(`bundle ${commit.slice(0, 1)} not ${haves.join(",")}`);
      return Buffer.from("objects");
    };
    host.manager.prepareHostUpdate = async () => {
      events.push("stop sessions");
      return true;
    };
    agent = host.startAgent({
      prepareUpdate: async (commit, bundle) => {
        events.push(`prepare ${commit.slice(0, 1)}${bundle ? ` with ${bundle.toString()}` : ""}`);
        return bundle ? { ready: true } : { ready: false, haves: ["h1", "h2"] };
      },
      update: async (commit) => void events.push(`update ${commit.slice(0, 1)}`),
    });
    await waitFor(() => host.manager.status(hostId).online);

    host.tick();
    await waitFor(() => events.length === 5);
    expect(events).toEqual(["prepare c", "bundle c not h1,h2", "prepare c with objects", "stop sessions", "update c"]);
    expect(host.manager.status(hostId)).toMatchObject({ updating: true, updateError: null });
  });

  // The ordering problem this exists for: a host that cannot get the commit
  // (or refuses, e.g. a dirty checkout) must keep its sessions running and
  // say why, and is not asked again until its node restarts.
  it("leaves the host's sessions alone when it cannot get ready", async () => {
    const host = linkedHost(COORDINATOR_BUILD);
    const stopped: string[] = [];
    host.manager.prepareHostUpdate = async (stoppingHost) => {
      stopped.push(stoppingHost);
      return true;
    };
    let prepares = 0;
    agent = host.startAgent({
      prepareUpdate: async () => {
        prepares++;
        throw new Error("The Takode checkout has uncommitted changes to tracked files");
      },
      update: async () => {
        throw new Error("must not be asked");
      },
    });
    await waitFor(() => host.manager.status(hostId).online);

    host.tick();
    await waitFor(() => host.manager.status(hostId).updateError !== null);
    expect(host.manager.status(hostId)).toMatchObject({
      online: true,
      updating: false,
      updateError: "The Takode checkout has uncommitted changes to tracked files",
    });
    host.tick();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(prepares).toBe(1);
    expect(stopped).toEqual([]);
    expect(host.link().sentToHost.some((message) => message.t === "update")).toBe(false);
  });

  // Preparing can take minutes (a fetch, a bundle over a slow link). The
  // idle rule is checked again afterwards: a turn that started meanwhile
  // holds the update off, and once it ends the update goes ahead without
  // preparing a second time. While preparing, the status says what it waits for.
  it("checks again whether the host may update once it is ready", async () => {
    const host = linkedHost(COORDINATOR_BUILD);
    let blocker: string | null = null;
    host.manager.updateBlocker = () => blocker;
    let finishPreparing = () => {};
    let prepares = 0;
    const updates: string[] = [];
    agent = host.startAgent({
      prepareUpdate: () => {
        prepares++;
        return new Promise((resolve) => (finishPreparing = () => resolve({ ready: true })));
      },
      update: async (commit) => void updates.push(commit),
    });
    await waitFor(() => host.manager.status(hostId).online);

    host.tick();
    await waitFor(() => prepares === 1);
    expect(host.manager.status(hostId).updateWaitingFor).toBe("the new code has reached it");
    blocker = "its sessions finish their turns";
    finishPreparing();
    await waitFor(() => host.manager.status(hostId).updateWaitingFor === "its sessions finish their turns");
    expect(updates).toEqual([]);

    blocker = null;
    host.tick();
    await waitFor(() => updates.length === 1);
    expect(prepares).toBe(1);
  });

  // A host on an older build does not offer `preparesUpdates`; it is sent
  // `update` straight away as before, so it can still reach this build.
  it("updates an older host without preparing it", async () => {
    const host = linkedHost(COORDINATOR_BUILD);
    const updates: string[] = [];
    agent = host.startAgent({ update: async (commit) => void updates.push(commit) });
    await waitFor(() => host.manager.status(hostId).online);
    host.tick();
    await waitFor(() => updates.length === 1);
    expect(host.link().sentToHost.some((message) => message.t === "request")).toBe(false);
  });
});

describe("host updates to a commit that was never pushed (real Git)", () => {
  let root: string;
  let origin: string;
  let coordinator: string;
  let checkout: string;
  let agent: HostAgent | null = null;

  // An origin both sides cloned, the coordinator's checkout with a commit it
  // never pushed, and a host checkout whose only remote is the origin.
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    root = mkdtempSync(join(tmpdir(), "takode-host-update-prepare-"));
    origin = join(root, "origin");
    coordinator = join(root, "coordinator");
    checkout = join(root, "checkout");
    execFileSync("git", ["init", "-q", "-b", "main", origin]);
    for (let i = 0; i < 3; i++) commitFile(origin, `history ${i}`);
    execFileSync("git", ["clone", "-q", origin, coordinator]);
    execFileSync("git", ["clone", "-q", origin, checkout]);
  });

  afterEach(() => {
    agent?.stop();
    agent = null;
    rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  // The whole path with real repositories: the host fetches in vain, the
  // coordinator bundles only the unpushed commit, the host verifies and
  // imports it while still on its old commit, and the switch then finds it.
  it("brings the coordinator's unpushed commit to the host over the link", async () => {
    const before = git(checkout, "rev-parse", "HEAD");
    const unpushed = commitFile(coordinator, "private fix");
    const host = linkedHost(unpushed);
    host.manager.updateBundle = (commit, haves) => createUpdateBundle(coordinator, commit, haves);
    let headWhilePreparing: string | null = null;
    let switched = false;
    agent = host.startAgent({
      prepareUpdate: async (commit, bundle) => {
        const answer = await prepareCheckoutForCommit(checkout, commit, bundle);
        headWhilePreparing = git(checkout, "rev-parse", "HEAD");
        return answer;
      },
      update: async (commit) => {
        await switchCheckoutToCommit(checkout, commit, async () => {});
        switched = true;
      },
    });
    await waitFor(() => host.manager.status(hostId).online);

    host.tick();
    await waitFor(() => switched);
    expect(headWhilePreparing).toBe(before);
    expect(await readCheckoutCommit(checkout)).toBe(unpushed);
    const bundleRequest = host
      .link()
      .sentToHost.find(
        (message) => message.t === "request" && message.request.kind === "prepare_update" && message.request.bundle,
      );
    // A thin bundle: one commit on top of what the host had, not the history.
    const bundle = Buffer.from((bundleRequest as { request: { bundle: string } }).request.bundle, "base64");
    expect(bundle.length).toBeLessThan(2_000);
  });

  // A pushed commit keeps today's path: the host fetches it from its own
  // remote and the coordinator sends nothing.
  it("fetches a pushed commit from the host's own remote", async () => {
    const pushed = commitFile(origin, "pushed");
    expect(await prepareCheckoutForCommit(checkout, pushed, null)).toEqual({ ready: true });
    expect(git(checkout, "rev-parse", "HEAD")).not.toBe(pushed);
  });

  it("answers with the commits it has when the commit is nowhere it can fetch from", async () => {
    const unpushed = commitFile(coordinator, "private fix");
    const answer = await prepareCheckoutForCommit(checkout, unpushed, null);
    expect(answer).toEqual({ ready: false, haves: expect.arrayContaining([git(checkout, "rev-parse", "HEAD")]) });
  });

  // Refusals that the switch would hit come before anything is stopped.
  it("refuses a checkout with uncommitted changes while preparing", async () => {
    const unpushed = commitFile(coordinator, "private fix");
    writeFileSync(join(checkout, "file.txt"), "local edit");
    await expect(prepareCheckoutForCommit(checkout, unpushed, null)).rejects.toThrow(/uncommitted changes/);
  });

  // Repository identity: a host checkout that shares no history with the
  // coordinator's is a different repository; it is refused rather than sent
  // the whole history.
  it("refuses to bundle for a checkout with no commit in common", async () => {
    const unpushed = commitFile(coordinator, "private fix");
    const stranger = join(root, "stranger");
    execFileSync("git", ["init", "-q", "-b", "main", stranger]);
    const strangerHead = commitFile(stranger, "unrelated");
    await expect(createUpdateBundle(coordinator, unpushed, [strangerHead])).rejects.toThrow(/shares no commit/);
  });

  // A bundle that builds on commits the host does not have fails its check
  // and leaves the checkout as it was.
  it("refuses a bundle that does not fit the host's checkout", async () => {
    const first = commitFile(coordinator, "private one");
    const second = commitFile(coordinator, "private two");
    const bundle = await createUpdateBundle(coordinator, second, [first]);
    await expect(prepareCheckoutForCommit(checkout, second, bundle)).rejects.toThrow(/do not fit this checkout/);
    expect(() => git(checkout, "cat-file", "-e", second)).toThrow();
  });
});
