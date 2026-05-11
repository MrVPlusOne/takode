import type { Hono } from "hono";
import { resolve } from "node:path";
import { containerManager } from "../container-manager.js";
import * as gitUtils from "../git-utils.js";
import { expandTilde } from "../path-resolver.js";
import { cleanupWorktree } from "./worktree-cleanup.js";
import type { RouteContext } from "./context.js";

type ReplacementCreateBody = Record<string, unknown>;

interface RecycledWorktreeInfo {
  isWorktree: true;
  repoRoot: string;
  branch: string;
  actualBranch: string;
  worktreePath: string;
  defaultBranch: string;
}

interface ReplacementSessionResult {
  sessionId: string;
}

interface SessionReplacementRoutesDeps {
  authenticateTakodeCaller: RouteContext["authenticateTakodeCaller"];
  createSessionFromBody: (
    body: ReplacementCreateBody,
    recycledWorktreeInfo?: RecycledWorktreeInfo,
  ) => Promise<ReplacementSessionResult>;
  launcher: RouteContext["launcher"];
  prPoller?: RouteContext["prPoller"];
  resolveId: RouteContext["resolveId"];
  sessionStore: RouteContext["sessionStore"];
  timerManager?: RouteContext["timerManager"];
  worktreeTracker: RouteContext["worktreeTracker"];
  wsBridge: RouteContext["wsBridge"];
}

interface ReplaceableWorker {
  sessionId: string;
  sessionNum?: number;
  name?: string;
  cwd: string;
  repoRoot: string;
  branch: string;
  actualBranch: string;
  memorySessionSpaceSlug?: string;
}

interface ReplacementTarget {
  worker: ReplaceableWorker;
  baseBranch: string;
  baseSha: string;
  intendedDefaultBranch: string;
}

