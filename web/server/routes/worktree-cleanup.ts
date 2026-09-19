import { canonicalWorktreePath, pathsOverlap, type AuxiliaryWorktreeLifecycle } from "../auxiliary-worktrees.js";
import * as gitUtils from "../git-utils.js";
import type { WorktreeMapping, WorktreeTracker } from "../worktree-tracker.js";
import { retireDisposableWorktreeBranch, type WorktreeBranchUse } from "../worktree-branch-retirement.js";
import type { AuxiliaryWorktreeRegistration } from "../auxiliary-worktree-registry.js";

export type WorktreeCleanupStatus = "pending" | "done" | "failed";
export type WorktreeCleanupResult = { cleaned?: boolean; dirty?: boolean; path?: string; reason?: string } | undefined;
export type WorktreeCleanupSafetyStatus = "safe" | "blocked";
export interface WorktreeCleanupSafety {
  status: WorktreeCleanupSafetyStatus;
  reason?: string;
  dirty?: boolean;
  committedAhead?: number;
}

interface WorktreeSessionInfo {
  sessionId: string;
  cwd: string;
  isWorktree?: boolean;
  repoRoot?: string;
  branch?: string;
  actualBranch?: string;
  disposableBranch?: WorktreeMapping["disposableBranch"];
}

interface WorktreeCleanupLauncher {
  listSessions?(): WorktreeBranchUse[];
  getSession(sessionId: string): WorktreeSessionInfo | undefined;
  setWorktreeCleanupState(
    sessionId: string,
    updates: {
      status?: WorktreeCleanupStatus;
      error?: string;
      startedAt?: number;
      finishedAt?: number;
    },
  ): void;
}

interface ArchivedWorktreeCleanupDeps {
  launcher: WorktreeCleanupLauncher;
  pendingWorktreeCleanups: Map<string, Promise<void>>;
  worktreeTracker: WorktreeTracker;
  logger?: Pick<Console, "error" | "log">;
  auxiliary?: AuxiliaryWorktreeLifecycle;
}

type WorktreeCleanupTarget = WorktreeMapping;

function withCleanupContext(
  reason: string | undefined,
  target: WorktreeCleanupTarget,
  options: { force: boolean },
): string | undefined {
  if (!reason) return undefined;
  return `Worktree cleanup failed (force=${options.force}, repoRoot=${target.repoRoot}, worktreePath=${target.worktreePath}, branch=${target.branch}, actualBranch=${target.actualBranch ?? "none"}): ${reason}`;
}

export function resolveWorktreeCleanupTarget(
  sessionId: string,
  launcher: WorktreeCleanupLauncher,
  worktreeTracker: WorktreeTracker,
): WorktreeCleanupTarget | null {
  const mapping = worktreeTracker.getBySession(sessionId);
  if (mapping) return mapping;

  const session = launcher.getSession(sessionId);
  if (!session?.isWorktree || !session.repoRoot || !session.branch || !session.cwd) return null;

  return {
    sessionId,
    repoRoot: session.repoRoot,
    branch: session.branch,
    actualBranch: session.actualBranch,
    disposableBranch: session.disposableBranch,
    worktreePath: session.cwd,
    createdAt: Date.now(),
  };
}

export async function cleanupWorktree(
  target: WorktreeCleanupTarget,
  worktreeTracker: WorktreeTracker,
  force?: boolean,
  options?: { archiveOwnedBranch?: boolean; branchUsers?: () => WorktreeBranchUse[] },
): Promise<WorktreeCleanupResult> {
  const remove = async (registrations: AuxiliaryWorktreeRegistration[] = []): Promise<WorktreeCleanupResult> => {
    if (worktreeTracker.isWorktreeInUse(target.worktreePath, target.sessionId)) {
      worktreeTracker.removeBySession(target.sessionId);
      return { cleaned: false, path: target.worktreePath };
    }
    const dirty = await gitUtils.isWorktreeDirtyAsync(target.worktreePath);
    if (dirty && !force) return { cleaned: false, dirty: true, path: target.worktreePath };
    const shouldForceRemove = Boolean(force || dirty);
    // Original archive force-removal remains independent of branch retention.
    const result = await gitUtils.removeWorktreeAsync(target.repoRoot, target.worktreePath, {
      force: shouldForceRemove,
    });
    let branchError: string | undefined;
    if (result.removed && options?.archiveOwnedBranch && target.disposableBranch) {
      try {
        const users = [
          ...worktreeTracker.load(true),
          ...(options.branchUsers?.() ?? []).filter((user) => !user.archived || user.sessionId === target.sessionId),
        ];
        await retireDisposableWorktreeBranch(target, users, registrations);
      } catch (error) {
        // Keep the branch on any uncertainty, without leaving the environment behind.
        branchError = `Checkout removed; branch cleanup failed: ${error instanceof Error ? error.message : String(error)}`;
      }
    }
    if (result.removed) worktreeTracker.removeBySession(target.sessionId);
    return {
      cleaned: result.removed,
      path: target.worktreePath,
      reason: branchError ?? withCleanupContext(result.reason, target, { force: shouldForceRemove }),
    };
  };
  if (!worktreeTracker.auxiliary) return remove();
  return worktreeTracker.auxiliary.update(async (records) => {
    const canonicalPath = await canonicalWorktreePath(target.worktreePath);
    const mappings = worktreeTracker.load(true);
    const users = [
      ...mappings.map((mapping) => ({ sessionId: mapping.sessionId, cwd: mapping.worktreePath })),
      ...(options?.branchUsers?.() ?? []).filter((user) => !user.archived),
    ];
    for (const user of users) {
      if (
        user.sessionId !== target.sessionId &&
        user.cwd &&
        (await canonicalWorktreePath(user.cwd)) === canonicalPath
      ) {
        worktreeTracker.removeBySession(target.sessionId);
        return { cleaned: false, path: target.worktreePath };
      }
    }
    if (records.some((record) => record.cleanupStatus !== "done" && pathsOverlap(record.worktreePath, canonicalPath))) {
      return {
        cleaned: false,
        path: target.worktreePath,
        reason: "Worktree has auxiliary ownership or retention registrations",
      };
    }
    return remove(records);
  });
}

