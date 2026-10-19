import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    const commit = (await git(dir, ["rev-parse", "HEAD"])).trim();
    return COMMIT.test(commit) ? commit : null;
  } catch {
    return null;
  }
}

/** The first characters of a commit, for display. */
export function shortCommit(commit: string): string {
  return commit.slice(0, 8);
}

/** How a host's checkout answers when asked to get ready for an update (`prepare_update`). */
export type UpdatePreparation = { ready: true } | { ready: false; haves: string[] };

/**
 * Get the Takode checkout containing `packageRoot` ready to switch to
 * `commit`, without changing what it has checked out or runs, so a host can
 * fail an update before its sessions are stopped for it.
 *
 * It refuses a checkout with uncommitted changes to tracked files, which the
 * switch would refuse too. A commit the checkout lacks is fetched from its
 * default remote; one that exists only on the coordinator (never pushed)
 * comes as `bundle` from {@link createUpdateBundle}, which is checked and
 * imported here. Without a bundle, a commit still missing is answered with
 * the commits the checkout has, from which the coordinator builds one.
 */
export async function prepareCheckoutForCommit(
  packageRoot: string,
  commit: string,
  bundle: Buffer | null,
): Promise<UpdatePreparation> {
  if (!COMMIT.test(commit)) throw new Error(`Not a full commit id: ${commit}`);
  await refuseUncommittedChanges(packageRoot);
  if (bundle) {
    await importUpdateBundle(packageRoot, bundle);
    if (!(await hasCommit(packageRoot, commit))) {
      throw new Error(`The Git objects the coordinator sent do not contain ${shortCommit(commit)}`);
    }
    return { ready: true };
  }
  if (await hasCommit(packageRoot, commit)) return { ready: true };
  // Unreachable or lacking the commit: the coordinator can send it instead.
  await git(packageRoot, ["fetch", "--quiet"], FETCH_TIMEOUT_MS).catch(() => {});
  if (await hasCommit(packageRoot, commit)) return { ready: true };
  return { ready: false, haves: await commitsWeHave(packageRoot) };
}

/**
 * A Git bundle of `commit` from the coordinator's checkout at `repoDir`,
 * holding only what a host lacks: everything not reachable from the host's
 * `hostHaves` that this checkout also has. A host whose checkout shares no
 * commit with this one is refused rather than sent the whole history.
 */
