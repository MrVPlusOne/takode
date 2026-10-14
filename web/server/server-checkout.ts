import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 10_000;
const FETCH_TIMEOUT_MS = 30_000;
/** How long a status read with a fetch stays fresh for Settings views. */
const STATUS_CACHE_MS = 60_000;
/** Longer ranges list only their newest commits, with the full count. */
const MAX_LISTED_CHANGES = 200;

/**
 * Where the server's own checkout stands against the branch it tracks.
 *
 * - `not-git`: the server does not run from a Git checkout (e.g. a package install)
 * - `detached`: HEAD is not on a branch
 * - `no-upstream`: the branch tracks no remote branch
 * - `current` / `behind` / `ahead` / `diverged`: compared with the upstream branch
 */
export type ServerCheckoutState = "not-git" | "detached" | "no-upstream" | "current" | "behind" | "ahead" | "diverged";

export interface ServerCheckoutStatus {
  state: ServerCheckoutState;
  /** Commit the running server loaded at startup; null when unknown. */
  runningCommit: string | null;
  /** Commit the checkout is at now, which the next restart loads. */
  head: string | null;
  branch: string | null;
  /** The tracked branch, e.g. `origin/main`. */
  upstream: string | null;
  upstreamHead: string | null;
  /** Commits on the upstream branch that the checkout lacks. */
  behind: number;
  /** Local commits not on the upstream branch. */
  ahead: number;
  /** Uncommitted changes to tracked files. */
  localChanges: boolean;
  /** Why the upstream branch could not be fetched; the comparison then uses the last fetched state. */
  fetchError: string | null;
  checkedAt: number;
}

/** What a restart did to the checkout before loading it. */
export interface ServerCheckoutUpdate {
  /** `updated`: fast-forwarded; `unchanged`: left as it was (see `status`); `failed`: the fast-forward failed. */
  action: "updated" | "unchanged" | "failed";
  /** Commit before the fast-forward, when it moved. */
  from: string | null;
  error: string | null;
  /** The checkout after the attempt. */
  status: ServerCheckoutStatus;
}

/** One commit, as the Restart section lists it. */
export interface ServerChange {
  sha: string;
  subject: string;
  /** Committer time: when the commit reached the branch (landings cherry-pick onto it). */
  committedAt: number;
  /** The quest that recorded the commit as delivered, filled in by the route. */
  questId?: string | null;
}

/** The newest commits of a range, newest first, and how many the range has in all. */
export interface ServerChangeList {
  changes: ServerChange[];
  total: number;
}

/** The build the server ran before the current one. */
export interface PreviousServerBuild {
  commit: string;
  /** When the current build replaced it. */
  replacedAt: number;
}

export interface ServerChanges {
  /** Commits Restart Server would load that the running server lacks. */
  incoming: ServerChangeList;
  /** Commits the current build added to the previous one; null when that build is unknown. */
  currentBuild: (ServerChangeList & PreviousServerBuild) | null;
}

export interface ServerCheckout {
  /** Status with a fresh fetch, cached briefly unless `refresh` is set. */
  status(options?: { refresh?: boolean }): Promise<ServerCheckoutStatus>;
  /** The commits behind `status`: what a restart would load, and what the current build brought in. */
  changes(status: ServerCheckoutStatus): Promise<ServerChanges>;
  /**
   * Fetch and fast-forward a clean checkout that is only behind its branch, so
   * the restart loads the code that reached the branch. Never touches a checkout
   * with uncommitted changes to tracked files, local commits, or no branch.
   */
  updateBeforeRestart(): Promise<ServerCheckoutUpdate>;
}

/**
 * The checkout the server runs from. Git operations run one at a time, so a
 * Settings status read and a restart never fetch concurrently.
 */
export function createServerCheckout(options: {
  dir: string;
  runningCommit: string | null;
  /** From `rememberServerBuild` at startup. */
  previousBuild?: PreviousServerBuild | null;
  now?: () => number;
}): ServerCheckout {
  const { dir, runningCommit, previousBuild = null } = options;
  const now = options.now ?? Date.now;
  let queue: Promise<unknown> = Promise.resolve();
  let cached: ServerCheckoutStatus | null = null;

  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = queue.then(operation, operation);
    queue = result.catch(() => {});
    return result;
  }

  async function freshStatus(): Promise<ServerCheckoutStatus> {
    cached = await readServerCheckoutStatus(dir, { runningCommit, fetch: true, now });
    return cached;
  }

  return {
    status: ({ refresh = false } = {}) =>
      serialized(async () => {
        if (!refresh && cached && now() - cached.checkedAt < STATUS_CACHE_MS) return cached;
        return freshStatus();
      }),
    changes: async (status) => {
      const loaded = status.runningCommit ?? status.head;
      // Mirrors updateBeforeRestart: only a clean checkout that is only behind is fast-forwarded.
      const restartLoads = status.state === "behind" && !status.localChanges ? status.upstreamHead : status.head;
      const [incoming, current] = await Promise.all([
        loaded && restartLoads ? readChangeList(dir, loaded, restartLoads) : null,
        previousBuild && runningCommit ? readChangeList(dir, previousBuild.commit, runningCommit) : null,
      ]);
      return {
        incoming: incoming ?? { changes: [], total: 0 },
        currentBuild: current && previousBuild ? { ...previousBuild, ...current } : null,
      };
    },
    updateBeforeRestart: () =>
      serialized(async () => {
        const before = await freshStatus();
        if (before.state !== "behind" || before.localChanges) {
          return { action: "unchanged", from: null, error: null, status: before };
        }
        try {
          await git(dir, ["merge", "--quiet", "--ff-only", "@{upstream}"]);
        } catch (error) {
          return { action: "failed", from: null, error: errorMessage(error), status: before };
        }
        const after = await readServerCheckoutStatus(dir, { runningCommit, fetch: false, now });
        cached = { ...after, fetchError: before.fetchError };
        return { action: "updated", from: before.head, error: null, status: cached };
      }),
  };
}

