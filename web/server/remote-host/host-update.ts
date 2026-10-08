import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Exit code with which a `takode node` worker asks its supervisor to start it again on the updated checkout. */
export const NODE_RESTART_EXIT_CODE = 75;

const COMMIT = /^[0-9a-f]{40}$/;

/**
 * Git commit of the Takode checkout at `dir`, or null when it is not a Git
 * checkout (e.g. a packaged install). Coordinator and hosts compare these to
 * tell whether they run the same build; read it once at startup, since the
 * checkout can move on while the process keeps running the code it loaded.
 */
export async function readCheckoutCommit(dir: string): Promise<string | null> {
  try {
    const commit = (await git(dir, "rev-parse", "HEAD")).trim();
    return COMMIT.test(commit) ? commit : null;
  } catch {
    return null;
  }
}

/** The first characters of a commit, for display. */
export function shortCommit(commit: string): string {
  return commit.slice(0, 8);
}

/**
 * Switch the Takode checkout containing `packageRoot` to exactly `commit` and
 * install its dependencies, so the next start of `takode node` runs that build.
 *
 * Refuses a checkout with uncommitted changes to tracked files, so local work is
 * never overwritten. A commit the checkout lacks is fetched from its default
 * remote. The checkout is left detached at the commit; any branch it was on is
 * untouched. If the install fails, the previous checkout is restored.
 */
export async function switchCheckoutToCommit(
  packageRoot: string,
  commit: string,
  install: (packageRoot: string) => Promise<void> = frozenInstall,
): Promise<void> {
  if (!COMMIT.test(commit)) throw new Error(`Not a full commit id: ${commit}`);
  const changes = (await git(packageRoot, "status", "--porcelain", "--untracked-files=no")).trim();
  if (changes) {
    throw new Error("The Takode checkout has uncommitted changes to tracked files; commit or discard them first");
  }
  if (!(await hasCommit(packageRoot, commit))) {
    await git(packageRoot, "fetch", "--quiet").catch((error) => {
      throw new Error(`Could not fetch ${shortCommit(commit)}: ${errorMessage(error)}`);
    });
    if (!(await hasCommit(packageRoot, commit))) {
      throw new Error(`Commit ${shortCommit(commit)} is not available from this checkout's remote; push it first`);
    }
  }
  const branch = (await git(packageRoot, "symbolic-ref", "--short", "-q", "HEAD").catch(() => "")).trim();
  const previous = branch || (await git(packageRoot, "rev-parse", "HEAD")).trim();
  await git(packageRoot, "checkout", "--quiet", "--detach", commit);
  try {
    await install(packageRoot);
  } catch (error) {
    await git(packageRoot, "checkout", "--quiet", previous);
    await install(packageRoot).catch(() => {});
    throw new Error(`Dependency install failed, so the checkout stays on its previous commit: ${errorMessage(error)}`);
  }
}

async function hasCommit(dir: string, commit: string): Promise<boolean> {
  return git(dir, "cat-file", "-e", `${commit}^{commit}`).then(
    () => true,
    () => false,
  );
}

async function frozenInstall(packageRoot: string): Promise<void> {
  await execFileAsync(process.execPath, ["install", "--frozen-lockfile"], {
    cwd: packageRoot,
    timeout: 10 * 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
}

async function git(dir: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", ["--no-optional-locks", ...args], { cwd: dir, encoding: "utf-8" });
  return stdout;
}

function errorMessage(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
}
