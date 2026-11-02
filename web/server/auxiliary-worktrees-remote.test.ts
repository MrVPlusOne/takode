import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuxiliaryWorktreeRegistry } from "./auxiliary-worktree-registry.js";
import { AuxiliaryWorktreeLifecycle } from "./auxiliary-worktrees.js";
import { HostAgent } from "./remote-host/host-agent.js";
import { HostLinkManager } from "./remote-host/host-link-manager.js";
import { configureRemoteMachines } from "./remote-host/session-machine.js";
import { registerAuxiliaryWorktreeRoutes } from "./routes/auxiliary-worktree-routes.js";
import type { RouteContext } from "./routes/context.js";
import { FakeHostLink } from "./test-fixtures/fake-host-link.js";
import type { WorktreeMapping, WorktreeTracker } from "./worktree-tracker.js";

/**
 * `takode worktree register` for a checkout on another machine, such as one a
 * session created with `takode exec --host laptop`. Its path and Git checks, and
 * its removal at archive, must run on that machine, not on the coordinator.
 * The "remote" host is an in-process HostAgent reached only through the host
 * link; stopping it proves the coordinator could not fall back to local Git.
 * Every repository and checkout lives under a disposable temporary root.
 */
const HOST_ID = "host-laptop";

let root: string;
let repo: string;
let manager: HostLinkManager;
let agent: HostAgent;
let registry: AuxiliaryWorktreeRegistry;
let lifecycle: AuxiliaryWorktreeLifecycle;
let owners: Array<{ sessionId: string; cwd: string; archived?: boolean; hostId?: string }>;
let mappings: Array<Partial<WorktreeMapping> & { sessionId: string; worktreePath: string }>;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: "pipe" }).trim();
}

function checkout(name = "launch") {
  const path = join(root, name);
  git(repo, "worktree", "add", "-b", name, path, "main");
  return path;
}

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeEach(async () => {
  for (const key of Object.keys(process.env)) if (key.startsWith("GIT_")) vi.stubEnv(key, undefined);
  vi.stubEnv("GIT_CONFIG_GLOBAL", "/dev/null");
  vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
  root = realpathSync(mkdtempSync(join(tmpdir(), "auxiliary-remote-test-")));
  repo = join(root, "repo");
  mkdirSync(repo);
  git(repo, "-c", "init.templateDir=", "init", "-b", "main");
  git(repo, "config", "user.name", "Fixture");
  git(repo, "config", "user.email", "fixture@example.invalid");
  git(repo, "config", "core.hooksPath", join(root, "no-hooks"));
  writeFileSync(join(repo, "README"), "fixture\n");
  git(repo, "add", "README");
  git(repo, "commit", "-m", "Fixture base");

  manager = new HostLinkManager();
  configureRemoteMachines(manager);
  agent = new HostAgent({
    coordinatorUrl: "http://coordinator.test",
    token: "token",
    apiProxyPort: 45_678,
    log: () => {},
    connect: () => new FakeHostLink(manager, HOST_ID).agentSide,
  });
  agent.start();
  await waitFor(() => manager.status(HOST_ID).online);

  registry = new AuxiliaryWorktreeRegistry(join(root, "metadata", "auxiliary-worktrees.json"));
  // The owner runs on the coordinator; its checkout happens to sit at the repo path.
  owners = [{ sessionId: "owner", cwd: repo, archived: false }];
  mappings = [];
  const tracker = { auxiliary: registry, load: () => mappings } as unknown as WorktreeTracker;
  lifecycle = new AuxiliaryWorktreeLifecycle(registry, () => owners, tracker);
});

