import * as gitUtils from "../git-utils.js";
import type { CreationStepId } from "../session-types.js";
import { withProgressHeartbeat } from "./progress-heartbeat.js";
import type { SessionPreparationStatus } from "./sessions-helpers.js";

type CreationProgressStatus = "in_progress" | "done" | "error";
type EmitCreationProgress = (
  step: CreationStepId,
  label: string,
  status: CreationProgressStatus,
  detail?: string,
) => Promise<void>;

type ThrowPreparationError = (message: string, status: SessionPreparationStatus, step?: CreationStepId) => never;

export interface WorktreeSessionInfo {
  isWorktree: boolean;
  repoRoot: string;
  branch: string;
  actualBranch: string;
  worktreePath: string;
  defaultBranch: string;
  portTarget?: {
    repoRoot: string;
    branch: string;
    sourceSessionId?: string;
    sourceSessionNum?: number | null;
    sourceLabel?: string;
  };
}

export async function prepareWorktreeForSessionCreate(options: {
  body: Record<string, any>;
  cwd: string | undefined;
  isOrchestrator: boolean;
  emit: EmitCreationProgress;
  throwPreparationError: ThrowPreparationError;
}): Promise<{ cwd: string; worktreeInfo: WorktreeSessionInfo } | null> {
  const { body, cwd, isOrchestrator, emit, throwPreparationError: fail } = options;
  if (body.useWorktree !== true) return null;

  if (body.branch && !/^[a-zA-Z0-9/_.\-]+$/.test(body.branch)) {
    fail("Invalid branch name", 400, "checkout_branch");
  }
  const worktreeCwd = cwd;
  if (!worktreeCwd) {
    return fail("Worktree mode requires a cwd", 400, "creating_worktree");
  }

  await emit("creating_worktree", "Creating worktree...", "in_progress");
  const maybeRepoInfo = await gitUtils.getRepoInfoAsync(worktreeCwd);
  if (!maybeRepoInfo) {
    return fail("Worktree mode requires a git repository", 400, "creating_worktree");
  }
  const repoInfo = maybeRepoInfo;

  // Always create the isolated worktree from the main repo root. When the
  // requested cwd is itself a worktree, the current branch is still the
  // user-visible source of truth; falling back to the parent/default branch
  // would silently lose the leader/worktree target context.
  const targetBranch = body.branch || repoInfo.currentBranch;
  if (!targetBranch) {
    fail("Unable to determine branch for worktree session", 400, "creating_worktree");
  }

  const requestedPortTarget =
    body.worktreePortTarget && typeof body.worktreePortTarget === "object"
      ? (body.worktreePortTarget as Record<string, unknown>)
      : null;
  const requestedPortTargetBranch =
    typeof requestedPortTarget?.branch === "string" && requestedPortTarget.branch.trim()
      ? requestedPortTarget.branch.trim()
      : undefined;
  const portTargetRepoRoot =
    typeof requestedPortTarget?.repoRoot === "string" && requestedPortTarget.repoRoot.trim()
      ? requestedPortTarget.repoRoot.trim()
      : repoInfo.repoRoot;

  const result = await withProgressHeartbeat(
    emit,
    {
      step: "creating_worktree",
      label: "Creating worktree...",
      detail: `Still preparing ${targetBranch}...`,
    },
    () =>
      gitUtils.ensureWorktreeAsync(repoInfo.repoRoot, targetBranch, {
        baseBranch: repoInfo.defaultBranch,
        createBranch: body.createBranch,
        forceNew: true,
      }),
  );

  await emit("creating_worktree", "Worktree ready", "done");
  return {
    cwd: result.worktreePath,
    worktreeInfo: {
      isWorktree: true,
      repoRoot: repoInfo.repoRoot,
      branch: targetBranch,
      actualBranch: result.actualBranch,
      worktreePath: result.worktreePath,
      defaultBranch: repoInfo.defaultBranch,
      portTarget: {
        repoRoot: portTargetRepoRoot,
        branch: requestedPortTargetBranch ?? (isOrchestrator ? result.actualBranch : targetBranch),
        ...(typeof requestedPortTarget?.sourceSessionId === "string" && requestedPortTarget.sourceSessionId.trim()
          ? { sourceSessionId: requestedPortTarget.sourceSessionId.trim() }
          : {}),
        ...(typeof requestedPortTarget?.sourceSessionNum === "number"
          ? { sourceSessionNum: requestedPortTarget.sourceSessionNum }
          : {}),
        ...(typeof requestedPortTarget?.sourceLabel === "string" && requestedPortTarget.sourceLabel.trim()
          ? { sourceLabel: requestedPortTarget.sourceLabel.trim() }
          : {}),
      },
    },
  };
}
