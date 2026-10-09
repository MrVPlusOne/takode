import { git } from "./landing-git.js";

/** What the server answers when final Memory completed before the quest's change landed. */
export interface LandingParked {
  entryId: string;
  outcome: string;
  branch: string;
  tip: string;
}

/**
 * Tell the worker its quest now waits in Landing, and hand its worktree back:
 * when the worktree is exactly the submitted change, reset it to the remote
 * branch so the worker can take other work (the queue keeps the commits).
 */
export async function reportLandingParked(questId: string, parked: LandingParked, cwd = process.cwd()): Promise<void> {
  const bounced = parked.outcome === "bounced" || parked.outcome === "withdrawn";
  console.log(
    bounced
      ? `Final Memory for ${questId} is recorded. Its change ${parked.outcome === "bounced" ? "bounced" : "was withdrawn"}, so the quest stays open in Landing and your leader decides who fixes it and when.`
      : `Final Memory for ${questId} is recorded. The quest waits in Landing for its change (${parked.entryId}); Takode completes it when the change lands. You are done with this quest.`,
  );
  if (bounced) return;
  const head = await git(cwd, ["rev-parse", "HEAD"]).catch(() => "");
  const dirty = await git(cwd, ["status", "--porcelain", "--untracked-files=no"]).catch(() => "unknown");
  if (head !== parked.tip || dirty) {
    console.log(
      `Your worktree is not exactly the submitted change, so it was left as is. Before other work, reset it to origin/${parked.branch}; the queue keeps the submitted commits.`,
    );
    return;
  }
  try {
    await git(cwd, ["fetch", "--quiet", "origin", parked.branch]);
    await git(cwd, ["reset", "--quiet", "--hard", `origin/${parked.branch}`]);
    console.log(
      `Reset your worktree to origin/${parked.branch}; the queue keeps the submitted commits (\`takode land resume ${parked.entryId}\` brings them back if it bounces).`,
    );
  } catch (error) {
    console.log(`Could not reset your worktree to origin/${parked.branch}: ${(error as Error).message}`);
  }
}
