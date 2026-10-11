import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { FakeHostLink } from "../test-fixtures/fake-host-link.js";
import { HostAgent } from "../remote-host/host-agent.js";
import { HostLinkManager } from "../remote-host/host-link-manager.js";
import { configureRemoteMachines } from "../remote-host/session-machine.js";
import type { RouteContext } from "./context.js";
import { createFilesystemRoutes } from "./filesystem.js";
import { createGitRoutes } from "./git.js";

async function waitFor(condition: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

/**
 * The new-session dialog browses folders and repos on a selected remote host.
 * The "remote" host is an in-process HostAgent reached only through the host
 * link, so a passing request proves the route asked the host; every folder it
 * lists lives under a temporary directory.
 */
describe("folder and repo routes for a remote host", () => {
  const hostId = "host-1";
  let manager: HostLinkManager;
  let agent: HostAgent;
  let dir: string;
  let repo: string;
  let app: Hono;
  let broadcastToSession: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    dir = await realpath(await mkdtemp(join(tmpdir(), "remote-host-folders-")));
    repo = join(dir, "repo");
    await mkdir(join(dir, "docs"));
    await mkdir(join(dir, ".cache"));
    execFileSync("git", ["init", "-q", "-b", "main", repo]);
    git(
      repo,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "init",
    );
    git(repo, "branch", "feature");

    broadcastToSession = vi.fn();
    manager = new HostLinkManager();
    configureRemoteMachines(manager);
    agent = new HostAgent({
      coordinatorUrl: "http://coordinator.test",
      token: "token",
      apiProxyPort: 45_678,
      log: () => {},
      connect: () => new FakeHostLink(manager, hostId).agentSide,
    });
    agent.start();
    await waitFor(() => manager.status(hostId).online);

    const ctx = {
      launcher: {
        remoteHosts: { registry: { get: async (id: string) => ({ id, name: "devbox", createdAt: 0 }) } },
        getSession: (sessionId: string) => (sessionId === "remote-session" ? { sessionId, hostId } : undefined),
      },
      wsBridge: { getSession: () => undefined, broadcastToSession },
      execAsync: async () => "",
      execCaptureStdoutAsync: async () => "",
    } as unknown as RouteContext;
    app = new Hono();
    app.route("/api", createFilesystemRoutes(ctx));
    app.route("/api", createGitRoutes(ctx));
  });

  afterEach(async () => {
    agent.stop();
    configureRemoteMachines(null);
    await rm(dir, { recursive: true, force: true });
  });

  it("lists a host's folders, starting in its home folder", async () => {
    const request = vi.spyOn(manager, "request");

    const listed = await app.request(`/api/fs/list?host=${hostId}&path=${encodeURIComponent(dir)}`);
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual({
      path: dir,
      dirs: [
        { name: "docs", path: join(dir, "docs") },
        { name: "repo", path: repo },
      ],
      home: homedir(),
    });
    expect(request).toHaveBeenCalledWith(
      hostId,
      { kind: "operation", name: "listDirectories", args: [dir, false] },
      expect.any(Number),
    );

    // Without a path the host lists its own home folder.
    const home = await app.request(`/api/fs/list?host=${hostId}`);
    expect(await home.json()).toEqual(expect.objectContaining({ path: homedir(), home: homedir() }));
  });

  // The new-session dialog checks remembered folders on the chosen machine: a
  // path from another machine (or a file, or a relative path) is not a folder
  // there. The answer comes from the host's own filesystem, over its link.
  it("checks which paths are folders on the host", async () => {
    const request = vi.spyOn(manager, "request");
    const file = join(dir, "notes.txt");
    await writeFile(file, "x");
    const missing = join(dir, "missing");
    const query = [repo, missing, file, "relative/app"].map((path) => `path=${encodeURIComponent(path)}`).join("&");

    const checked = await app.request(`/api/fs/folders?host=${hostId}&${query}`);
    expect(checked.status).toBe(200);
    expect(await checked.json()).toEqual({
      folders: [
        { path: repo, exists: true },
        { path: missing, exists: false },
        { path: file, exists: false },
        { path: "relative/app", exists: false },
      ],
    });
    expect(request).toHaveBeenCalledWith(hostId, { kind: "stat", path: repo }, expect.any(Number));

    // Without a host the paths are checked on this machine.
    const local = await app.request(
      `/api/fs/folders?path=${encodeURIComponent(repo)}&path=${encodeURIComponent(missing)}`,
    );
    expect(await local.json()).toEqual({
      folders: [
        { path: repo, exists: true },
        { path: missing, exists: false },
      ],
    });
  });

  // The branch picker reads the host's repo: its info, branches and a fetch.
  it("reads a repo and its branches on the host", async () => {
    const info = await app.request(`/api/git/repo-info?host=${hostId}&path=${encodeURIComponent(repo)}`);
    expect(await info.json()).toEqual(expect.objectContaining({ repoRoot: repo, currentBranch: "main" }));

    const branches = await app.request(`/api/git/branches?host=${hostId}&repoRoot=${encodeURIComponent(repo)}`);
    const names = ((await branches.json()) as { name: string }[]).map((branch) => branch.name);
    expect(names).toEqual(expect.arrayContaining(["main", "feature"]));

    const request = vi.spyOn(manager, "request");
    const fetched = await app.request("/api/git/fetch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoRoot: repo, hostId }),
    });
    // The repo has no remote, so fetch succeeds with nothing to do; it ran on the host.
    expect(await fetched.json()).toEqual(expect.objectContaining({ success: true }));
    expect(request).toHaveBeenCalledWith(
      hostId,
      expect.objectContaining({ kind: "exec", cwd: repo }),
      expect.any(Number),
    );
  });

  // The diff panel's base-branch picker lists recent commits of a remote session's repo.
  it("lists a repo's recent commits on the host", async () => {
    const request = vi.spyOn(manager, "request");
    const res = await app.request(`/api/git/commits?host=${hostId}&repoRoot=${encodeURIComponent(repo)}&limit=5`);
    expect(res.status).toBe(200);
    const { commits } = (await res.json()) as { commits: { sha: string; message: string }[] };
    expect(commits).toEqual([expect.objectContaining({ sha: git(repo, "rev-parse", "HEAD"), message: "init" })]);
    expect(request).toHaveBeenCalledWith(
      hostId,
      expect.objectContaining({ kind: "exec", cwd: repo, command: expect.stringContaining(" log ") }),
      expect.any(Number),
    );
  });

  // Pulling for a session (no explicit host) runs on the session's host, then
  // reports the session's refreshed ahead/behind counts to its browsers.
  it("pulls a remote session's checkout on its host", async () => {
    const clone = join(dir, "clone");
    execFileSync("git", ["clone", "-q", repo, clone]);
    git(
      repo,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "-q",
      "--allow-empty",
      "-m",
      "next",
    );
    git(clone, "fetch", "-q");
    const request = vi.spyOn(manager, "request");

    const res = await app.request("/api/git/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd: clone, sessionId: "remote-session" }),
    });

    expect(await res.json()).toEqual(expect.objectContaining({ success: true, git_ahead: 0, git_behind: 0 }));
    expect(git(clone, "rev-parse", "HEAD")).toBe(git(repo, "rev-parse", "HEAD"));
    expect(request).toHaveBeenCalledWith(
      hostId,
      expect.objectContaining({ kind: "exec", cwd: clone, command: expect.stringContaining(" pull") }),
      expect.any(Number),
    );
    expect(broadcastToSession).toHaveBeenCalledWith("remote-session", {
      type: "session_update",
      session: { git_ahead: 0, git_behind: 0 },
    });
  });

  // An offline host gets a clear message naming it, not an empty folder.
  it("reports an offline host by name", async () => {
    agent.stop();
    await waitFor(() => !manager.status(hostId).online);

    const listed = await app.request(`/api/fs/list?host=${hostId}`);
    expect(listed.status).toBe(503);
    expect(await listed.json()).toEqual({ error: "Host devbox is offline" });

    // A folder check cannot be answered either; it is not reported as a missing folder.
    const checked = await app.request(`/api/fs/folders?host=${hostId}&path=${encodeURIComponent(repo)}`);
    expect(checked.status).toBe(503);
    expect(await checked.json()).toEqual({ error: "Host devbox is offline" });

    const info = await app.request(`/api/git/repo-info?host=${hostId}&path=${encodeURIComponent(repo)}`);
    expect(info.status).toBe(503);

    const commits = await app.request(`/api/git/commits?host=${hostId}&repoRoot=${encodeURIComponent(repo)}`);
    expect(commits.status).toBe(503);
  });
});
