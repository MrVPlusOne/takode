import { canonicalThreadStatusKey, type LeaderThreadStatus } from "../../shared/thread-status-marker.js";

/**
 * The store's `threadStatuses` for one session holding these statuses, as thread windows and
 * `leader_thread_status` updates leave it (keyed by canonical thread key).
 */
export function threadStatusesState(
  sessionId: string,
  statuses: Readonly<Record<string, LeaderThreadStatus>>,
): Map<string, Map<string, LeaderThreadStatus | null>> {
  const byThread = new Map<string, LeaderThreadStatus | null>();
  for (const [key, status] of Object.entries(statuses)) {
    byThread.set(canonicalThreadStatusKey(status.threadKey || key), status);
  }
  return new Map([[sessionId, byThread]]);
}

/**
 * Applies statuses to a real store session the way `leader_thread_status` updates do: each named
 * thread gets its status, and each thread in `cleared` loses its own.
 */
export function applyThreadStatuses(
  setThreadStatus: (sessionId: string, threadKey: string, status: LeaderThreadStatus | null) => void,
  sessionId: string,
  statuses: Readonly<Record<string, LeaderThreadStatus>>,
  cleared: readonly string[] = [],
): void {
  for (const [key, status] of Object.entries(statuses)) setThreadStatus(sessionId, status.threadKey || key, status);
  for (const key of cleared) setThreadStatus(sessionId, key, null);
}
