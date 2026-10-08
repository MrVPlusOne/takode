import { Hono } from "hono";
import * as gitUtils from "../git-utils.js";
import { SERVER_GIT_CMD } from "../constants.js";
import { onMachine } from "../remote-host/host-operations.js";
import { machineFor } from "../remote-host/session-machine.js";
import { remoteHostFailure } from "./session-remote-host.js";
import type { RouteContext } from "./context.js";

export function createGitRoutes(ctx: RouteContext) {
  const api = new Hono();
  const { launcher, prPoller, execCaptureStdoutAsync, wsBridge } = ctx;

  // ─── Git operations ─────────────────────────────────────────────────

  // `host` names a registered remote host whose repo to read, for creating a session there.

  api.get("/git/repo-info", async (c) => {
    const path = c.req.query("path");
    if (!path) return c.json({ error: "path required" }, 400);
    const host = c.req.query("host") || undefined;
    let info: Awaited<ReturnType<typeof gitUtils.getRepoInfoAsync>>;
    try {
      info = await onMachine(host, "repoInfo", path);
    } catch (error) {
      if (!host) throw error;
      return remoteHostFailure(c, error, host, launcher.remoteHosts?.registry);
    }
    if (!info) return c.json({ error: "Not a git repository" }, 400);
    return c.json(info);
  });

  api.get("/git/branches", async (c) => {
    const repoRoot = c.req.query("repoRoot");
    if (!repoRoot) return c.json({ error: "repoRoot required" }, 400);
    const localOnly = c.req.query("localOnly") === "1";
    const host = c.req.query("host") || undefined;
    try {
      return c.json(await onMachine(host, "listBranches", repoRoot, { localOnly }));
    } catch (e: unknown) {
      if (host) return remoteHostFailure(c, e, host, launcher.remoteHosts?.registry);
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  api.get("/git/commits", async (c) => {
    const repoRoot = c.req.query("repoRoot");
    if (!repoRoot) return c.json({ error: "repoRoot required" }, 400);
    const limitStr = c.req.query("limit");
    const limit = Math.min(Math.max(parseInt(limitStr || "20", 10) || 20, 1), 100);
    try {
      const raw = await execCaptureStdoutAsync(
        `${SERVER_GIT_CMD} log --format="%H%x00%h%x00%s%x00%ct" -${limit}`,
        repoRoot,
      );
      const commits = raw
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [sha, shortSha, message, ts] = line.split("\0");
          return { sha, shortSha, message, timestamp: parseInt(ts, 10) * 1000 };
        });
      return c.json({ commits });
    } catch (e: unknown) {
      return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
    }
  });

  api.post("/git/fetch", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { repoRoot, hostId } = body;
    if (!repoRoot) return c.json({ error: "repoRoot required" }, 400);
    // `hostId` fetches a repo on that registered remote host.
    return c.json(await gitUtils.gitFetchAsync(repoRoot, hostId ? machineFor(hostId) : undefined));
  });

  api.get("/git/worktrees", async (c) => {
    const repoRoot = c.req.query("repoRoot");
    if (!repoRoot) return c.json({ error: "repoRoot required" }, 400);
    return c.json(await gitUtils.listWorktreesAsync(repoRoot));
  });

  api.post("/git/worktree", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { repoRoot, branch, baseBranch, createBranch } = body;
    if (!repoRoot || !branch) return c.json({ error: "repoRoot and branch required" }, 400);
    const result = await gitUtils.ensureWorktreeAsync(repoRoot, branch, { baseBranch, createBranch });
    return c.json(result);
  });

  api.delete("/git/worktree", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { repoRoot, worktreePath, force } = body;
    if (!repoRoot || !worktreePath) return c.json({ error: "repoRoot and worktreePath required" }, 400);
    const result = gitUtils.removeWorktree(repoRoot, worktreePath, { force });
    return c.json(result);
  });

  api.post("/git/pull", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const { cwd, sessionId, hostId } = body;
    if (!cwd) return c.json({ error: "cwd required" }, 400);
    // `hostId` pulls a repo on that registered remote host.
    const machine = hostId ? machineFor(hostId) : undefined;
    const result = await gitUtils.gitPullAsync(cwd, machine);
    // Return refreshed ahead/behind counts; none without an upstream.
    const counts = await gitUtils.gitSafeAsync("rev-list --left-right --count @{upstream}...HEAD", cwd, machine);
    const [behind, ahead] = (counts ?? "").split(/\s+/).map(Number);
    const git_ahead = ahead || 0;
    const git_behind = behind || 0;
    // Broadcast updated git counts to all browsers for this session
    if (sessionId) {
      wsBridge.broadcastToSession(sessionId, { type: "session_update", session: { git_ahead, git_behind } } as any);
    }
    return c.json({ ...result, git_ahead, git_behind });
  });

  // ─── GitHub PR Status ────────────────────────────────────────────────

  api.get("/git/pr-status", async (c) => {
    const cwd = c.req.query("cwd");
    const branch = c.req.query("branch");
    if (!cwd || !branch) return c.json({ error: "cwd and branch required" }, 400);

    // Check poller cache first for instant response
    if (prPoller) {
      const cached = prPoller.getCached(cwd, branch);
      if (cached) return c.json(cached);
    }

    const { isGhAvailable, fetchPRInfoAsync } = await import("../github-pr.js");
    if (!isGhAvailable()) {
      return c.json({ available: false, pr: null });
    }

    const pr = await fetchPRInfoAsync(cwd, branch);
    return c.json({ available: true, pr });
  });

  return api;
}
