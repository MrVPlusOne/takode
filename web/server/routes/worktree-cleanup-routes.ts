import { relative, resolve } from "node:path";
import type { Hono } from "hono";
import { WORKTREES_BASE } from "../git-utils.js";
import type { RouteContext } from "./context.js";
import {
  assessWorktreeCleanupSafety,
  resolveWorktreeCleanupTarget,
  type WorktreeCleanupSafety,
  type WorktreeCleanupStatus,
} from "./worktree-cleanup.js";

export interface WorktreeCleanupCandidate {
  sessionId: string;
  sessionNum: number | null;
  name: string | null;
  archivedAt: number | null;
  repoRoot: string;
  branch: string;
  actualBranch: string | null;
  worktreePath: string;
  cleanupStatus: WorktreeCleanupStatus | null;
  cleanupError: string | null;
  cleanupStartedAt: number | null;
  cleanupFinishedAt: number | null;
  exists: boolean;
  inUseBy: string[];
  retryable: boolean;
  owned: boolean;
  ownershipReason: string;
  safety: {
    status: "not_checked" | "blocked";
    summary: string;
  };
}

interface WorktreeCleanupRoutesDeps {
  launcher: RouteContext["launcher"];
  pathExists: RouteContext["pathExists"];
  pendingWorktreeCleanups: Map<string, Promise<void>>;
  queueArchivedWorktreeCleanup: (
    sessionId: string,
    options?: { archiveBranch?: boolean; force?: boolean },
  ) => { status: WorktreeCleanupStatus; path?: string } | undefined;
  resolveId: RouteContext["resolveId"];
  worktreeTracker: RouteContext["worktreeTracker"];
}

function isUnderPath(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!!rel && !rel.startsWith("..") && !rel.startsWith("/"));
}

function ownershipReason(input: { hasMapping: boolean; worktreePath: string }): string | null {
  if (input.hasMapping) return "tracker";
  if (isUnderPath(input.worktreePath, WORKTREES_BASE)) return "takode-worktree-root";
  return null;
}

function safetySummary(candidate: WorktreeCleanupCandidate): WorktreeCleanupCandidate["safety"] {
  if (!candidate.owned) return { status: "blocked", summary: "ownership not verified" };
  if (candidate.inUseBy.length > 0) return { status: "blocked", summary: "worktree is mapped to another session" };
  if (!candidate.exists) return { status: "blocked", summary: "worktree path is already gone" };
  if (candidate.cleanupStatus === "pending") return { status: "blocked", summary: "cleanup is already pending" };
  return { status: "not_checked", summary: "dirty/ahead safety checked on retry" };
}

function normalizeSafetyForResponse(safety: WorktreeCleanupSafety): WorktreeCleanupSafety & { summary: string } {
  return {
    ...safety,
    summary: safety.status === "safe" ? "safe to retry cleanup" : safety.reason || "cleanup safety check failed",
  };
}

async function buildCandidate(
  deps: WorktreeCleanupRoutesDeps,
  session: ReturnType<RouteContext["launcher"]["listSessions"]>[number],
): Promise<WorktreeCleanupCandidate | null> {
  if (!session.archived || !session.isWorktree || !session.repoRoot || !session.branch || !session.cwd) return null;

  if (session.worktreeCleanupStatus === "pending" && !deps.pendingWorktreeCleanups.has(session.sessionId)) {
    deps.launcher.setWorktreeCleanupState(session.sessionId, {
      status: "failed",
      error: session.worktreeCleanupError || "Cleanup was interrupted before completion.",
      startedAt: session.worktreeCleanupStartedAt,
      finishedAt: Date.now(),
    });
    session = deps.launcher.getSession(session.sessionId) ?? session;
  }

  const mapping = deps.worktreeTracker.getBySession(session.sessionId);
  const worktreePath = mapping?.worktreePath ?? session.cwd;
  const reason = ownershipReason({ hasMapping: !!mapping, worktreePath });
  if (!reason) return null;
  const repoRoot = mapping?.repoRoot ?? session.repoRoot;
  const branch = mapping?.branch ?? session.branch;
  if (!repoRoot || !branch) return null;

  const trackerUsers = deps.worktreeTracker
    .getSessionsForWorktree(worktreePath)
    .map((entry) => entry.sessionId)
    .filter((id) => id !== session.sessionId);
  const activeUsers = deps.launcher
    .listSessions()
    .filter((other) => other.sessionId !== session.sessionId && !other.archived && other.cwd === worktreePath)
    .map((other) => other.sessionId);
  const inUseBy = [...new Set([...trackerUsers, ...activeUsers])];
  const exists = await deps.pathExists(worktreePath);

  const candidate: WorktreeCleanupCandidate = {
    sessionId: session.sessionId,
    sessionNum: deps.launcher.getSessionNum(session.sessionId) ?? null,
    name: session.name ?? null,
    archivedAt: session.archivedAt ?? null,
    repoRoot,
    branch,
    actualBranch: mapping?.actualBranch ?? session.actualBranch ?? null,
    worktreePath,
    cleanupStatus: session.worktreeCleanupStatus ?? null,
    cleanupError: session.worktreeCleanupError ?? null,
    cleanupStartedAt: session.worktreeCleanupStartedAt ?? null,
    cleanupFinishedAt: session.worktreeCleanupFinishedAt ?? null,
    exists,
    inUseBy,
    retryable: false,
    owned: true,
    ownershipReason: reason,
    safety: { status: "not_checked", summary: "dirty/ahead safety checked on retry" },
  };
  candidate.safety = safetySummary(candidate);
  candidate.retryable = candidate.exists && candidate.inUseBy.length === 0 && candidate.cleanupStatus !== "pending";
  return candidate;
}

