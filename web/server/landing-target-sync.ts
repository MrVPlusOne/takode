import { gitAsync } from "./git-utils.js";

/** Quote one argument for the shell command line gitAsync runs. */
function quote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  return gitAsync(`merge-base --is-ancestor ${quote(ancestor)} ${quote(descendant)}`, cwd).then(
    () => true,
    () => false,
  );
}

/**
 * Bring a machine's base checkout up to the remote branch after a landing:
 * fetch, then fast-forward when it is a clean checkout of the branch.
 * Recording the landed commits as Work evidence reads this checkout. Throws
 * with what is in the way otherwise.
 */
export async function syncBaseCheckoutToRemote(input: {
  checkoutPath: string;
  branch: string;
  tip: string;
}): Promise<void> {
  const { checkoutPath, branch, tip } = input;
  const remoteRef = `refs/remotes/origin/${branch}`;
  await gitAsync(`fetch --quiet origin ${quote(`+refs/heads/${branch}:${remoteRef}`)}`, checkoutPath);
  if (!(await isAncestor(checkoutPath, tip, remoteRef)))
    throw new Error(`origin/${branch} does not contain ${tip} yet.`);
  if (await isAncestor(checkoutPath, tip, "HEAD")) return;
  const current = await gitAsync("symbolic-ref --short HEAD", checkoutPath).catch(() => "");
  const dirty = await gitAsync("--no-optional-locks status --porcelain --untracked-files=no", checkoutPath);
  if (current !== branch || dirty || !(await isAncestor(checkoutPath, "HEAD", remoteRef)))
    throw new Error(
      `The base checkout ${checkoutPath} is not a clean checkout of ${branch} behind origin/${branch}; fast-forward it to origin/${branch}.`,
    );
  await gitAsync(`merge --quiet --ff-only ${quote(remoteRef)}`, checkoutPath);
}
