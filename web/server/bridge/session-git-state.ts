import { exec as execCb } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { GIT_STATUS_AUTO_REFRESH_STALE_MS } from "../../shared/git-status-freshness.js";
import { GIT_CMD_TIMEOUT, SERVER_GIT_CMD } from "../constants.js";
import * as gitUtils from "../git-utils.js";
import type { BackendType, SessionState } from "../session-types.js";

const execPromise = promisify(execCb);
const GIT_SHA_REF_RE = /^[0-9a-f]{7,40}$/i;
const DIFF_STATS_REFRESH_FAILED_ERROR = "Unable to refresh diff stats";
const DIFF_STATS_COMMIT_DIVERGENCE_LIMIT = 50;
const DIFF_STATS_TRACKED_DIRTY_LIMIT = 500;

interface AheadBehindCounts {
  ahead: number;
  behind: number;
}

interface ResolveGitInfoOptions {
  computeAheadBehind?: boolean;
}

async function resolveUpstreamRef(state: SessionState): Promise<string | null> {
  if (!state.cwd || !state.git_branch || state.git_branch === "HEAD" || state.is_worktree) return null;
  try {
    const { stdout } = await execPromise(
      `${SERVER_GIT_CMD} rev-parse --abbrev-ref --symbolic-full-name ${state.git_branch}@{upstream} 2>/dev/null`,
      { cwd: state.cwd, encoding: "utf-8", timeout: GIT_CMD_TIMEOUT },
    );
    const upstreamRef = stdout.trim();
    return upstreamRef || null;
  } catch {
    return null;
  }
}

export function makeDefaultState(sessionId: string, backendType: BackendType = "claude"): SessionState {
  return {
    session_id: sessionId,
    treeGroupId: "default",
    backend_type: backendType,
    backend_state: "disconnected",
    backend_error: null,
    model: "",
    cwd: "",
    tools: [],
    permissionMode: "default",
    claude_code_version: "",
    mcp_servers: [],
    agents: [],
    slash_commands: [],
    skills: [],
    skill_metadata: [],
    apps: [],
    total_cost_usd: 0,
    user_turn_count: 0,
    agent_turn_count: 0,
    num_turns: 0,
    context_used_percent: 0,
    codex_retained_payload_bytes: 0,
    is_compacting: false,
    git_branch: "",
    git_head_sha: "",
    git_default_branch: "",
    diff_base_branch: "",
    diff_base_branch_explicit: false,
    diff_base_start_sha: "",
    is_worktree: false,
    is_containerized: false,
    repo_root: "",
    git_ahead: 0,
    git_behind: 0,
    total_lines_added: 0,
    total_lines_removed: 0,
    diff_stats_skipped_reason: null,
    git_status_refreshed_at: undefined,
    git_status_refresh_error: null,
  };
}

function getGitComparisonRef(state: SessionState): string {
  return (state.diff_base_branch || state.git_default_branch || "").trim();
}

