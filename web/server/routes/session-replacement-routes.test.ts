import { describe, expect, it, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import { registerSessionReplacementRoutes } from "./session-replacement-routes.js";
import * as gitUtils from "../git-utils.js";

vi.mock("../git-utils.js", () => ({
  countCommitsBetweenAsync: vi.fn(async () => 0),
  getRepoInfoAsync: vi.fn(async (cwd: string) => {
    if (cwd === "/repo") {
      return { repoRoot: "/repo", repoName: "repo", currentBranch: "main", defaultBranch: "main", isWorktree: false };
    }
    if (cwd === "/wt/main-wt-1111") {
      return {
        repoRoot: "/repo",
        repoName: "repo",
        currentBranch: "main-wt-1111",
        defaultBranch: "main",
        isWorktree: true,
      };
    }
    return null;
  }),
  isWorktreeDirtyAsync: vi.fn(async () => false),
  resetWorktreeToRefAsync: vi.fn(async () => "HEAD is now at base"),
  resolveRefAsync: vi.fn(async (_repoRoot: string, ref: string) => `${ref}-sha`),
}));

vi.mock("../container-manager.js", () => ({
  containerManager: { removeContainer: vi.fn() },
}));

function makeWorker(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "worker-1",
    sessionNum: 12,
    name: "Done worker",
    state: "connected",
    cwd: "/wt/main-wt-1111",
    archived: false,
    herdedBy: "leader-1",
    isWorktree: true,
    repoRoot: "/repo",
    branch: "main",
    actualBranch: "main-wt-1111",
    ...overrides,
  };
}

function makeApp(workerOverrides: Record<string, unknown> = {}) {
  const worker = makeWorker(workerOverrides);
  const createSessionFromBody = vi.fn(async () => ({ sessionId: "new-worker" }));
  const launcher = {
    getSession: vi.fn((id: string) => (id === "worker-1" ? worker : undefined)),
    kill: vi.fn(async () => {}),
    listSessions: vi.fn(() => [worker]),
    relaunch: vi.fn(async () => ({ ok: true })),
    setArchived: vi.fn(),
  };
  const deps = {
    authenticateTakodeCaller: vi.fn(() => ({
      callerId: "leader-1",
      caller: { sessionId: "leader-1", isOrchestrator: true },
    })),
    createSessionFromBody,
    launcher,
    prPoller: { unwatch: vi.fn() },
    resolveId: vi.fn((raw: string) => (raw === "worker-1" || raw === "12" ? "worker-1" : null)),
    sessionStore: { setArchived: vi.fn(async () => {}) },
    timerManager: { cancelAllTimers: vi.fn(async () => {}) },
    worktreeTracker: {
      addMapping: vi.fn(),
      isWorktreeInUse: vi.fn(() => false),
      removeBySession: vi.fn(),
    },
    wsBridge: { emitTakodeEvent: vi.fn() },
  };
  const app = new Hono();
  registerSessionReplacementRoutes(app, deps as any);
  return { app, deps, worker };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(gitUtils.countCommitsBetweenAsync).mockResolvedValue(0);
  vi.mocked(gitUtils.getRepoInfoAsync).mockImplementation(async (cwd: string) => {
    if (cwd === "/repo") {
      return { repoRoot: "/repo", repoName: "repo", currentBranch: "main", defaultBranch: "main", isWorktree: false };
    }
    if (cwd === "/wt/main-wt-1111") {
      return {
        repoRoot: "/repo",
        repoName: "repo",
        currentBranch: "main-wt-1111",
        defaultBranch: "main",
        isWorktree: true,
      };
    }
    return null;
  });
  vi.mocked(gitUtils.isWorktreeDirtyAsync).mockResolvedValue(false);
  vi.mocked(gitUtils.resetWorktreeToRefAsync).mockResolvedValue("HEAD is now at base");
  vi.mocked(gitUtils.resolveRefAsync).mockImplementation(async (_repoRoot: string, ref: string) => `${ref}-sha`);
});

