import { canonicalWorktreePath } from "./auxiliary-worktrees.js";
import type { AuxiliaryWorktreeRegistration } from "./auxiliary-worktree-registry.js";
import type { WorktreeMapping } from "./worktree-tracker.js";

/** Receipt captured only after Takode successfully creates a new branch. */
export interface CreatedWorktreeBranch {
  name: string;
  initialTip: string;
}

export interface WorktreeBranchUse {
  sessionId: string;
  cwd?: string;
  archived?: boolean;
  isOrchestrator?: boolean;
  repoRoot?: string;
  branch?: string;
  actualBranch?: string;
  worktreePortTarget?: { repoRoot: string; branch: string };
}

async function git(cwd: string, args: string[], input?: string): Promise<string> {
  const { execFile } = await import("node:child_process");
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (
      /^GIT_(DIR|WORK_TREE|COMMON_DIR|INDEX_FILE|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|NAMESPACE|PREFIX)$/.test(
        key,
      )
    )
      delete env[key];
  }
  return new Promise((resolve, reject) => {
    const child = execFile(
      "git",
      ["--no-optional-locks", "-c", "core.fsmonitor=false", "-C", cwd, ...args],
      { env, timeout: 30_000, maxBuffer: 4 * 1024 * 1024, encoding: "utf8" },
      (error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
    );
    child.stdin?.end(input);
  });
}

export async function captureCreatedWorktreeBranch(path: string, name: string): Promise<CreatedWorktreeBranch> {
  if ((await git(path, ["symbolic-ref", "HEAD"])) !== `refs/heads/${name}`) {
    throw new Error("Created worktree branch changed before ownership could be recorded");
  }
  return { name, initialTip: await git(path, ["rev-parse", "--verify", "HEAD^{commit}"]) };
}

/** Save the recovery tip and delete exactly the observed branch tip in one ref transaction. */
export async function archiveOwnedWorktreeBranch(repoRoot: string, name: string, expectedTip: string): Promise<void> {
  await git(repoRoot, ["check-ref-format", `refs/heads/${name}`]);
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(expectedTip)) throw new Error("Invalid branch tip");
  await git(
    repoRoot,
    ["update-ref", "--stdin"],
    `start\ncreate refs/companion/archived/${name} ${expectedTip}\ndelete refs/heads/${name} ${expectedTip}\nprepare\ncommit\n`,
  );
}

/** Retention vetoes do not prevent removal of the original disposable checkout. */
export async function retireDisposableWorktreeBranch(
  target: WorktreeMapping,
  primaryUsers: WorktreeBranchUse[],
  auxiliary: AuxiliaryWorktreeRegistration[],
): Promise<void> {
  const proof = target.disposableBranch;
  if (
    !proof ||
    typeof proof.name !== "string" ||
    typeof proof.initialTip !== "string" ||
    proof.name !== target.actualBranch ||
    proof.name === target.branch ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(proof.initialTip)
  )
    return;
  const name = proof.name;
  const repo = await canonicalWorktreePath(target.repoRoot);
  for (const user of primaryUsers) {
    if (user.sessionId === target.sessionId && user.isOrchestrator) return;
    if (
      user.sessionId !== target.sessionId &&
      user.repoRoot &&
      (await canonicalWorktreePath(user.repoRoot)) === repo &&
      (user.branch === name || user.actualBranch === name)
    )
      return;
    if (
      user.worktreePortTarget?.branch === name &&
      (await canonicalWorktreePath(user.worktreePortTarget.repoRoot)) === repo
    )
      return;
  }
  for (const record of auxiliary) {
    if (
      (await canonicalWorktreePath(record.repoRoot)) === repo &&
      (record.branch === name || record.baseBranch === name)
    )
      return;
  }
  await git(repo, ["check-ref-format", `refs/heads/${name}`]);
  try {
    if ((await git(repo, ["config", "--bool", "--get", `branch.${name}.takodeRetain`])) !== "false") return;
  } catch (error) {
    if ((error as { code?: number }).code !== 1) throw error;
  }
  // An upstream or known published branch is not exclusively disposable.
  if (await git(repo, ["for-each-ref", "--format=%(upstream)", `refs/heads/${name}`])) return;
  const remoteRefs = await git(repo, ["for-each-ref", "--format=%(refname)", "refs/remotes/"]);
  if (remoteRefs.split("\n").some((ref) => ref.endsWith(`/${name}`))) return;
  const worktrees = await git(repo, ["worktree", "list", "--porcelain", "-z"]);
  if (worktrees.split("\0").includes(`branch refs/heads/${name}`)) return;
  const refs = await git(repo, ["for-each-ref", "--format=%(refname) %(objectname)", `refs/heads/${name}`]);
  const tip = refs
    .split("\n")
    .find((line) => line.startsWith(`refs/heads/${name} `))
    ?.split(" ")[1];
  if (!tip) return; // Already retired; do not turn an archive retry into failure.
  try {
    await git(repo, ["merge-base", "--is-ancestor", proof.initialTip, tip]);
  } catch (error) {
    if ((error as { code?: number }).code === 1) return;
    throw error;
  }
  await archiveOwnedWorktreeBranch(repo, name, tip);
}