afterEach(() => {
  agent.stop();
  configureRemoteMachines(null);
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe("auxiliary checkouts on another machine", () => {
  it("registers a checkout on a remote host and removes it there at archive, keeping its branch", async () => {
    const path = checkout();
    const record = await lifecycle.register("owner", path, "temporary", "main", HOST_ID);
    expect(record).toMatchObject({ hostId: HOST_ID, worktreePath: path, branch: "launch" });
    expect((await registry.list("owner"))[0].hostId).toBe(HOST_ID);

    owners[0].archived = true;
    const [cleaned] = await lifecycle.cleanup("owner");
    expect(cleaned.cleanupStatus).toBe("done");
    expect(existsSync(path)).toBe(false);
    expect(git(repo, "rev-parse", "--verify", "refs/heads/launch")).toBe(git(repo, "rev-parse", "main"));
  });

  it("keeps the checkout with a clear reason while its machine is offline, and removes it on retry", async () => {
    const path = checkout();
    await lifecycle.register("owner", path, "temporary", "main", HOST_ID);
    owners[0].archived = true;
    agent.stop();
    await waitFor(() => !manager.status(HOST_ID).online);

    const [blocked] = await lifecycle.cleanup("owner");
    expect(blocked.cleanupStatus).toBe("blocked");
    expect(blocked.cleanupReason).toContain("offline; nothing was removed");
    expect(existsSync(path)).toBe(true);

    agent = new HostAgent({
      coordinatorUrl: "http://coordinator.test",
      token: "token",
      apiProxyPort: 45_678,
      log: () => {},
      connect: () => new FakeHostLink(manager, HOST_ID).agentSide,
    });
    agent.start();
    await waitFor(() => manager.status(HOST_ID).online);
    const [retried] = await lifecycle.cleanup("owner", { path, hostId: HOST_ID });
    expect(retried.cleanupStatus).toBe("done");
    expect(existsSync(path)).toBe(false);
  });

  it("still refuses dirty work on the remote checkout", async () => {
    const path = checkout();
    await lifecycle.register("owner", path, "temporary", "main", HOST_ID);
    owners[0].archived = true;
    writeFileSync(join(path, "result.txt"), "unsaved\n");
    const [blocked] = await lifecycle.cleanup("owner");
    expect(blocked).toMatchObject({ cleanupStatus: "blocked", cleanupReason: "Worktree has uncommitted changes" });
    expect(existsSync(path)).toBe(true);
  });

  it("checks primary-checkout use only against sessions on the same machine", async () => {
    const path = checkout();
    // The same path on the coordinator is a different checkout: it must not count as the owner's own.
    owners[0].cwd = path;
    await expect(lifecycle.register("owner", path, "retained", undefined, HOST_ID)).resolves.toMatchObject({
      hostId: HOST_ID,
    });
    // A session on that host whose checkout is the path does block it.
    owners.push({ sessionId: "remote-owner", cwd: path, hostId: HOST_ID });
    await expect(lifecycle.register("remote-owner", path, "retained", undefined, HOST_ID)).rejects.toThrow(
      "The session's primary checkout is not auxiliary",
    );
  });
});

describe("auxiliary worktree routes with --host", () => {
  function app(caller = "owner") {
    const api = new Hono();
    const ctx = {
      resolveId: (id: string) => id,
      authenticateTakodeCaller: () => ({ callerId: caller, caller: {} }),
      launcher: {
        getSession: () => ({}),
        remoteHosts: { registry: { get: async (id: string) => (id === HOST_ID ? { id, name: "laptop" } : null) } },
      },
      options: {
        hostExec: {
          findMachine: async (name: string) =>
            name === "laptop" ? { id: HOST_ID, name: "laptop" } : name === "devbox" ? { id: "local", name } : null,
        },
      },
    } as unknown as RouteContext;
    registerAuxiliaryWorktreeRoutes(api, ctx, lifecycle);
    return api;
  }
  const post = (api: Hono, url: string, body: object) =>
    api.request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  it("registers on the named machine and lists the machine with the path", async () => {
    const path = checkout();
    const api = app();
    const unknown = await post(api, "/sessions/owner/worktrees", { path, retention: "retained", host: "nowhere" });
    expect(unknown.status).toBe(400);
    const relative = await post(api, "/sessions/owner/worktrees", {
      path: "launch",
      retention: "retained",
      host: "laptop",
    });
    expect(relative.status).toBe(400);

    const registered = await post(api, "/sessions/owner/worktrees", { path, retention: "retained", host: "laptop" });
    expect(registered.status).toBe(200);
    expect(await registered.json()).toMatchObject({ worktree: { machine: "laptop", path, retention: "retained" } });
    expect((await registry.list("owner"))[0].hostId).toBe(HOST_ID);

    const listed = await (await api.request("/sessions/owner/worktrees")).json();
    expect(listed.worktrees).toEqual([expect.objectContaining({ machine: "laptop", path })]);
  });

  it("refuses to register on an offline machine", async () => {
    const path = checkout();
    agent.stop();
    await waitFor(() => !manager.status(HOST_ID).online);
    const response = await post(app(), "/sessions/owner/worktrees", { path, retention: "retained", host: "laptop" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toBe("Host laptop is offline; register the checkout once it is back");
    expect(await registry.list("owner")).toEqual([]);
  });
});