describe("session replacement routes", () => {
  it("archives the old owned worktree worker, resets the path, and creates the replacement in that worktree", async () => {
    const { app, deps } = makeApp();

    const res = await app.request("/sessions/worker-1/replace-worktree-worker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        create: {
          backend: "codex",
          cwd: "/repo",
          useWorktree: true,
          model: "gpt-5.4",
          codexReasoningEffort: "high",
        },
      }),
    });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      ok: true,
      oldSessionId: "worker-1",
      newSessionId: "new-worker",
      recycledPath: "/wt/main-wt-1111",
      baseBranch: "main",
      baseSha: "refs/heads/main-sha",
      reset: { ok: true },
    });
    expect(deps.wsBridge.emitTakodeEvent).toHaveBeenCalledWith(
      "worker-1",
      "session_archived",
      { archive_source: "leader" },
      "leader-1",
    );
    expect(deps.launcher.kill).toHaveBeenCalledWith("worker-1");
    expect(deps.launcher.setArchived).toHaveBeenCalledWith("worker-1", true);
    expect(deps.sessionStore.setArchived).toHaveBeenCalledWith("worker-1", true);
    expect(deps.worktreeTracker.removeBySession).toHaveBeenCalledWith("worker-1");
    expect(gitUtils.resetWorktreeToRefAsync).toHaveBeenCalledWith("/wt/main-wt-1111", "refs/heads/main");
    expect(deps.createSessionFromBody).toHaveBeenCalledWith(
      expect.objectContaining({
        backend: "codex",
        cwd: "/wt/main-wt-1111",
        useWorktree: false,
        createdBy: "leader-1",
        model: "gpt-5.4",
        codexReasoningEffort: "high",
      }),
      expect.objectContaining({
        repoRoot: "/repo",
        branch: "main",
        actualBranch: "main-wt-1111",
        worktreePath: "/wt/main-wt-1111",
      }),
    );
  });

  it("refuses dirty worktrees before archiving", async () => {
    vi.mocked(gitUtils.isWorktreeDirtyAsync).mockResolvedValue(true);
    const { app, deps } = makeApp();

    const res = await app.request("/sessions/worker-1/replace-worktree-worker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ create: { cwd: "/repo", useWorktree: true } }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "Replacement worktree has uncommitted changes" });
    expect(deps.launcher.kill).not.toHaveBeenCalled();
    expect(deps.createSessionFromBody).not.toHaveBeenCalled();
  });

  it("refuses committed-ahead worktrees before archiving", async () => {
    vi.mocked(gitUtils.countCommitsBetweenAsync).mockResolvedValue(2);
    const { app, deps } = makeApp();

    const res = await app.request("/sessions/worker-1/replace-worktree-worker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ create: { cwd: "/repo", useWorktree: true } }),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "Replacement worktree has 2 committed change(s) ahead of main" });
    expect(deps.launcher.kill).not.toHaveBeenCalled();
    expect(deps.createSessionFromBody).not.toHaveBeenCalled();
  });

  it("requires the worker to belong to the authenticated leader", async () => {
    const { app, deps } = makeApp({ herdedBy: "other-leader" });

    const res = await app.request("/sessions/worker-1/replace-worktree-worker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ create: { cwd: "/repo", useWorktree: true } }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "Only the leader who herded this worker can replace it" });
    expect(deps.launcher.kill).not.toHaveBeenCalled();
  });

  it("requires a worktree-backed worker", async () => {
    const { app, deps } = makeApp({ isWorktree: false });

    const res = await app.request("/sessions/worker-1/replace-worktree-worker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ create: { cwd: "/repo", useWorktree: true } }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Replacement requires a worktree-backed worker session" });
    expect(deps.createSessionFromBody).not.toHaveBeenCalled();
  });

  it("checks the replacement spawn cwd uses the same base branch", async () => {
    vi.mocked(gitUtils.getRepoInfoAsync).mockImplementation(async (cwd: string) => {
      if (cwd === "/repo") {
        return {
          repoRoot: "/repo",
          repoName: "repo",
          currentBranch: "develop",
          defaultBranch: "develop",
          isWorktree: false,
        };
      }
      if (cwd === "/wt/main-wt-1111") {
        return {
          repoRoot: "/repo",
          repoName: "repo",
          currentBranch: "main-wt-1111",
          defaultBranch: "main",
          isWorktree: true,
        };
      }
      return null;
    });
    const { app, deps } = makeApp();

    const res = await app.request("/sessions/worker-1/replace-worktree-worker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ create: { cwd: "/repo", useWorktree: true } }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "Replacement worker base branch mismatch: worker uses main, requested spawn uses develop",
    });
    expect(deps.launcher.kill).not.toHaveBeenCalled();
  });

  it("checks the replacement spawn cwd uses the same repository", async () => {
    vi.mocked(gitUtils.getRepoInfoAsync).mockImplementation(async (cwd: string) => {
      if (cwd === "/other") {
        return {
          repoRoot: "/other",
          repoName: "other",
          currentBranch: "main",
          defaultBranch: "main",
          isWorktree: false,
        };
      }
      if (cwd === "/wt/main-wt-1111") {
        return {
          repoRoot: "/repo",
          repoName: "repo",
          currentBranch: "main-wt-1111",
          defaultBranch: "main",
          isWorktree: true,
        };
      }
      return null;
    });
    const { app, deps } = makeApp();

    const res = await app.request("/sessions/worker-1/replace-worktree-worker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ create: { cwd: "/other", useWorktree: true } }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: "Replacement worker must be in the same repository as the requested spawn cwd",
    });
    expect(deps.launcher.kill).not.toHaveBeenCalled();
  });

  it("restores the old worker if replacement fails after archive preflight", async () => {
    vi.mocked(gitUtils.resetWorktreeToRefAsync).mockRejectedValue(new Error("reset refused"));
    const { app, deps } = makeApp();

    const res = await app.request("/sessions/worker-1/replace-worktree-worker", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ create: { cwd: "/repo", useWorktree: true } }),
    });

    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({
      error: "Failed to replace worktree worker after preflight: reset refused",
      recovery: { oldSessionRestored: true, relaunch: { ok: true } },
    });
    expect(deps.launcher.setArchived).toHaveBeenCalledWith("worker-1", true);
    expect(deps.launcher.setArchived).toHaveBeenCalledWith("worker-1", false);
    expect(deps.sessionStore.setArchived).toHaveBeenCalledWith("worker-1", true);
    expect(deps.sessionStore.setArchived).toHaveBeenCalledWith("worker-1", false);
    expect(deps.worktreeTracker.addMapping).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: "worker-1",
        repoRoot: "/repo",
        branch: "main",
        actualBranch: "main-wt-1111",
        worktreePath: "/wt/main-wt-1111",
      }),
    );
    expect(deps.launcher.relaunch).toHaveBeenCalledWith("worker-1");
    expect(deps.createSessionFromBody).not.toHaveBeenCalled();
  });
});
