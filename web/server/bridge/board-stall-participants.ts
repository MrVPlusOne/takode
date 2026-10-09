/**
 * Runtime state of the sessions a board stall check looks at: a row's worker
 * and reviewer, and the holders of lease pools a worker is queued in. Decides
 * which idle sessions are legitimately waiting (timers, background jobs,
 * landing runs, progressing lease queues) and which have stopped.
 */
import type { ResourceLeaseWait } from "../resource-lease-types.js";
import type { BackgroundTaskInfo, BackgroundTaskSnapshot } from "./adapter-interface.js";

type SessionLike = any;

/** How long an idle participant's background job counts as a legitimate wait. */
const BACKGROUND_JOB_WAIT_LIMIT_MS = 30 * 60_000;

export type BoardStallStatus = "running" | "idle" | "disconnected" | "missing";

export interface BoardParticipantDeps {
  getLauncherSessionInfo: (sessionId: string) => any;
  getSession: (sessionId: string) => SessionLike | undefined;
  timerCount: (sessionId: string) => number;
  /** Lease pools the session is queued for, with their current holders. */
  getLeaseWaits?: (sessionId: string) => readonly ResourceLeaseWait[];
  /** Whether the session runs, or has a change inside, an active landing-queue run. */
  isLandingActive?: (sessionId: string) => boolean;
  /** Background jobs the session's agent is notified about when they end (Claude sessions). */
  getBackgroundTasks?: (sessionId: string) => BackgroundTaskSnapshot | null;
  backendConnected: (session: SessionLike) => boolean;
}

export interface BoardParticipantRuntime {
  status: BoardStallStatus;
  lastActivityAt: number;
  hasActiveTimer: boolean;
  /** Background jobs of an idle participant; they count as a wait until `backgroundWaitEndsAt`. */
  backgroundJobs: readonly BackgroundTaskInfo[];
}

export function getBoardParticipantRuntime(
  sessionId: string | undefined,
  deps: BoardParticipantDeps,
  currentSession: SessionLike,
): BoardParticipantRuntime {
  if (!sessionId) return { status: "missing", lastActivityAt: 0, hasActiveTimer: false, backgroundJobs: [] };
  const launcherInfo = deps.getLauncherSessionInfo(sessionId);
  const lastActivityAt = launcherInfo?.lastActivityAt ?? 0;
  if (launcherInfo?.archived) return { status: "missing", lastActivityAt, hasActiveTimer: false, backgroundJobs: [] };

  const session = sessionId === currentSession.id ? currentSession : deps.getSession(sessionId);
  const hasActiveTimer = deps.timerCount(sessionId) > 0;
  if (!session || !deps.backendConnected(session)) {
    const status = launcherInfo ? "disconnected" : "missing";
    return { status, lastActivityAt, hasActiveTimer, backgroundJobs: [] };
  }
  if (session.isGenerating || (session.pendingPermissions?.size ?? 0) > 0) {
    return { status: "running", lastActivityAt, hasActiveTimer, backgroundJobs: [] };
  }
  // A background job ending counts as activity: the agent's resume turn may
  // start a moment after its job leaves the set, so the stall clock restarts.
  const background = deps.getBackgroundTasks?.(sessionId);
  return {
    status: "idle",
    lastActivityAt: Math.max(lastActivityAt, background?.changedAt ?? 0),
    hasActiveTimer,
    backgroundJobs: background?.tasks ?? [],
  };
}

/**
 * When a participant's background jobs stop counting as a legitimate wait: the
 * newest job's start plus the plausible run time, or 0 without jobs. Past it,
 * the jobs are treated as hung or forgotten, such as a dev server left running.
 */
export function backgroundWaitEndsAt(runtime: Pick<BoardParticipantRuntime, "backgroundJobs">): number {
  if (runtime.backgroundJobs.length === 0) return 0;
  return Math.max(...runtime.backgroundJobs.map((job) => job.startedAt)) + BACKGROUND_JOB_WAIT_LIMIT_MS;
}

export function formatOverdueBackgroundJobs(jobs: readonly BackgroundTaskInfo[]): string {
  const limitMinutes = BACKGROUND_JOB_WAIT_LIMIT_MS / 60_000;
  const descriptions = jobs.map((job) => job.description.trim()).filter(Boolean);
  const label = jobs.length > 1 ? `${jobs.length} background jobs` : "background job";
  return `${label} running over ${limitMinutes}m${descriptions.length > 0 ? ` (${descriptions.join("; ")})` : ""}`;
}

interface StuckLeaseWait {
  resourceKey: string;
  holders: Array<{
    sessionId: string;
    status: BoardStallStatus;
    lastActivityAt: number;
    backgroundJobs: readonly BackgroundTaskInfo[];
  }>;
}

/**
 * Classify a session's resource-lease queue wait. Returns null when it is not
 * queued, "progressing" when every queued pool has a holder that is running,
 * has an active timer or a background job still within its plausible run time,
 * or is itself in a progressing lease wait, and otherwise the first pool whose
 * holders have all stopped. `path` holds the sessions already on this wait
 * chain, so a lease deadlock counts as stuck.
 */
export function assessLeaseWait(
  sessionId: string,
  deps: BoardParticipantDeps,
  currentSession: SessionLike,
  path: ReadonlySet<string>,
  now: number,
): "progressing" | StuckLeaseWait | null {
  const waits = deps.getLeaseWaits?.(sessionId) ?? [];
  if (waits.length === 0) return null;
  const chain = new Set([...path, sessionId]);
  for (const wait of waits) {
    // A pool with a free slot is promoted by the next lease sweep.
    if (wait.holderSessionIds.length === 0) continue;
    const holders = wait.holderSessionIds.map((holderId) => ({
      sessionId: holderId,
      ...getBoardParticipantRuntime(holderId, deps, currentSession),
    }));
    const progressing = holders.some(
      (holder) =>
        holder.status === "running" ||
        holder.hasActiveTimer ||
        backgroundWaitEndsAt(holder) > now ||
        deps.isLandingActive?.(holder.sessionId) ||
        (!chain.has(holder.sessionId) &&
          assessLeaseWait(holder.sessionId, deps, currentSession, chain, now) === "progressing"),
    );
    if (!progressing) {
      return {
        resourceKey: wait.resourceKey,
        holders: holders.map(({ sessionId, status, lastActivityAt, backgroundJobs }) => ({
          sessionId,
          status,
          lastActivityAt,
          backgroundJobs,
        })),
      };
    }
  }
  return "progressing";
}

export function formatBoardSessionRef(sessionId: string, deps: BoardParticipantDeps): string {
  const sessionNum = deps.getLauncherSessionInfo(sessionId)?.sessionNum;
  return typeof sessionNum === "number" ? `#${sessionNum}` : sessionId.slice(0, 8);
}