export async function assessWorktreeCleanupSafety(target: WorktreeCleanupTarget): Promise<WorktreeCleanupSafety> {
  const dirty = await gitUtils.isWorktreeDirtyAsync(target.worktreePath);
  if (dirty) {
    return { status: "blocked", reason: "Worktree has uncommitted changes", dirty: true };
  }

  const baseRef = `refs/heads/${target.branch}`;
  const baseSha = await gitUtils.resolveRefAsync(target.repoRoot, baseRef);
  if (!baseSha) {
    return { status: "blocked", reason: `Base branch not found: ${target.branch}` };
  }

  const headSha = await gitUtils.resolveRefAsync(target.worktreePath, "HEAD");
  if (!headSha) {
    return { status: "blocked", reason: "Worktree HEAD could not be resolved" };
  }

  const committedAhead = await gitUtils.countCommitsBetweenAsync(target.repoRoot, baseRef, headSha);
  if (committedAhead > 0) {
    return {
      status: "blocked",
      reason: `Worktree has ${committedAhead} committed change(s) ahead of ${target.branch}`,
      committedAhead,
    };
  }

  return { status: "safe", dirty: false, committedAhead: 0 };
}

export function createArchivedWorktreeCleanupQueue(deps: ArchivedWorktreeCleanupDeps) {
  const { launcher, pendingWorktreeCleanups, worktreeTracker, logger = console } = deps;

  return (
    sessionId: string,
    options?: { force?: boolean; auxiliaryOnly?: boolean },
  ): { status: WorktreeCleanupStatus; path?: string } | undefined => {
    const target = options?.auxiliaryOnly ? null : resolveWorktreeCleanupTarget(sessionId, launcher, worktreeTracker);
    if (!target && !deps.auxiliary) return undefined;

    if (pendingWorktreeCleanups.has(sessionId)) {
      return { status: "pending", path: target?.worktreePath };
    }

    const startedAt = Date.now();
    launcher.setWorktreeCleanupState(sessionId, {
      status: "pending",
      error: undefined,
      startedAt,
      finishedAt: undefined,
    });

    const task = (async () => {
      try {
        const auxiliary = await deps.auxiliary?.cleanup(sessionId);
        const result = target
          ? await cleanupWorktree(target, worktreeTracker, options?.force ?? true, {
              archiveOwnedBranch: true,
              branchUsers: () => launcher.listSessions?.() ?? [],
            })
          : undefined;
        const blocked = auxiliary?.filter(
          (record) => record.retention === "temporary" && record.cleanupStatus !== "done",
        );
        const error =
          [result?.reason, ...(blocked ?? []).map((record) => `${record.worktreePath}: ${record.cleanupReason}`)]
            .filter(Boolean)
            .join("; ") || undefined;
        const finishedAt = Date.now();
        const cleanupStatus: WorktreeCleanupStatus = error ? "failed" : "done";
        launcher.setWorktreeCleanupState(sessionId, {
          status: cleanupStatus,
          error,
          startedAt,
          finishedAt,
        });
        if (result?.path) {
          const message = `[routes] Archived worktree cleanup ${cleanupStatus} for ${sessionId}: ${result.path}${
            result.reason ? ` (${result.reason})` : ""
          }`;
          if (cleanupStatus === "failed") {
            logger.error(message);
          } else {
            logger.log(message);
          }
        }
      } catch (e) {
        const finishedAt = Date.now();
        const error = e instanceof Error ? e.message : String(e);
        launcher.setWorktreeCleanupState(sessionId, {
          status: "failed",
          error,
          startedAt,
          finishedAt,
        });
        logger.error(`[routes] Archived worktree cleanup failed for ${sessionId}:`, e);
      } finally {
        pendingWorktreeCleanups.delete(sessionId);
      }
    })();

    pendingWorktreeCleanups.set(sessionId, task);
    void task;
    return { status: "pending", path: target?.worktreePath };
  };
}