export function isDefaultMainComparisonRef(ref: string): boolean {
  const normalized = ref
    .trim()
    .replace(/^refs\/heads\//, "")
    .replace(/^refs\/remotes\//, "")
    .replace(/^remotes\//, "");
  if (normalized === "main" || normalized === "master") return true;
  const parts = normalized.split("/").filter(Boolean);
  return parts.length === 2 && (parts[1] === "main" || parts[1] === "master");
}

function getSharedAheadBehindKey(state: SessionState): string | null {
  if (!state.cwd) return null;
  const ref = getGitComparisonRef(state);
  if (!ref) return null;
  const repoKey = state.repo_root || state.cwd;
  const headKey = state.git_head_sha || state.git_branch || "HEAD";
  return [repoKey, ref, headKey].join("\0");
}

async function resolveMergeBaseRef(cwd: string, ref: string): Promise<string | null> {
  const key = [cwd, ref].join("\0");
  let computation = inFlightMergeBaseRefs.get(key);
  if (!computation) {
    computation = execPromise(`${SERVER_GIT_CMD} merge-base ${ref} HEAD`, {
      cwd,
      timeout: GIT_CMD_TIMEOUT,
    })
      .then(({ stdout }) => stdout.trim() || null)
      .catch(() => null)
      .finally(() => {
        if (inFlightMergeBaseRefs.get(key) === computation) {
          inFlightMergeBaseRefs.delete(key);
        }
      });
    inFlightMergeBaseRefs.set(key, computation);
  }
  return computation;
}

async function readAheadBehindCounts(cwd: string, ref: string): Promise<AheadBehindCounts> {
  try {
    const { stdout: countsOut } = await execPromise(
      `${SERVER_GIT_CMD} rev-list --left-right --count ${ref}...HEAD 2>/dev/null`,
      { cwd, encoding: "utf-8", timeout: GIT_CMD_TIMEOUT },
    );
    const [behind, ahead] = countsOut.trim().split(/\s+/).map(Number);
    return {
      ahead: ahead || 0,
      behind: behind || 0,
    };
  } catch {
    return { ahead: 0, behind: 0 };
  }
}

async function resolveAheadBehindDirect(state: SessionState): Promise<void> {
  const ref = getGitComparisonRef(state);
  if (!ref || !state.cwd) {
    state.git_ahead = 0;
    state.git_behind = 0;
    return;
  }
  const counts = await readAheadBehindCounts(state.cwd, ref);
  state.git_ahead = counts.ahead;
  state.git_behind = counts.behind;
}

export async function resolveGitInfo(state: SessionState, options: ResolveGitInfoOptions = {}): Promise<void> {
  if (!state.cwd) return;
  const computeAheadBehind = options.computeAheadBehind !== false;
  const wasContainerized = state.is_containerized;
  try {
    const { stdout: branchOut } = await execPromise(`${SERVER_GIT_CMD} rev-parse --abbrev-ref HEAD 2>/dev/null`, {
      cwd: state.cwd,
      encoding: "utf-8",
      timeout: GIT_CMD_TIMEOUT,
    });
    state.git_branch = branchOut.trim();
    try {
      const { stdout: headOut } = await execPromise(`${SERVER_GIT_CMD} rev-parse HEAD 2>/dev/null`, {
        cwd: state.cwd,
        encoding: "utf-8",
        timeout: GIT_CMD_TIMEOUT,
      });
      state.git_head_sha = headOut.trim();
    } catch {
      state.git_head_sha = "";
    }

    try {
      const { stdout: gitDirOut } = await execPromise(`${SERVER_GIT_CMD} rev-parse --git-dir 2>/dev/null`, {
        cwd: state.cwd,
        encoding: "utf-8",
        timeout: GIT_CMD_TIMEOUT,
      });
      state.is_worktree = gitDirOut.trim().includes("/worktrees/");
    } catch {
      state.is_worktree = false;
    }

    try {
      if (state.is_worktree) {
        const { stdout: commonDirOut } = await execPromise(`${SERVER_GIT_CMD} rev-parse --git-common-dir 2>/dev/null`, {
          cwd: state.cwd,
          encoding: "utf-8",
          timeout: GIT_CMD_TIMEOUT,
        });
        state.repo_root = resolve(state.cwd, commonDirOut.trim(), "..");
      } else {
        const { stdout: toplevelOut } = await execPromise(`${SERVER_GIT_CMD} rev-parse --show-toplevel 2>/dev/null`, {
          cwd: state.cwd,
          encoding: "utf-8",
          timeout: GIT_CMD_TIMEOUT,
        });
        state.repo_root = toplevelOut.trim();
      }
    } catch {
      /* ignore */
    }

    const upstreamRef = await resolveUpstreamRef(state);
    let legacyDefaultBranch: string | null = null;
    const getLegacyDefaultBranch = async () => {
      if (!legacyDefaultBranch) {
        legacyDefaultBranch = await gitUtils.resolveDefaultBranchAsync(state.repo_root || state.cwd, state.git_branch);
      }
      return legacyDefaultBranch;
    };

    if (upstreamRef) {
      state.git_default_branch = upstreamRef;
      if (!state.diff_base_branch_explicit) {
        if (!state.diff_base_branch) {
          state.diff_base_branch = upstreamRef;
        } else {
          const legacyDefault = await getLegacyDefaultBranch();
          if (state.diff_base_branch === legacyDefault) {
            state.diff_base_branch = upstreamRef;
          }
        }
      }
    } else {
      const fallbackBase = await getLegacyDefaultBranch();
      state.git_default_branch = fallbackBase;
      if (!state.diff_base_branch_explicit && !state.diff_base_branch && state.git_branch) {
        state.diff_base_branch = fallbackBase;
      }
    }

    if (computeAheadBehind) {
      await resolveAheadBehindDirect(state);
    } else {
      state.git_ahead = 0;
      state.git_behind = 0;
    }
    state.git_status_refreshed_at = Date.now();
    state.git_status_refresh_error = null;
  } catch {
    const preservedDiffBaseBranch = state.diff_base_branch;
    const preservedDiffBaseExplicit = state.diff_base_branch_explicit;
    state.git_branch = "";
    state.git_default_branch = "";
    state.diff_base_branch = preservedDiffBaseBranch;
    state.diff_base_branch_explicit = preservedDiffBaseExplicit;
    state.git_head_sha = "";
    state.diff_base_start_sha = "";
    state.is_worktree = false;
    state.repo_root = "";
    state.git_ahead = 0;
    state.git_behind = 0;
    state.git_status_refreshed_at = Date.now();
    state.git_status_refresh_error = "Unable to read git status";
  }
  state.is_containerized = wasContainerized;
}

export async function readWorktreeStateFingerprint(cwd: string): Promise<string | null> {
  try {
    const gitFile = await readFile(join(cwd, ".git"), "utf-8");
    const match = gitFile.match(/^gitdir:\s*(.+)\s*$/m);
    if (!match) return null;
    const gitDir = resolve(cwd, match[1].trim());
    const [headStat, indexStat] = await Promise.all([
      stat(join(gitDir, "HEAD")).catch(() => null),
      stat(join(gitDir, "index")).catch(() => null),
    ]);
    return [
      headStat ? `${headStat.mtimeMs}:${headStat.size}` : "missing",
      indexStat ? `${indexStat.mtimeMs}:${indexStat.size}` : "missing",
    ].join("|");
  } catch {
    return null;
  }
}

interface SessionDiffStateLike {
  state: SessionState;
  worktreeStateFingerprint: string;
  diffStatsCacheKey?: string;
  diffStatsCacheResult?: {
    totalLinesAdded: number;
    totalLinesRemoved: number;
    skippedReason: string | null;
  } | null;
}

interface SessionDiffRefreshLike extends SessionDiffStateLike {
  id: string;
  backendSocket: unknown | null;
  codexAdapter: unknown | null;
  browserSockets: { size: number };
  diffStatsDirty: boolean;
}

interface DiffStatsNumstatResult {
  totalLinesAdded: number;
  totalLinesRemoved: number;
}

const inFlightDiffStatsComputations = new Map<string, Promise<DiffStatsNumstatResult>>();
const inFlightMergeBaseRefs = new Map<string, Promise<string | null>>();

interface RecomputeDiffIfDirtyDeps {
  broadcastDiffTotals: (session: SessionDiffRefreshLike) => void;
  persistSession: (session: SessionDiffRefreshLike) => void;
}

interface RefreshWorktreeGitStateForSnapshotDeps {
  sessions: Map<string, SessionDiffRefreshLike>;
  inFlightRefreshes: Map<string, Promise<SessionState | null>>;
  refreshGitInfo: (
    session: SessionDiffRefreshLike,
    options: { broadcastUpdate?: boolean; notifyPoller?: boolean; force?: boolean },
  ) => Promise<void>;
  broadcastSessionUpdate: (session: SessionDiffRefreshLike, update: Record<string, unknown>) => void;
  broadcastDiffTotals: (session: SessionDiffRefreshLike) => void;
  persistSession: (session: SessionDiffRefreshLike) => void;
}

interface RefreshGitInfoDeps {
  gitSessionKeys: readonly (keyof SessionState)[];
  sessions: Map<string, SessionDiffRefreshLike>;
  nonWorktreeAheadBehindRefreshes: Map<string, Promise<AheadBehindCounts>>;
  broadcastSessionUpdate: (session: SessionDiffRefreshLike, update: Record<string, unknown>) => void;
  broadcastGitUpdate: (session: SessionDiffRefreshLike) => void;
  persistSession: (session: SessionDiffRefreshLike) => void;
  notifyPoller: (session: SessionDiffRefreshLike) => void;
  updateBranchIndex: (session: SessionDiffRefreshLike) => void;
  invalidateSessionsSharingBranch: (session: SessionDiffRefreshLike, previousHeadSha: string) => void;
}

interface SetDiffBaseBranchDeps {
  broadcastSessionUpdate: (session: SessionDiffRefreshLike, update: Record<string, unknown>) => void;
  persistSession: (session: SessionDiffRefreshLike) => void;
  refreshGitInfo: (
    session: SessionDiffRefreshLike,
    options: { broadcastUpdate?: boolean; notifyPoller?: boolean; force?: boolean },
  ) => Promise<void>;
  updateBranchIndex: (session: SessionDiffRefreshLike) => void;
}

interface RefreshGitInfoPublicDeps {
  refreshGitInfo: (
    session: SessionDiffRefreshLike,
    options: { broadcastUpdate?: boolean; notifyPoller?: boolean; force?: boolean },
  ) => Promise<void>;
  broadcastSessionUpdate: (session: SessionDiffRefreshLike, update: Record<string, unknown>) => void;
  broadcastDiffTotals: (session: SessionDiffRefreshLike) => void;
  persistSession: (session: SessionDiffRefreshLike) => void;
}

export interface RefreshGitInfoPublicResult {
  ok: boolean;
  diffStatsRefreshed: boolean;
  diffStatsSkippedReason?: string | null;
  error: string | null;
}

export async function updateDiffBaseStartSha(session: SessionDiffStateLike, previousHeadSha: string): Promise<boolean> {
  if (!session.state.is_worktree) return false;
  const cwd = session.state.cwd;
  const currentHeadSha = session.state.git_head_sha?.trim() || "";
  if (!cwd || !currentHeadSha) return false;

  const existingAnchor = session.state.diff_base_start_sha?.trim() || "";
  const ref = (session.state.diff_base_branch || session.state.git_default_branch || "").trim();

  if (ref && GIT_SHA_REF_RE.test(ref)) {
    if (!existingAnchor) {
      session.state.diff_base_start_sha = currentHeadSha;
      return true;
    }
    if (previousHeadSha && previousHeadSha !== currentHeadSha) {
      try {
        await execPromise(`${SERVER_GIT_CMD} merge-base --is-ancestor ${previousHeadSha} ${currentHeadSha}`, {
          cwd,
          timeout: GIT_CMD_TIMEOUT,
        });
      } catch {
        session.state.diff_base_start_sha = currentHeadSha;
        return true;
      }
    }
    return false;
  }

  let nextAnchor = currentHeadSha;
  if (ref) {
    const mergeBase = await resolveMergeBaseRef(cwd, ref);
    if (mergeBase) nextAnchor = mergeBase;
  }

  if (nextAnchor !== existingAnchor) {
    session.state.diff_base_start_sha = nextAnchor;
    return true;
  }
  return false;
}

function shouldSkipNonWorktreeDefaultMainDiffStats(session: SessionDiffStateLike, diffBase: string): boolean {
  return !session.state.is_worktree && isDefaultMainComparisonRef(diffBase);
}

function getDiffStatsSkippedReasonForVisibility(session: SessionDiffStateLike): string | null {
  if (!session.state.is_worktree) return null;
  const refreshSession = session as Partial<SessionDiffRefreshLike>;
  const hasBackend = !!refreshSession.backendSocket || !!refreshSession.codexAdapter;
  const hasOpenBrowser = (refreshSession.browserSockets?.size ?? 0) > 0;
  return hasBackend || hasOpenBrowser ? null : "worktree is not open";
}

function buildDiffStatsCacheKey(session: SessionDiffStateLike, diffRef: string, worktreeFingerprint: string): string {
  return [
    session.state.cwd || "",
    session.state.is_worktree ? "worktree" : "repo",
    session.state.git_head_sha || "HEAD",
    session.state.diff_base_branch || "",
    session.state.diff_base_start_sha || "",
    diffRef,
    String(session.state.git_ahead || 0),
    String(session.state.git_behind || 0),
    worktreeFingerprint,
  ].join("\0");
}

function applyDiffStatsResult(
  session: SessionDiffStateLike,
  result: { totalLinesAdded: number; totalLinesRemoved: number; skippedReason: string | null },
): void {
  session.state.total_lines_added = result.totalLinesAdded;
  session.state.total_lines_removed = result.totalLinesRemoved;
  session.state.diff_stats_skipped_reason = result.skippedReason;
}

function cacheDiffStatsResult(
  session: SessionDiffStateLike,
  cacheKey: string,
  result: { totalLinesAdded: number; totalLinesRemoved: number; skippedReason: string | null },
): void {
  session.diffStatsCacheKey = cacheKey;
  session.diffStatsCacheResult = result;
}

function buildDiffStatsInFlightKey(
  cwd: string,
  diffRef: string,
  cacheKey: string,
  worktreeDirtyEntries: number | null,
): string {
  const dirtyState = worktreeDirtyEntries === null ? "repo" : "worktree-clean";
  return [cwd, diffRef, cacheKey, dirtyState].join("\0");
}

async function readDiffStatsNumstat(cwd: string, diffRef: string): Promise<DiffStatsNumstatResult> {
  const { stdout } = await execPromise(`${SERVER_GIT_CMD} diff --numstat ${diffRef}`, {
    cwd,
    timeout: GIT_CMD_TIMEOUT,
  });
  let totalLinesAdded = 0;
  let totalLinesRemoved = 0;
  const raw = stdout.trim();
  if (raw) {
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      const [addStr, delStr] = line.split("\t");
      if (addStr !== "-") totalLinesAdded += parseInt(addStr, 10) || 0;
      if (delStr !== "-") totalLinesRemoved += parseInt(delStr, 10) || 0;
    }
  }
  return { totalLinesAdded, totalLinesRemoved };
}

function computeDiffStatsNumstat(
  cwd: string,
  diffRef: string,
  cacheKey: string,
  worktreeDirtyEntries: number | null,
): Promise<DiffStatsNumstatResult> {
  if (worktreeDirtyEntries !== null && worktreeDirtyEntries > 0) {
    return readDiffStatsNumstat(cwd, diffRef);
  }

  const inFlightKey = buildDiffStatsInFlightKey(cwd, diffRef, cacheKey, worktreeDirtyEntries);
  let computation = inFlightDiffStatsComputations.get(inFlightKey);
  if (!computation) {
    computation = readDiffStatsNumstat(cwd, diffRef).finally(() => {
      if (inFlightDiffStatsComputations.get(inFlightKey) === computation) {
        inFlightDiffStatsComputations.delete(inFlightKey);
      }
    });
    inFlightDiffStatsComputations.set(inFlightKey, computation);
  }
  return computation;
}

async function countTrackedDirtyEntries(cwd: string): Promise<number> {
  const { stdout } = await execPromise(
    `${SERVER_GIT_CMD} status --porcelain=v1 --untracked-files=no --no-renames | awk 'NR <= 501 { print } NR > 501 { exit }'`,
    {
      cwd,
      encoding: "utf-8",
      timeout: GIT_CMD_TIMEOUT,
    },
  );
  const raw = stdout.trim();
  return raw ? raw.split("\n").filter((line) => line.trim()).length : 0;
}

function setSkippedDiffStats(
  session: SessionDiffStateLike,
  cacheKey: string,
  reason: string,
  options: { cache?: boolean } = {},
): void {
  const result = {
    totalLinesAdded: 0,
    totalLinesRemoved: 0,
    skippedReason: `Diff stats skipped: ${reason}`,
  };
  applyDiffStatsResult(session, result);
  if (options.cache !== false) {
    cacheDiffStatsResult(session, cacheKey, result);
  }
}

async function resolveAheadBehindForRefresh(
  session: SessionDiffRefreshLike,
  deps: RefreshGitInfoDeps,
): Promise<{ sharedKey: string | null; counts: AheadBehindCounts | null }> {
  const ref = getGitComparisonRef(session.state);
  if (!ref || !session.state.cwd) {
    session.state.git_ahead = 0;
    session.state.git_behind = 0;
    return { sharedKey: null, counts: null };
  }

  const sharedKey = getSharedAheadBehindKey(session.state);
  if (!sharedKey) {
    const counts = await readAheadBehindCounts(session.state.cwd, ref);
    session.state.git_ahead = counts.ahead;
    session.state.git_behind = counts.behind;
    return { sharedKey: null, counts };
  }

  let refresh = deps.nonWorktreeAheadBehindRefreshes.get(sharedKey);
  if (!refresh) {
    refresh = readAheadBehindCounts(session.state.cwd, ref).finally(() => {
      if (deps.nonWorktreeAheadBehindRefreshes.get(sharedKey) === refresh) {
        deps.nonWorktreeAheadBehindRefreshes.delete(sharedKey);
      }
    });
    deps.nonWorktreeAheadBehindRefreshes.set(sharedKey, refresh);
  }

  const counts = await refresh;
  session.state.git_ahead = counts.ahead;
  session.state.git_behind = counts.behind;
  return { sharedKey, counts };
}

function broadcastSharedAheadBehindResult(
  sharedKey: string,
  counts: AheadBehindCounts,
  refreshedAt: number | undefined,
  sourceSession: SessionDiffRefreshLike,
  deps: RefreshGitInfoDeps,
  options: { broadcastUpdate?: boolean },
): void {
  for (const candidate of deps.sessions.values()) {
    if (candidate === sourceSession) continue;
    if (getSharedAheadBehindKey(candidate.state) !== sharedKey) continue;
    const changed =
      candidate.state.git_ahead !== counts.ahead ||
      candidate.state.git_behind !== counts.behind ||
      (refreshedAt !== undefined && candidate.state.git_status_refreshed_at !== refreshedAt);
    if (!changed) continue;

    candidate.state.git_ahead = counts.ahead;
    candidate.state.git_behind = counts.behind;
    if (refreshedAt !== undefined) {
      candidate.state.git_status_refreshed_at = refreshedAt;
      candidate.state.git_status_refresh_error = null;
    }
    if (options.broadcastUpdate) {
      deps.broadcastSessionUpdate(candidate, {
        git_ahead: candidate.state.git_ahead,
        git_behind: candidate.state.git_behind,
        git_status_refreshed_at: candidate.state.git_status_refreshed_at,
        git_status_refresh_error: candidate.state.git_status_refresh_error ?? null,
      });
    }
    deps.persistSession(candidate);
  }
}

export async function computeDiffStatsAsync(
  session: SessionDiffStateLike,
  options: { skipIfWorktreeNotOpen?: boolean; allowCachedResult?: boolean } = {},
): Promise<boolean> {
  const cwd = session.state.cwd;
  if (!cwd) return false;

  try {
    let diffBase = "";
    let worktreeBaseIsExplicitCommit = false;
    if (session.state.is_worktree) {
      const selectedBase = (session.state.diff_base_branch || session.state.git_default_branch || "").trim();
      if (selectedBase && GIT_SHA_REF_RE.test(selectedBase)) {
        diffBase = selectedBase;
        worktreeBaseIsExplicitCommit = true;
      } else {
        diffBase = session.state.diff_base_start_sha?.trim() || session.state.git_head_sha?.trim() || "";
        if (!diffBase) {
          diffBase = selectedBase;
        }
      }
    } else {
      diffBase = (session.state.diff_base_branch || session.state.git_default_branch || "").trim();
    }
    if (!diffBase) return false;

    if (shouldSkipNonWorktreeDefaultMainDiffStats(session, diffBase)) {
      session.state.total_lines_added = 0;
      session.state.total_lines_removed = 0;
      session.state.diff_stats_skipped_reason = null;
      return true;
    }

    const worktreeFingerprint = session.state.is_worktree ? (await readWorktreeStateFingerprint(cwd)) || "" : "";
    let diffRef = diffBase;
    if (!session.state.is_worktree) {
      const mergeBase = await resolveMergeBaseRef(cwd, diffBase);
      if (mergeBase) diffRef = mergeBase;
    }

    const cacheKey = buildDiffStatsCacheKey(session, diffRef, worktreeFingerprint);
    const visibilitySkipReason = options.skipIfWorktreeNotOpen ? getDiffStatsSkippedReasonForVisibility(session) : null;
    if (visibilitySkipReason) {
      setSkippedDiffStats(session, cacheKey, visibilitySkipReason, { cache: false });
      if (session.state.is_worktree) {
        session.worktreeStateFingerprint = worktreeFingerprint;
      }
      return true;
    }

    let worktreeDirtyEntries: number | null = null;
    if (session.state.is_worktree) {
      const divergence = (session.state.git_ahead || 0) + (session.state.git_behind || 0);
      if (divergence > DIFF_STATS_COMMIT_DIVERGENCE_LIMIT) {
        setSkippedDiffStats(session, cacheKey, `branch is ${divergence} commits from base`);
        session.worktreeStateFingerprint = worktreeFingerprint;
        return true;
      }

      worktreeDirtyEntries = await countTrackedDirtyEntries(cwd);
      if (worktreeDirtyEntries > DIFF_STATS_TRACKED_DIRTY_LIMIT) {
        setSkippedDiffStats(session, cacheKey, `${worktreeDirtyEntries} dirty tracked paths exceeds budget`, {
          cache: false,
        });
        session.worktreeStateFingerprint = worktreeFingerprint;
        return true;
      }

      if (
        worktreeDirtyEntries === 0 &&
        options.allowCachedResult !== false &&
        session.diffStatsCacheKey === cacheKey &&
        session.diffStatsCacheResult
      ) {
        applyDiffStatsResult(session, session.diffStatsCacheResult);
        session.worktreeStateFingerprint = worktreeFingerprint;
        return true;
      }

      if (worktreeDirtyEntries === 0 && !worktreeBaseIsExplicitCommit && (session.state.git_ahead || 0) <= 0) {
        session.state.total_lines_added = 0;
        session.state.total_lines_removed = 0;
        session.state.diff_stats_skipped_reason = null;
        session.worktreeStateFingerprint = worktreeFingerprint;
        return true;
      }
    }

    const { totalLinesAdded, totalLinesRemoved } = await computeDiffStatsNumstat(
      cwd,
      diffRef,
      cacheKey,
      worktreeDirtyEntries,
    );

    applyDiffStatsResult(session, {
      totalLinesAdded,
      totalLinesRemoved,
      skippedReason: null,
    });
    if (!session.state.is_worktree || worktreeDirtyEntries === 0) {
      cacheDiffStatsResult(session, cacheKey, {
        totalLinesAdded,
        totalLinesRemoved,
        skippedReason: null,
      });
    }
    if (session.state.is_worktree) {
      session.worktreeStateFingerprint = worktreeFingerprint;
    }
    return true;
  } catch {
    return false;
  }
}

export function recomputeDiffIfDirty(session: SessionDiffRefreshLike, deps: RecomputeDiffIfDirtyDeps): void {
  if (!session.diffStatsDirty) return;
  if (
    !session.backendSocket &&
    !session.codexAdapter &&
    !(session.state.is_worktree && session.browserSockets.size > 0)
  ) {
    return;
  }
  computeDiffStatsAsync(session, { allowCachedResult: false })
    .then((didRun) => {
      if (!didRun) return;
      session.diffStatsDirty = false;
      deps.broadcastDiffTotals(session);
      deps.persistSession(session);
    })
    .catch(() => {
      /* git not available */
    });
}

export function setDiffBaseBranch(session: SessionDiffRefreshLike, branch: string, deps: SetDiffBaseBranchDeps): void {
  session.state.diff_base_branch = branch;
  session.state.diff_base_branch_explicit = true;
  deps.broadcastSessionUpdate(session, { diff_base_branch: branch });
  void deps.refreshGitInfo(session, { broadcastUpdate: true }).then(async () => {
    const didRun = await computeDiffStatsAsync(session);
    if (!didRun) return;
    deps.broadcastSessionUpdate(session, {
      total_lines_added: session.state.total_lines_added,
      total_lines_removed: session.state.total_lines_removed,
      diff_stats_skipped_reason: session.state.diff_stats_skipped_reason ?? null,
    });
    deps.persistSession(session);
  });
  deps.updateBranchIndex(session);
  deps.persistSession(session);
}

export async function refreshGitInfoPublic(
  session: SessionDiffRefreshLike,
  deps: RefreshGitInfoPublicDeps,
  options: { broadcastUpdate?: boolean; notifyPoller?: boolean; force?: boolean } = {},
): Promise<RefreshGitInfoPublicResult> {
  session.diffStatsDirty = true;
  const beforeAdded = session.state.total_lines_added;
  const beforeRemoved = session.state.total_lines_removed;
  const beforeSkippedReason = session.state.diff_stats_skipped_reason ?? null;
  const previousRefreshedAt = session.state.git_status_refreshed_at;
  await deps.refreshGitInfo(session, options);
  const didRun = await computeDiffStatsAsync(session);
  let refreshError = session.state.git_status_refresh_error ?? null;
  if (didRun) {
    session.diffStatsDirty = session.state.diff_stats_skipped_reason === "Diff stats skipped: worktree is not open";
  } else if (!refreshError) {
    refreshError = DIFF_STATS_REFRESH_FAILED_ERROR;
    session.state.git_status_refreshed_at = previousRefreshedAt;
  }
  session.state.git_status_refresh_error = refreshError;
  if (options.broadcastUpdate) {
    deps.broadcastSessionUpdate(session, {
      git_status_refreshed_at: session.state.git_status_refreshed_at,
      git_status_refresh_error: session.state.git_status_refresh_error ?? null,
    });
    if (
      didRun &&
      (beforeAdded !== session.state.total_lines_added ||
        beforeRemoved !== session.state.total_lines_removed ||
        beforeSkippedReason !== (session.state.diff_stats_skipped_reason ?? null))
    ) {
      deps.broadcastDiffTotals(session);
    }
  }
  deps.persistSession(session);
  return {
    ok: didRun && !refreshError,
    diffStatsRefreshed: didRun,
    diffStatsSkippedReason: session.state.diff_stats_skipped_reason ?? null,
    error: refreshError,
  };
}

export async function refreshGitInfo(
  session: SessionDiffRefreshLike,
  deps: RefreshGitInfoDeps,
  options: { broadcastUpdate?: boolean; notifyPoller?: boolean; force?: boolean } = {},
): Promise<void> {
  if (
    !options.force &&
    !session.backendSocket &&
    !session.codexAdapter &&
    !(session.state.is_worktree && session.browserSockets.size > 0)
  ) {
    return;
  }

  const before: Record<string, unknown> = {};
  for (const key of deps.gitSessionKeys) {
    before[key] = session.state[key];
  }
  const previousHeadSha = session.state.git_head_sha || "";

  await resolveGitInfo(session.state, { computeAheadBehind: false });
  const sharedAheadBehind = await resolveAheadBehindForRefresh(session, deps);
  if (!session.state.is_worktree) {
    session.worktreeStateFingerprint = "";
  }
  const anchorChanged = await updateDiffBaseStartSha(session, previousHeadSha);
  if (anchorChanged) {
    session.diffStatsDirty = true;
  }

  let changed = false;
  for (const key of deps.gitSessionKeys) {
    if (session.state[key] !== before[key]) {
      changed = true;
      break;
    }
  }

  if (changed) {
    if (options.broadcastUpdate) {
      deps.broadcastGitUpdate(session);
      deps.broadcastSessionUpdate(session, {
        git_status_refreshed_at: session.state.git_status_refreshed_at,
        git_status_refresh_error: session.state.git_status_refresh_error ?? null,
      });
    }
    deps.persistSession(session);
  }

  if (sharedAheadBehind.sharedKey && sharedAheadBehind.counts) {
    broadcastSharedAheadBehindResult(
      sharedAheadBehind.sharedKey,
      sharedAheadBehind.counts,
      session.state.git_status_refreshed_at,
      session,
      deps,
      options,
    );
  }

  if (options.notifyPoller && session.state.git_branch && session.state.cwd) {
    deps.notifyPoller(session);
  }

  deps.updateBranchIndex(session);

  const currentHeadSha = session.state.git_head_sha || "";
  if (previousHeadSha && currentHeadSha && currentHeadSha !== previousHeadSha) {
    deps.invalidateSessionsSharingBranch(session, previousHeadSha);
  }
}

export function refreshWorktreeGitStateForSnapshot(
  sessionId: string,
  deps: RefreshWorktreeGitStateForSnapshotDeps,
  options: { broadcastUpdate?: boolean; notifyPoller?: boolean } = {},
): Promise<SessionState | null> {
  const existing = deps.inFlightRefreshes.get(sessionId);
  if (existing) return existing;

  const refresh = runWorktreeGitStateRefreshForSnapshot(sessionId, deps, options).finally(() => {
    if (deps.inFlightRefreshes.get(sessionId) === refresh) {
      deps.inFlightRefreshes.delete(sessionId);
    }
  });
  deps.inFlightRefreshes.set(sessionId, refresh);
  return refresh;
}

async function runWorktreeGitStateRefreshForSnapshot(
  sessionId: string,
  deps: RefreshWorktreeGitStateForSnapshotDeps,
  options: { broadcastUpdate?: boolean; notifyPoller?: boolean } = {},
): Promise<SessionState | null> {
  const session = deps.sessions.get(sessionId);
  if (!session) return null;
  if (!session.state.is_worktree || !session.state.cwd) return session.state;

  const currentFingerprint = await readWorktreeStateFingerprint(session.state.cwd);
  const previousFingerprint = session.worktreeStateFingerprint.trim();
  const previousRefreshAt = session.state.git_status_refreshed_at || 0;
  const staleRefresh = Date.now() - previousRefreshAt >= GIT_STATUS_AUTO_REFRESH_STALE_MS;
  const visibilitySkipReason = getDiffStatsSkippedReasonForVisibility(session);
  if (visibilitySkipReason) {
    const beforeAdded = session.state.total_lines_added;
    const beforeRemoved = session.state.total_lines_removed;
    const beforeSkippedReason = session.state.diff_stats_skipped_reason ?? null;
    setSkippedDiffStats(session, "", visibilitySkipReason, { cache: false });
    session.diffStatsDirty = true;
    session.worktreeStateFingerprint = currentFingerprint || "";
    const totalsChanged =
      beforeAdded !== session.state.total_lines_added ||
      beforeRemoved !== session.state.total_lines_removed ||
      beforeSkippedReason !== (session.state.diff_stats_skipped_reason ?? null);
    if (totalsChanged && options.broadcastUpdate) {
      deps.broadcastDiffTotals(session);
    }
    if (totalsChanged) {
      deps.persistSession(session);
    }
    return session.state;
  }
  if (currentFingerprint && previousFingerprint && currentFingerprint === previousFingerprint && !staleRefresh) {
    return session.state;
  }

  const beforeAdded = session.state.total_lines_added;
  const beforeRemoved = session.state.total_lines_removed;
  const beforeSkippedReason = session.state.diff_stats_skipped_reason ?? null;
  const beforeAnchor = session.state.diff_base_start_sha;
  const beforeRefreshedAt = session.state.git_status_refreshed_at;
  const fingerprintChanged = !currentFingerprint || !previousFingerprint || currentFingerprint !== previousFingerprint;

  await deps.refreshGitInfo(session, {
    broadcastUpdate: options.broadcastUpdate,
    notifyPoller: options.notifyPoller,
    force: true,
  });

  const shouldRefreshDiff =
    fingerprintChanged ||
    session.diffStatsDirty ||
    beforeAnchor !== session.state.diff_base_start_sha ||
    (session.state.is_worktree &&
      (session.state.git_ahead || 0) <= 0 &&
      (session.state.total_lines_added > 0 || session.state.total_lines_removed > 0));
  const didRun = shouldRefreshDiff ? await computeDiffStatsAsync(session, { skipIfWorktreeNotOpen: true }) : false;
  if (didRun) {
    session.diffStatsDirty = session.state.diff_stats_skipped_reason === "Diff stats skipped: worktree is not open";
  } else if (shouldRefreshDiff && !session.state.git_status_refresh_error) {
    session.diffStatsDirty = true;
    session.state.git_status_refreshed_at = beforeRefreshedAt;
    session.state.git_status_refresh_error = DIFF_STATS_REFRESH_FAILED_ERROR;
  }
  session.worktreeStateFingerprint = currentFingerprint || "";

  const totalsChanged =
    beforeAdded !== session.state.total_lines_added ||
    beforeRemoved !== session.state.total_lines_removed ||
    beforeSkippedReason !== (session.state.diff_stats_skipped_reason ?? null);
  if (totalsChanged && options.broadcastUpdate) {
    deps.broadcastDiffTotals(session);
  }
  if ((staleRefresh || (shouldRefreshDiff && !didRun)) && options.broadcastUpdate) {
    deps.broadcastSessionUpdate(session, {
      git_status_refreshed_at: session.state.git_status_refreshed_at,
      git_status_refresh_error: session.state.git_status_refresh_error ?? null,
    });
  }
  if (totalsChanged || staleRefresh || (shouldRefreshDiff && !didRun)) {
    deps.persistSession(session);
  }
  return session.state;
}
