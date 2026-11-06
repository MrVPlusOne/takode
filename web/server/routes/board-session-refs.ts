import { getWaitForRefKind } from "../../shared/quest-journey.js";
import type { RouteContext } from "./context.js";

/**
 * Sessions a board row names must be usable when the row is written. A leader once chose a worker
 * from memory that had been archived the day before: `board set --worker` recorded it and handed
 * off the user's request, and the slip only showed when the dispatch message failed. So a worker
 * must be a live session in the leader's herd, and a `#N` wait-for must name a session that exists
 * and is not archived (an archived one would count as finished at once, an unknown one never).
 */

type SessionLookup = Pick<RouteContext["launcher"], "resolveSessionId" | "getSession">;

/**
 * Resolves a board row's worker reference (number, `#N`, UUID or prefix) for leader `leaderId`.
 * Returns the worker's session ID and number, or the error that refuses it.
 */
export function resolveBoardWorker(
  launcher: SessionLookup,
  leaderId: string,
  ref: string,
): { worker: string; workerNum?: number } | { error: string; status: 400 | 409 } {
  const workerId = launcher.resolveSessionId(ref);
  const session = workerId ? launcher.getSession(workerId) : undefined;
  if (!workerId || !session) {
    return {
      error: `Worker ${ref} not found: no such session (unknown or deleted). Check \`takode list\`.`,
      status: 400,
    };
  }
  const label = session.sessionNum !== undefined ? `#${session.sessionNum}` : ref;
  if (session.archived) {
    return {
      error:
        `Worker ${label} is archived. Pick a live worker from \`takode list\`, or spawn a fresh one in its ` +
        `worktree with \`takode spawn --replace-worktree-worker ${session.sessionNum ?? ref}\`.`,
      status: 409,
    };
  }
  if (session.herdedBy !== leaderId) {
    return {
      error: `Worker ${label} is not in your herd. Herd it first with \`takode herd ${session.sessionNum ?? ref}\`.`,
      status: 409,
    };
  }
  return { worker: workerId, workerNum: session.sessionNum };
}

/** The error for the first `#N` wait-for that names an unknown or archived session, or null. */
export function unusableWaitForSessionError(launcher: SessionLookup, waitFor: readonly string[]): string | null {
  for (const ref of waitFor) {
    if (getWaitForRefKind(ref) !== "session") continue;
    const sessionId = launcher.resolveSessionId(ref.slice(1));
    const session = sessionId ? launcher.getSession(sessionId) : undefined;
    if (!session) return `Cannot wait for ${ref}: no such session (unknown or deleted).`;
    if (session.archived) return `Cannot wait for ${ref}: the session is archived.`;
  }
  return null;
}