/** Read where the checkout at `dir` stands, optionally fetching its upstream branch first. */
export async function readServerCheckoutStatus(
  dir: string,
  options: { runningCommit: string | null; fetch: boolean; now?: () => number },
): Promise<ServerCheckoutStatus> {
  const status: ServerCheckoutStatus = {
    state: "not-git",
    runningCommit: options.runningCommit,
    head: null,
    branch: null,
    upstream: null,
    upstreamHead: null,
    behind: 0,
    ahead: 0,
    localChanges: false,
    fetchError: null,
    checkedAt: (options.now ?? Date.now)(),
  };
  const head = await gitOrNull(dir, ["rev-parse", "--verify", "-q", "HEAD"]);
  if (!head) return status;
  status.head = head;
  status.localChanges = (await git(dir, ["status", "--porcelain", "--untracked-files=no"])) !== "";
  status.branch = await gitOrNull(dir, ["symbolic-ref", "--short", "-q", "HEAD"]);
  if (!status.branch) return { ...status, state: "detached" };
  status.upstream = await gitOrNull(dir, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  if (!status.upstream) return { ...status, state: "no-upstream" };

  if (options.fetch) status.fetchError = await fetchUpstream(dir, status.branch);
  status.upstreamHead = await gitOrNull(dir, ["rev-parse", "--verify", "-q", "@{upstream}"]);
  const counts = await gitOrNull(dir, ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
  const [ahead, behind] = (counts ?? "0 0").split(/\s+/).map((value) => Number.parseInt(value, 10) || 0);
  status.ahead = ahead;
  status.behind = behind;
  status.state = ahead > 0 && behind > 0 ? "diverged" : behind > 0 ? "behind" : ahead > 0 ? "ahead" : "current";
  return status;
}

/**
 * Record the build this server loaded in `file` and return the one it ran
 * before. Restarting onto the same commit keeps the earlier record, so the
 * Restart section keeps showing what the current build brought in.
 */
export async function rememberServerBuild(
  file: string,
  runningCommit: string | null,
  now = Date.now(),
): Promise<PreviousServerBuild | null> {
  let stored: { commit?: unknown; previous?: PreviousServerBuild | null } = {};
  try {
    stored = JSON.parse(await readFile(file, "utf-8")) ?? {};
  } catch (error: any) {
    if (error?.code !== "ENOENT") console.warn("[server-checkout] Could not read the previous server build:", error);
  }
  const previous = stored.previous ?? null;
  if (!runningCommit || stored.commit === runningCommit) return previous;
  const replaced = typeof stored.commit === "string" ? { commit: stored.commit, replacedAt: now } : null;
  await writeFile(file, JSON.stringify({ commit: runningCommit, previous: replaced }, null, 2), "utf-8");
  return replaced;
}

/** Commits in `to` that `from` lacks, newest first; null when Git cannot compare them. */
async function readChangeList(dir: string, from: string, to: string): Promise<ServerChangeList | null> {
  if (from === to) return { changes: [], total: 0 };
  const range = `${from}..${to}`;
  try {
    const [log, total] = await Promise.all([
      git(dir, ["log", "--no-merges", `--max-count=${MAX_LISTED_CHANGES}`, "--format=%H%x1f%ct%x1f%s", range]),
      git(dir, ["rev-list", "--no-merges", "--count", range]),
    ]);
    const changes = log
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [sha, seconds, subject] = line.split("\x1f");
        return { sha, subject, committedAt: Number(seconds) * 1000 };
      });
    return { changes, total: Number.parseInt(total, 10) || changes.length };
  } catch (error) {
    console.warn(`[server-checkout] Could not list the commits ${range}:`, errorMessage(error));
    return null;
  }
}

/** Fetch only the branch's upstream; returns the error, or null when it worked or needs no fetch. */
async function fetchUpstream(dir: string, branch: string): Promise<string | null> {
  const remote = await gitOrNull(dir, ["config", `branch.${branch}.remote`]);
  const merge = await gitOrNull(dir, ["config", `branch.${branch}.merge`]);
  if (!remote || !merge || remote === ".") return null;
  try {
    // Fetching the merge ref also updates its remote-tracking branch.
    await git(dir, ["fetch", "--quiet", remote, merge], FETCH_TIMEOUT_MS);
    return null;
  } catch (error) {
    return errorMessage(error);
  }
}

async function git(dir: string, args: string[], timeout = GIT_TIMEOUT_MS): Promise<string> {
  const { stdout } = await execFileAsync("git", ["--no-optional-locks", ...args], {
    cwd: dir,
    encoding: "utf-8",
    timeout,
    // A fetch must fail rather than wait for credentials nobody will type.
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return stdout.trim();
}

async function gitOrNull(dir: string, args: string[]): Promise<string | null> {
  try {
    return (await git(dir, args)) || null;
  } catch {
    return null;
  }
}

function errorMessage(error: unknown): string {
  const stderr = (error as { stderr?: unknown }).stderr;
  if (typeof stderr === "string" && stderr.trim()) return stderr.trim();
  return error instanceof Error ? error.message : String(error);
}