interface ReplacementRecoveryResult {
  oldSessionRestored: boolean;
  relaunch?: { ok: boolean; error?: string };
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getCreateBody(raw: unknown): ReplacementCreateBody {
  if (!isRecord(raw)) return {};
  const nested = raw.create;
  return isRecord(nested) ? { ...nested } : { ...raw };
}

function displaySessionId(session: ReplaceableWorker): string {
  return session.sessionNum !== undefined ? `#${session.sessionNum}` : session.sessionId.slice(0, 8);
}

async function validateReplacementTarget(
  deps: SessionReplacementRoutesDeps,
  oldSessionId: string,
  leaderSessionId: string,
  createBody: ReplacementCreateBody,
): Promise<ReplacementTarget | Response> {
  const worker = deps.launcher.getSession(oldSessionId);
  if (!worker) return Response.json({ error: "Session not found" }, { status: 404 });
  if (worker.archived) return Response.json({ error: "Cannot replace an archived session" }, { status: 409 });
  if (worker.isOrchestrator) return Response.json({ error: "Cannot replace a leader session" }, { status: 400 });
  if (worker.reviewerOf !== undefined) {
    return Response.json(
      { error: "Cannot replace reviewer sessions with worktree-worker replacement" },
      { status: 400 },
    );
  }
  if (worker.herdedBy !== leaderSessionId) {
    return Response.json({ error: "Only the leader who herded this worker can replace it" }, { status: 403 });
  }
  if (!worker.isWorktree || !worker.repoRoot || !worker.branch || !worker.actualBranch || !worker.cwd) {
    return Response.json({ error: "Replacement requires a worktree-backed worker session" }, { status: 400 });
  }
  if (worker.worktreeCleanupStatus === "pending") {
    return Response.json({ error: "Cannot replace a worker while worktree cleanup is pending" }, { status: 409 });
  }
  if (createBody.useWorktree === false) {
    return Response.json({ error: "--replace-worktree-worker cannot be combined with --no-worktree" }, { status: 400 });
  }
  if (createBody.reviewerOf !== undefined) {
    return Response.json({ error: "--replace-worktree-worker cannot be combined with --reviewer" }, { status: 400 });
  }
  if (createBody.role === "orchestrator" || createBody.assistantMode === true) {
    return Response.json({ error: "Replacement mode can only spawn worker sessions" }, { status: 400 });
  }

  const intendedCwd =
    typeof createBody.cwd === "string" && createBody.cwd.trim()
      ? resolve(expandTilde(createBody.cwd.trim()))
      : worker.repoRoot;
  const intendedRepo = await gitUtils.getRepoInfoAsync(intendedCwd);
  if (!intendedRepo) {
    return Response.json({ error: "Replacement target cwd must be inside a git repository" }, { status: 400 });
  }

  const requestedBranch =
    typeof createBody.branch === "string" && createBody.branch.trim() ? createBody.branch.trim() : undefined;
  const intendedBaseBranch =
    requestedBranch || (intendedRepo.isWorktree ? intendedRepo.defaultBranch : intendedRepo.currentBranch);
  if (intendedRepo.repoRoot !== worker.repoRoot) {
    return Response.json(
      { error: "Replacement worker must be in the same repository as the requested spawn cwd" },
      { status: 400 },
    );
  }
  if (intendedBaseBranch !== worker.branch) {
    return Response.json(
      {
        error: `Replacement worker base branch mismatch: worker uses ${worker.branch}, requested spawn uses ${intendedBaseBranch}`,
      },
      { status: 400 },
    );
  }

  if (deps.worktreeTracker.isWorktreeInUse(worker.cwd, oldSessionId)) {
    return Response.json({ error: "Replacement worktree is still mapped to another active session" }, { status: 409 });
  }

  const worktreeRepo = await gitUtils.getRepoInfoAsync(worker.cwd);
  if (!worktreeRepo?.isWorktree || worktreeRepo.repoRoot !== worker.repoRoot) {
    return Response.json({ error: "Replacement worker cwd is no longer the expected git worktree" }, { status: 400 });
  }
  if (worktreeRepo.currentBranch !== worker.actualBranch) {
    return Response.json(
      {
        error: `Replacement worker branch mismatch: expected ${worker.actualBranch}, found ${worktreeRepo.currentBranch}`,
      },
      { status: 400 },
    );
  }

  if (await gitUtils.isWorktreeDirtyAsync(worker.cwd)) {
    return Response.json({ error: "Replacement worktree has uncommitted changes" }, { status: 409 });
  }

  const baseRef = `refs/heads/${worker.branch}`;
  const actualRef = `refs/heads/${worker.actualBranch}`;
  const baseSha = await gitUtils.resolveRefAsync(worker.repoRoot, baseRef);
  if (!baseSha) {
    return Response.json({ error: `Base branch not found: ${worker.branch}` }, { status: 400 });
  }
  const actualSha = await gitUtils.resolveRefAsync(worker.repoRoot, actualRef);
  if (!actualSha) {
    return Response.json({ error: `Worktree branch not found: ${worker.actualBranch}` }, { status: 400 });
  }

  const committedAhead = await gitUtils.countCommitsBetweenAsync(worker.repoRoot, baseRef, actualRef);
  if (committedAhead > 0) {
    return Response.json(
      { error: `Replacement worktree has ${committedAhead} committed change(s) ahead of ${worker.branch}` },
      { status: 409 },
    );
  }

  return {
    worker: {
      sessionId: worker.sessionId,
      sessionNum: worker.sessionNum,
      name: worker.name,
      cwd: worker.cwd,
      repoRoot: worker.repoRoot,
      branch: worker.branch,
      actualBranch: worker.actualBranch,
      memorySessionSpaceSlug: worker.memorySessionSpaceSlug,
    },
    baseBranch: worker.branch,
    baseSha,
    intendedDefaultBranch: intendedRepo.defaultBranch,
  };
}

async function archiveReplacedWorker(
  deps: SessionReplacementRoutesDeps,
  worker: ReplaceableWorker,
  leaderSessionId: string,
): Promise<void> {
  deps.wsBridge.emitTakodeEvent(worker.sessionId, "session_archived", { archive_source: "leader" }, leaderSessionId);
  await deps.launcher.kill(worker.sessionId);
  containerManager.removeContainer(worker.sessionId);
  deps.prPoller?.unwatch(worker.sessionId);
  deps.worktreeTracker.removeBySession(worker.sessionId);
  deps.launcher.setArchived(worker.sessionId, true);
  await deps.sessionStore.setArchived(worker.sessionId, true);
  if (deps.timerManager) {
    void deps.timerManager.cancelAllTimers(worker.sessionId);
  }

  if (worker.sessionNum === undefined) return;
  for (const session of deps.launcher.listSessions()) {
    if (session.reviewerOf !== worker.sessionNum || session.archived) continue;
    await deps.launcher.kill(session.sessionId);
    containerManager.removeContainer(session.sessionId);
    const mapping = deps.worktreeTracker.getBySession(session.sessionId);
    if (mapping) {
      await cleanupWorktree(mapping, deps.worktreeTracker, true, { archiveBranch: true });
    } else {
      deps.worktreeTracker.removeBySession(session.sessionId);
    }
    deps.launcher.setArchived(session.sessionId, true);
    await deps.sessionStore.setArchived(session.sessionId, true);
    if (session.herdedBy) {
      deps.wsBridge.emitTakodeEvent(session.sessionId, "session_archived", { archive_source: "cascade" });
    }
  }
}

async function restoreReplacedWorker(
  deps: SessionReplacementRoutesDeps,
  worker: ReplaceableWorker,
): Promise<ReplacementRecoveryResult> {
  try {
    deps.worktreeTracker.addMapping({
      sessionId: worker.sessionId,
      repoRoot: worker.repoRoot,
      branch: worker.branch,
      actualBranch: worker.actualBranch,
      worktreePath: worker.cwd,
      createdAt: Date.now(),
    });
    deps.launcher.setArchived(worker.sessionId, false);
    await deps.sessionStore.setArchived(worker.sessionId, false);
    const relaunch = await deps.launcher.relaunch(worker.sessionId);
    return { oldSessionRestored: relaunch.ok, relaunch };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { oldSessionRestored: false, error: message };
  }
}

export function registerSessionReplacementRoutes(api: Hono, deps: SessionReplacementRoutesDeps) {
  api.post("/sessions/:id/replace-worktree-worker", async (c) => {
    const auth = deps.authenticateTakodeCaller(c, { requireOrchestrator: true });
    if ("response" in auth) return auth.response;

    const oldSessionId = deps.resolveId(c.req.param("id"));
    if (!oldSessionId) return c.json({ error: "Session not found" }, 404);

    const body = await c.req.json().catch(() => ({}));
    const createBody = getCreateBody(body);
    const validation = await validateReplacementTarget(deps, oldSessionId, auth.callerId, createBody);
    if (validation instanceof Response) return validation;

    const { worker, baseBranch, baseSha, intendedDefaultBranch } = validation;
    try {
      await archiveReplacedWorker(deps, worker, auth.callerId);

      const resetOutput = await gitUtils.resetWorktreeToRefAsync(worker.cwd, `refs/heads/${baseBranch}`);
      const replacementBody: ReplacementCreateBody = {
        ...createBody,
        cwd: worker.cwd,
        useWorktree: false,
        createdBy: auth.callerId,
        memorySessionSpaceSlug:
          typeof createBody.memorySessionSpaceSlug === "string"
            ? createBody.memorySessionSpaceSlug
            : worker.memorySessionSpaceSlug,
      };
      delete replacementBody.branch;

      const newSession = await deps.createSessionFromBody(replacementBody, {
        isWorktree: true,
        repoRoot: worker.repoRoot,
        branch: baseBranch,
        actualBranch: worker.actualBranch,
        worktreePath: worker.cwd,
        defaultBranch: intendedDefaultBranch,
      });

      return c.json({
        ok: true,
        oldSessionId: worker.sessionId,
        oldSessionNum: worker.sessionNum ?? null,
        oldSessionName: worker.name ?? null,
        oldSessionLabel: displaySessionId(worker),
        newSessionId: newSession.sessionId,
        recycledPath: worker.cwd,
        repoRoot: worker.repoRoot,
        baseBranch,
        baseSha,
        reset: { ok: true, output: resetOutput || null },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const recovery = await restoreReplacedWorker(deps, worker);
      return c.json(
        {
          error: `Failed to replace worktree worker after preflight: ${message}`,
          recovery,
        },
        500,
      );
    }
  });
}
