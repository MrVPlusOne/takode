import type { QuestmasterTask } from "../quest-types.js";
import { normalizeCommitShas } from "../quest-store-helpers.js";
import type { SessionState } from "../session-types.js";
import type { SdkSessionInfo } from "../session-info.js";
import { checkoutCommitsLanded } from "../bridge/session-git-state.js";

/**
 * Whether the worker's commits ahead of its comparison target are already delivered under other
 * commit IDs: landed on the target by the landing queue, or on a published branch head that one of
 * the worker's recorded deliveries for this quest was verified on (an approved delivery target, used
 * when the branch is chosen after the work or for a clean PR branch). Commits whose content is on
 * none of them, such as unpublished leftovers, keep the checkout ahead.
 */
export async function workerCommitsLanded(
  state: Parameters<typeof checkoutCommitsLanded>[0],
  quest: QuestmasterTask,
  workerSessionId: string,
): Promise<boolean> {
  if (await checkoutCommitsLanded(state)) return true;
  const heads = (quest.codeDeliveries ?? [])
    .filter((delivery) => delivery.actorSessionId === workerSessionId)
    .flatMap((delivery) => delivery.target.publication?.refs.map((ref) => ref.sha) ?? []);
  for (const head of new Set(heads)) if (await checkoutCommitsLanded(state, head)) return true;
  return false;
}

/** Git-state and commit-evidence checks of v2 final Memory completion. */
export function hasServerAuthorizedLocalCompletionTarget(
  state: Partial<SessionState> | undefined,
  launcherSession: Pick<SdkSessionInfo, "isWorktree" | "worktreePortTarget"> | undefined,
): boolean {
  const target = launcherSession?.worktreePortTarget;
  return (
    state?.is_worktree === true &&
    launcherSession?.isWorktree === true &&
    typeof target?.repoRoot === "string" &&
    target.repoRoot.trim().length > 0 &&
    typeof target.branch === "string" &&
    target.branch.trim().length > 0 &&
    typeof target.worktreePath === "string" &&
    target.worktreePath.trim().length > 0
  );
}

export function validateV2CompletionGitState(
  state: Partial<SessionState> | undefined,
  storedCodeCommitShas: string[] | undefined,
  options: {
    localOnly?: boolean;
    /**
     * The checkout's commits ahead of its target are already on it under other IDs (the landing
     * queue rebased them, `checkoutCommitsLanded`): nothing is unsynced, ahead or behind.
     */
    commitsLanded?: boolean;
  } = {},
): string | undefined {
  if (!state) return "Cannot verify worker git state for v2 Memory completion.";
  if (!options.localOnly && !options.commitsLanded) {
    const comparisonTarget = (state.diff_base_branch || state.git_default_branch || "").trim();
    if (!comparisonTarget) {
      return "Worker git comparison target is uncertain; refresh or sync before completion.";
    }
    if (!Number.isFinite(state.git_ahead) || !Number.isFinite(state.git_behind)) {
      return "Worker git sync state is uncertain; refresh before completion.";
    }
    if (state.git_ahead !== 0) {
      return "Worker checkout is ahead of its comparison target; sync/Port before completion.";
    }
    if (state.git_behind !== 0) {
      return "Worker checkout is behind its comparison target; refresh or sync before completion.";
    }
  }
  if (state.git_status_refresh_error) return `Worker git state is uncertain: ${state.git_status_refresh_error}`;
  if (state.diff_stats_skipped_reason)
    return `Worker tracked-change state is uncertain: ${state.diff_stats_skipped_reason}`;
  const changedLines = (state.total_lines_added ?? 0) + (state.total_lines_removed ?? 0);
  if (changedLines > 0 && (storedCodeCommitShas?.length ?? 0) === 0) {
    return "Worker has tracked project changes but Work -> Memory did not record code commit metadata.";
  }
  return undefined;
}

export function validateV2CompletionCodeCommitSubmission(
  currentQuest: QuestmasterTask,
  submittedCommitShas: unknown,
): { error: string; status: 400 | 409 } | undefined {
  if (submittedCommitShas === undefined) return undefined;
  if (!Array.isArray(submittedCommitShas)) {
    return { error: "commitShas must be an array when provided.", status: 400 };
  }

  let normalizedSubmitted: string[];
  try {
    normalizedSubmitted = normalizeCommitShas(submittedCommitShas);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invalid commitShas.", status: 400 };
  }
  const stored = new Set((currentQuest.commitShas ?? []).map((sha) => sha.toLowerCase()));
  const newlyIntroduced = normalizedSubmitted.filter((sha) => !stored.has(sha));
  if (newlyIntroduced.length > 0) {
    return {
      error:
        "v2 final Memory cannot attach new code commit SHAs; record synchronized target commits during Work -> Memory.",
      status: 409,
    };
  }
  return undefined;
}
