import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isAncestor, readCommitSummary, readGit, resolveCommit } from "./git-commit-reader.js";
import { projectQuestDelivery, type CommitRange, type QuestCodeDelivery } from "../shared/quest-delivery.js";

const MAX_RANGE_COMMITS = 200;

/** Verify an explicit Git range against an authoritative recorded tip, without writing evidence. */
export async function resolveDeliveryRange(
  delivery: QuestCodeDelivery,
  authoritativeShas: readonly string[],
  selection: CommitRange,
): Promise<{ range: CommitRange; commitShas: string[] }> {
  const cwd = delivery.target.repoRoot;
  const baseSha = await resolveCommit(cwd, selection.baseSha);
  const tipSha = await resolveCommit(cwd, selection.tipSha);
  if (!delivery.commits.some((commit) => commit.sha === tipSha) || !authoritativeShas.includes(tipSha)) {
    throw new Error("Range tip must be an authoritative commit in this recorded delivery.");
  }
  if (baseSha === tipSha) throw new Error("Choose a non-empty base..tip range.");
  const ancestor = await readGit(cwd, ["--no-replace-objects", "merge-base", baseSha, tipSha]);
  if (ancestor !== baseSha) throw new Error("Range base must be an ancestor of its recorded tip.");
  const output = await readGit(cwd, [
    "--no-replace-objects",
    "rev-list",
    "--reverse",
    "--topo-order",
    `--max-count=${MAX_RANGE_COMMITS + 1}`,
    `${baseSha}..${tipSha}`,
    "--",
  ]);
  const commitShas = output.split("\n").filter(Boolean);
  if (commitShas.length > MAX_RANGE_COMMITS) {
    throw new Error(`Range exceeds ${MAX_RANGE_COMMITS} commits; choose a narrower explicit range.`);
  }
  // A shallow side branch can hide ancestors even when the base is reachable on another parent.
  const shallowPath = resolve(cwd, await readGit(cwd, ["rev-parse", "--git-path", "shallow"]));
  const shallow = await readFile(shallowPath, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "";
    throw error;
  });
  for (const boundary of shallow.trim().split("\n").filter(Boolean)) {
    // Exclusions also need complete ancestry: a shallow base can include old side-branch commits by mistake.
    if (commitShas.includes(boundary) || (await isAncestor(cwd, boundary, baseSha)))
      throw new Error("Range history is incomplete at a shallow boundary.");
  }
  return { range: { baseSha, tipSha }, commitShas };
}

/** Load bounded per-commit comparisons for a verified range; never infer aggregate totals. */
export async function readDeliveryRange(
  questId: string,
  delivery: QuestCodeDelivery,
  authoritativeShas: readonly string[],
  selection: CommitRange,
) {
  const { range, commitShas } = await resolveDeliveryRange(delivery, authoritativeShas, selection);
  const commits = [];
  for (const sha of commitShas) {
    commits.push({ ...(await readCommitSummary(delivery.target.repoRoot, sha)), reviewCount: 0 });
  }
  return { ...projectQuestDelivery(questId, delivery), commits, earlierReviewCount: 0, range };
}
