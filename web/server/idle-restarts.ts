import { type BridgeTurnView, turnIsIdle } from "./remote-host/host-restart-gate.js";
import { sessionTag } from "./session-tag.js";

/**
 * How long after taking over a process the session is left alone. A session
 * just taken over can look idle for a moment before it resumes a turn or asks
 * a permission again.
 */
export const OUTDATED_RESTART_SETTLE_MS = 60_000;

/** The bridge's view of a session: its turn and the input waiting for it. */
export interface IdleRestartSessionView extends BridgeTurnView {
  pendingMessages: readonly unknown[];
  pendingCodexInputs: readonly unknown[];
  pendingCodexTurns: ReadonlyArray<{ status?: string }>;
}

export interface IdleRestartsDeps {
  bridgeSession: (sessionId: string) => IdleRestartSessionView | undefined;
  coordinatorStartedAt: number;
  /** Call `onChange` when the session's turn or permission state changes, until unsubscribed. */
  watch: (sessionId: string, onChange: () => void) => () => void;
  /** Stop the session like an idle one, so it starts afresh on its next message. */
  stop: (sessionId: string) => Promise<unknown>;
}

export interface IdleRestartRequest {
  /** Why the session restarts, completing "restarting it ..." in the log. */
  reason: string;
  /** Whether the running process still needs replacing; the request is dropped once it doesn't. */
  stillNeeded: () => boolean;
  /** Leave the session alone this long first. */
  settleMs?: number;
}

/**
 * Restarts sessions whose running process can't give them what they need
 * without cutting off any work: once the session is idle (no turn, permission
 * request or waiting input) it is stopped like an idle session and starts a
 * fresh process on its next message. Uses: a process a node kept running across
 * a server restart runs other instructions than the new server builds, and a
 * Claude process refuses a model its fresh replacement can run.
 */
export class IdleRestarts {
  /** Sessions waiting for an idle moment, by session ID. */
  private readonly waiting = new Map<string, IdleRestartRequest & { from: number; unwatch: () => void }>();

  constructor(private readonly deps: IdleRestartsDeps) {}

  /** Restart the session at its first idle moment; a later request for the same session replaces this one. */
  restartWhenIdle(sessionId: string, request: IdleRestartRequest): void {
    const settleMs = request.settleMs ?? 0;
    this.waiting.get(sessionId)?.unwatch();
    this.waiting.set(sessionId, {
      ...request,
      from: Date.now() + settleMs,
      unwatch: this.deps.watch(sessionId, () => this.check(sessionId)),
    });
    if (settleMs > 0) setTimeout(() => this.check(sessionId), settleMs).unref?.();
    else this.check(sessionId);
  }

  /** Restart the session if its process still needs replacing and it is now idle. */
  private check(sessionId: string): void {
    const waiting = this.waiting.get(sessionId);
    if (!waiting || Date.now() < waiting.from) return;
    if (!waiting.stillNeeded()) {
      this.stopWaiting(sessionId);
      return;
    }
    const session = this.deps.bridgeSession(sessionId);
    if (!session || !isIdle(session, this.deps.coordinatorStartedAt)) return;
    this.stopWaiting(sessionId);
    console.log(`[server] Session ${sessionTag(sessionId)} is idle; restarting it ${waiting.reason}`);
    this.deps.stop(sessionId).catch((error) => {
      console.warn(`[server] Could not restart session ${sessionTag(sessionId)} ${waiting.reason}:`, error);
    });
  }

  private stopWaiting(sessionId: string): void {
    this.waiting.get(sessionId)?.unwatch();
    this.waiting.delete(sessionId);
  }
}

function isIdle(session: IdleRestartSessionView, coordinatorStartedAt: number): boolean {
  return (
    turnIsIdle(session, coordinatorStartedAt) &&
    session.pendingMessages.length === 0 &&
    session.pendingCodexInputs.length === 0 &&
    session.pendingCodexTurns.every((turn) => turn.status === "completed")
  );
}