export async function createUpdateBundle(repoDir: string, commit: string, hostHaves: string[]): Promise<Buffer> {
  if (!COMMIT.test(commit)) throw new Error(`Not a full commit id: ${commit}`);
  const shared = await commitsKnownTo(
    repoDir,
    hostHaves.filter((have) => COMMIT.test(have)),
  );
  if (shared.length === 0) {
    throw new Error(
      "The host's Takode checkout shares no commit with the coordinator's; push the commit or update the host by hand",
    );
  }
  // A bundle names its tips by ref, so the commit gets one (overwritten by the next update).
  await git(repoDir, ["update-ref", UPDATE_REF, commit]);
  const dir = await mkdtemp(join(tmpdir(), "takode-host-update-"));
  try {
    const file = join(dir, "update.bundle");
    await git(repoDir, ["bundle", "create", "--quiet", file, UPDATE_REF, "--not", ...shared]);
    const data = await readFile(file);
    if (data.length > MAX_UPDATE_BUNDLE_BYTES) {
      throw new Error(
        `The commits the host lacks take ${Math.ceil(data.length / 1024 / 1024)} MB, more than the ${MAX_UPDATE_BUNDLE_BYTES / 1024 / 1024} MB sent over the host link; push the commit or update the host by hand`,
      );
    }
    return data;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/**
 * Switch the Takode checkout containing `packageRoot` to exactly `commit` and
 * install its dependencies, so the next start of `takode node` runs that build.
 *
 * Refuses a checkout with uncommitted changes to tracked files, so local work is
 * never overwritten. A commit the checkout lacks is fetched from its default
 * remote; one prepared with {@link prepareCheckoutForCommit} is already there.
 * The checkout is left detached at the commit; any branch it was on is
 * untouched. If the install fails, the previous checkout is restored.
 */
export async function switchCheckoutToCommit(
  packageRoot: string,
  commit: string,
  install: (packageRoot: string) => Promise<void> = frozenInstall,
): Promise<void> {
  if (!COMMIT.test(commit)) throw new Error(`Not a full commit id: ${commit}`);
  await refuseUncommittedChanges(packageRoot);
  if (!(await hasCommit(packageRoot, commit))) {
    await git(packageRoot, ["fetch", "--quiet"], FETCH_TIMEOUT_MS).catch((error) => {
      throw new Error(`Could not fetch ${shortCommit(commit)}: ${errorMessage(error)}`);
    });
    if (!(await hasCommit(packageRoot, commit))) {
      throw new Error(`Commit ${shortCommit(commit)} is not available from this checkout's remote; push it first`);
    }
  }
  const branch = (await git(packageRoot, ["symbolic-ref", "--short", "-q", "HEAD"]).catch(() => "")).trim();
  const previous = branch || (await git(packageRoot, ["rev-parse", "HEAD"])).trim();
  await git(packageRoot, ["checkout", "--quiet", "--detach", commit]);
  try {
    await install(packageRoot);
  } catch (error) {
    await git(packageRoot, ["checkout", "--quiet", previous]);
    await install(packageRoot).catch(() => {});
    throw new Error(`Dependency install failed, so the checkout stays on its previous commit: ${errorMessage(error)}`);
  }
}

/** Where both sides keep an update's commit: the coordinator to name it in a bundle, a host to keep what it imported. */
const UPDATE_REF = "refs/takode/host-update";

/**
 * The most a host update sends over the host link. Commits a coordinator runs
 * without pushing are normally a few; the whole Takode history is larger.
 */
const MAX_UPDATE_BUNDLE_BYTES = 32 * 1024 * 1024;

/** How many of its newest branch tips a host offers as commits it has. */
const MAX_HAVES = 200;

async function refuseUncommittedChanges(packageRoot: string): Promise<void> {
  const changes = (await git(packageRoot, ["status", "--porcelain", "--untracked-files=no"])).trim();
  if (changes) {
    throw new Error("The Takode checkout has uncommitted changes to tracked files; commit or discard them first");
  }
}

/** Check a bundle against this checkout (it has the commits the bundle builds on) and import its commit under {@link UPDATE_REF}. */
async function importUpdateBundle(packageRoot: string, bundle: Buffer): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "takode-host-update-"));
  try {
    const file = join(dir, "update.bundle");
    await writeFile(file, bundle);
    await git(packageRoot, ["bundle", "verify", "--quiet", file]).catch((error) => {
      throw new Error(`The Git objects the coordinator sent do not fit this checkout: ${errorMessage(error)}`);
    });
    await git(packageRoot, ["fetch", "--quiet", "--no-tags", file, `+${UPDATE_REF}:${UPDATE_REF}`]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** HEAD and the newest branch and remote-tracking branch tips, for the coordinator to leave out of a bundle. */
async function commitsWeHave(dir: string): Promise<string[]> {
  const tips = await git(dir, [
    "for-each-ref",
    "--sort=-committerdate",
    `--count=${MAX_HAVES}`,
    "--format=%(objectname)",
    "refs/heads",
    "refs/remotes",
  ]);
  const head = (await git(dir, ["rev-parse", "HEAD"])).trim();
  return [...new Set([head, ...tips.split("\n").filter((tip) => COMMIT.test(tip))])];
}

/** The ones of `commits` that the repo at `dir` has. */
async function commitsKnownTo(dir: string, commits: string[]): Promise<string[]> {
  if (commits.length === 0) return [];
  const pending = execFileAsync(
    "git",
    ["--no-optional-locks", "cat-file", "--batch-check=%(objectname) %(objecttype)"],
    {
      cwd: dir,
      encoding: "utf-8",
    },
  );
  pending.child.stdin?.end(`${commits.join("\n")}\n`);
  const { stdout } = await pending;
  return stdout
    .split("\n")
    .map((line) => line.split(" "))
    .filter(([sha, type]) => type === "commit" && COMMIT.test(sha ?? ""))
    .map(([sha]) => sha!);
}

async function hasCommit(dir: string, commit: string): Promise<boolean> {
  return git(dir, ["cat-file", "-e", `${commit}^{commit}`]).then(
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

/**
 * A fetch over a broken network can hang without end, and the node accepts no
 * other update while one runs.
 */
const FETCH_TIMEOUT_MS = 5 * 60_000;

async function git(dir: string, args: string[], timeoutMs?: number): Promise<string> {
  const { stdout } = await execFileAsync("git", ["--no-optional-locks", ...args], {
    cwd: dir,
    encoding: "utf-8",
    ...(timeoutMs ? { timeout: timeoutMs } : {}),
  });
  return stdout;
}

function errorMessage(error: unknown): string {
  if ((error as { killed?: boolean }).killed) return "it did not finish in time";
  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
}