async function listCandidates(deps: WorktreeCleanupRoutesDeps): Promise<WorktreeCleanupCandidate[]> {
  const candidates = await Promise.all(deps.launcher.listSessions().map((session) => buildCandidate(deps, session)));
  return candidates
    .filter((candidate): candidate is WorktreeCleanupCandidate => candidate !== null)
    .sort((a, b) => {
      const statusRank = (candidate: WorktreeCleanupCandidate) =>
        candidate.retryable ? 0 : candidate.exists ? 1 : candidate.cleanupStatus === "failed" ? 2 : 3;
      return statusRank(a) - statusRank(b) || (b.archivedAt ?? 0) - (a.archivedAt ?? 0);
    });
}

export function registerWorktreeCleanupRoutes(api: Hono, deps: WorktreeCleanupRoutesDeps) {
  api.get("/worktree-cleanup/candidates", async (c) => {
    const includeAll = c.req.query("all") === "1" || c.req.query("all") === "true";
    const candidates = await listCandidates(deps);
    return c.json({ candidates: includeAll ? candidates : candidates.filter((candidate) => candidate.exists) });
  });

  api.post("/worktree-cleanup/:id/retry", async (c) => {
    const sessionId = deps.resolveId(c.req.param("id"));
    if (!sessionId) return c.json({ error: "Session not found" }, 404);

    const session = deps.launcher.getSession(sessionId);
    if (!session) return c.json({ error: "Session not found" }, 404);

    const candidate = await buildCandidate(deps, session);
    if (!candidate) return c.json({ error: "Known archived worktree cleanup candidate not found" }, 404);
    if (!candidate.owned) return c.json({ error: "Worktree ownership could not be verified", candidate }, 409);
    if (candidate.inUseBy.length > 0) {
      return c.json({ error: "Worktree is mapped to another session", candidate }, 409);
    }
    if (candidate.cleanupStatus === "pending" && deps.pendingWorktreeCleanups.has(sessionId)) {
      return c.json({ error: "Worktree cleanup is already pending", candidate }, 409);
    }

    const target = resolveWorktreeCleanupTarget(sessionId, deps.launcher, deps.worktreeTracker);
    if (!target) return c.json({ error: "Worktree cleanup target could not be resolved", candidate }, 404);

    if (candidate.exists) {
      const safety = await assessWorktreeCleanupSafety(target);
      if (safety.status !== "safe") {
        return c.json(
          {
            error: safety.reason || "Worktree cleanup safety check failed",
            candidate,
            safety: normalizeSafetyForResponse(safety),
          },
          409,
        );
      }
    }

    const queued = deps.queueArchivedWorktreeCleanup(sessionId, { archiveBranch: true, force: false });
    if (!queued) return c.json({ error: "Worktree cleanup target could not be queued", candidate }, 404);
    const updatedSession = deps.launcher.getSession(sessionId);
    const updated = updatedSession ? await buildCandidate(deps, updatedSession) : null;
    return c.json({
      ok: true,
      cleanup: queued,
      candidate: updated ?? candidate,
      safety: normalizeSafetyForResponse({ status: "safe", dirty: false, committedAhead: 0 }),
    });
  });
}
