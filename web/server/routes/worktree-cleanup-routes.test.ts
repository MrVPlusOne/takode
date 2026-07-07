import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as gitUtils from "../git-utils.js";
import { registerWorktreeCleanupRoutes } from "./worktree-cleanup-routes.js";

vi.mock("../git-utils.js", () => ({
  WORKTREES_BASE: "/owned/worktrees",
  countCommitsBetweenAsync: vi.fn(async () => 0),
  isWorktreeDirtyAsync: vi.fn(async () => false),
  resolveRefAsync: vi.fn(async () => "sha"),
}));

function makeSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "s1",
    sessionNum: 12,
    name: "Archived Worker",
    cwd: "/owned/worktrees/repo/main-wt-1234",
    repoRoot: "/repo",
    branch: "main",
    actualBranch: "main-wt-1234",
    archived: true,
    archivedAt: 1000,
    isWorktree: true,
    state: "exited",
    createdAt: 1,
    ...overrides,
  };
}

function makeApp(
  options: {
    session?: ReturnType<typeof makeSession>;
    sessions?: Array<ReturnType<typeof makeSession>>;
    pathExists?: boolean;
    pending?: Map<string, Promise<void>>;
  } = {},
) {
  const session = options.session ?? makeSession();
  const sessions = options.sessions ?? [session];
  const pending = options.pending ?? new Map<string, Promise<void>>();
  const launcher = {
    getSession: vi.fn((id: string) => sessions.find((item) => item.sessionId === id)),
    getSessionNum: vi.fn((id: string) => sessions.find((item) => item.sessionId === id)?.sessionNum),
    listSessions: vi.fn(() => sessions),
    setWorktreeCleanupState: vi.fn((id: string, updates: Record<string, unknown>) => {
      const target = sessions.find((item) => item.sessionId === id);
      if (!target) return;
      Object.assign(target, {
        worktreeCleanupStatus: updates.status,
        worktreeCleanupError: updates.error,
        worktreeCleanupStartedAt: updates.startedAt,
        worktreeCleanupFinishedAt: updates.finishedAt,
      });
    }),
  };
  const worktreeTracker = {
    getBySession: vi.fn(() => null),
    getSessionsForWorktree: vi.fn(() => []),
    isWorktreeInUse: vi.fn(() => false),
    removeBySession: vi.fn(),
  };
  const queueArchivedWorktreeCleanup = vi.fn((id: string) => {
    pending.set(id, Promise.resolve());
    launcher.setWorktreeCleanupState(id, { status: "pending", error: undefined, startedAt: 2000 });
    return { status: "pending" as const, path: session.cwd };
  });
  const app = new Hono();
  registerWorktreeCleanupRoutes(app, {
    launcher: launcher as never,
    pathExists: vi.fn(async () => options.pathExists ?? true),
    pendingWorktreeCleanups: pending,
    queueArchivedWorktreeCleanup,
    resolveId: vi.fn((raw: string) => raw),
    worktreeTracker: worktreeTracker as never,
  });
  return { app, launcher, queueArchivedWorktreeCleanup, worktreeTracker };
}

describe("worktree cleanup routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(gitUtils.countCommitsBetweenAsync).mockResolvedValue(0);
    vi.mocked(gitUtils.isWorktreeDirtyAsync).mockResolvedValue(false);
    vi.mocked(gitUtils.resolveRefAsync).mockResolvedValue("sha");
  });

  it("lists archived Takode-owned worktree cleanup candidates without dirty checks", async () => {
    const { app } = makeApp();

    const res = await app.request("/worktree-cleanup/candidates");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.candidates).toHaveLength(1);
    expect(json.candidates[0]).toMatchObject({
      sessionId: "s1",
      sessionNum: 12,
      exists: true,
      retryable: true,
      ownershipReason: "takode-worktree-root",
      safety: { status: "not_checked", summary: "dirty/ahead safety checked on retry" },
    });
    expect(gitUtils.isWorktreeDirtyAsync).not.toHaveBeenCalled();
  });

  it("marks restart-abandoned pending cleanup as failed during discovery", async () => {
    const session = makeSession({ worktreeCleanupStatus: "pending" });
    const { app, launcher } = makeApp({ session });

    const res = await app.request("/worktree-cleanup/candidates");

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.candidates[0]).toMatchObject({
      cleanupStatus: "failed",
      cleanupError: "Cleanup was interrupted before completion.",
      retryable: true,
    });
    expect(launcher.setWorktreeCleanupState).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ status: "failed", error: "Cleanup was interrupted before completion." }),
    );
  });

  it("refuses retry when selected cleanup candidate is dirty", async () => {
    vi.mocked(gitUtils.isWorktreeDirtyAsync).mockResolvedValue(true);
    const { app, queueArchivedWorktreeCleanup } = makeApp();

    const res = await app.request("/worktree-cleanup/s1/retry", { method: "POST" });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      error: "Worktree has uncommitted changes",
      safety: { status: "blocked", dirty: true },
    });
    expect(queueArchivedWorktreeCleanup).not.toHaveBeenCalled();
  });

  it("queues retry with force disabled after clean safety preflight", async () => {
    const { app, queueArchivedWorktreeCleanup } = makeApp();

    const res = await app.request("/worktree-cleanup/s1/retry", { method: "POST" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, cleanup: { status: "pending" } });
    expect(gitUtils.isWorktreeDirtyAsync).toHaveBeenCalledWith("/owned/worktrees/repo/main-wt-1234");
    expect(gitUtils.countCommitsBetweenAsync).toHaveBeenCalledWith("/repo", "refs/heads/main", "sha");
    expect(queueArchivedWorktreeCleanup).toHaveBeenCalledWith("s1", { archiveBranch: true, force: false });
  });

  it("refuses retry when another active session uses the same worktree path", async () => {
    const archived = makeSession();
    const active = makeSession({ sessionId: "active", sessionNum: 13, archived: false });
    const { app, queueArchivedWorktreeCleanup } = makeApp({ session: archived, sessions: [archived, active] });

    const res = await app.request("/worktree-cleanup/s1/retry", { method: "POST" });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "Worktree is mapped to another session" });
    expect(queueArchivedWorktreeCleanup).not.toHaveBeenCalled();
  });
});
