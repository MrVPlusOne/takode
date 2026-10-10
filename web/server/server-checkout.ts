import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { checkoutUpdateBlocker } from "./server-checkout-policy.js";

const execFileAsync = promisify(execFile);

const GIT_TIMEOUT_MS = 10_000;
const FETCH_TIMEOUT_MS = 30_000;
/** How long a status read with a fetch stays fresh for Settings views. */
const STATUS_CACHE_MS = 60_000;

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
  /**
   * `updated`: fast-forwarded, then dependencies installed; `unchanged`: already
   * current (dependencies installed) or not a Git checkout; `blocked`: the
   * checkout could not be brought up to date, so the restart must not go ahead
   * (see `error`).
   */
  action: "updated" | "unchanged" | "blocked";
  /** Commit before the fast-forward, when it moved. */
  from: string | null;
  /** Why the restart is blocked, as a sentence saying what to do. */
  error: string | null;
  /** The checkout after the attempt. */
  status: ServerCheckoutStatus;
}

export interface ServerCheckout {
  /** Status with a fresh fetch, cached briefly unless `refresh` is set. */
  status(options?: { refresh?: boolean }): Promise<ServerCheckoutStatus>;
  /**
   * Bring the checkout up to date with its branch before a restart: fetch,
   * fast-forward when behind, then install dependencies from the lockfile.
   * Blocks instead of touching a checkout that cannot simply follow its branch
   * (uncommitted changes to tracked files, local commits, no branch or upstream)
   * or when the fetch fails, so the restart never silently loads older code.
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
  /** Installs dependencies from the lockfile; throws with the reason when it fails. */
  installDependencies: () => Promise<void>;
  now?: () => number;
}): ServerCheckout {
  const { dir, runningCommit, installDependencies } = options;
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
    updateBeforeRestart: () =>
      serialized(async (): Promise<ServerCheckoutUpdate> => {
        const before = await freshStatus();
        // A package install has no Git checkout to follow; its package manager updates it.
        if (before.state === "not-git") return { action: "unchanged", from: null, error: null, status: before };
        const blocker = checkoutUpdateBlocker(before);
        if (blocker) return { action: "blocked", from: null, error: blocker, status: before };

        let status = before;
        let from: string | null = null;
        if (before.state === "behind") {
          try {
            await git(dir, ["merge", "--quiet", "--ff-only", "@{upstream}"]);
          } catch (error) {
            return {
              action: "blocked",
              from: null,
              error: `Could not fast-forward the server checkout (${before.branch}) to ${before.upstream}: ${errorMessage(error)}`,
              status: before,
            };
          }
          from = before.head;
          status = { ...(await readServerCheckoutStatus(dir, { runningCommit, fetch: false, now })), fetchError: null };
          cached = status;
        }

        try {
          // A landed dependency change must not block the restart's load check.
          await installDependencies();
        } catch (error) {
          const moved = from ? ` after fast-forwarding the server checkout to ${shortCommit(status.head)}` : "";
          return {
            action: "blocked",
            from,
            error: `Installing dependencies failed${moved}: ${errorMessage(error)}`,
            status,
          };
        }
        return { action: from ? "updated" : "unchanged", from, error: null, status };
      }),
  };
}

function shortCommit(commit: string | null): string {
  return commit ? commit.slice(0, 8) : "unknown";
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
