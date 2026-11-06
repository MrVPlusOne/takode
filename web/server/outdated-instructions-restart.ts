import { type BridgeTurnView, turnIsIdle } from "./remote-host/host-restart-gate.js";
import { sessionTag } from "./session-tag.js";

/**
 * How long after taking over a process the session is left alone. A session
 * just taken over can look idle for a moment before it resumes a turn or asks
 * a permission again.
 */
export const OUTDATED_RESTART_SETTLE_MS = 60_000;

/** The bridge's view of a session: its turn and the input waiting for it. */
export interface OutdatedRestartSessionView extends BridgeTurnView {
  pendingMessages: readonly unknown[];
  pendingCodexInputs: readonly unknown[];
  pendingCodexTurns: ReadonlyArray<{ status?: string }>;
}

export interface OutdatedInstructionsRestartsDeps {
  /** Whether the session still runs the outdated process it was taken over with. */
  runsOutdatedInstructions: (sessionId: string) => boolean;
  bridgeSession: (sessionId: string) => OutdatedRestartSessionView | undefined;
  coordinatorStartedAt: number;
  /** Call `onChange` when the session's turn or permission state changes, until unsubscribed. */
  watch: (sessionId: string, onChange: () => void) => () => void;
  /** Stop the session like an idle one, so it starts afresh on its next message. */
  stop: (sessionId: string) => Promise<unknown>;
}

/**
 * Restarts sessions whose process, kept running by a node across a server
 * restart, runs other instructions than the new server builds. Such a process
 * is taken over rather than ended, so no turn is cut off; once the session is
 * idle (no turn, permission request or waiting input) it is stopped like an
 * idle session and gets the new instructions when it next starts. A node
 * update ends every process on its node anyway, which also ends the wait.
 */
export class OutdatedInstructionsRestarts {
  /** Sessions waiting for an idle moment: from when they may be restarted, and how to stop watching them. */
  private readonly waiting = new Map<string, { from: number; unwatch: () => void }>();

  constructor(private readonly deps: OutdatedInstructionsRestartsDeps) {}

  /** A process with outdated instructions was taken over: restart its session at its first idle moment. */
  tookOver(sessionId: string): void {
    this.waiting.get(sessionId)?.unwatch();
    this.waiting.set(sessionId, {
      from: Date.now() + OUTDATED_RESTART_SETTLE_MS,
      unwatch: this.deps.watch(sessionId, () => this.check(sessionId)),
    });
    setTimeout(() => this.check(sessionId), OUTDATED_RESTART_SETTLE_MS).unref?.();
  }

  /** Restart the session if it still runs its outdated process and is now idle. */
  private check(sessionId: string): void {
    const waiting = this.waiting.get(sessionId);
    if (!waiting || Date.now() < waiting.from) return;
    if (!this.deps.runsOutdatedInstructions(sessionId)) {
      this.stopWaiting(sessionId);
      return;
    }
    const session = this.deps.bridgeSession(sessionId);
    if (!session || !isIdle(session, this.deps.coordinatorStartedAt)) return;
    this.stopWaiting(sessionId);
    console.log(`[server] Session ${sessionTag(sessionId)} is idle; restarting it to apply its new instructions`);
    this.deps.stop(sessionId).catch((error) => {
      console.warn(`[server] Could not restart session ${sessionTag(sessionId)} for its new instructions:`, error);
    });
  }

  private stopWaiting(sessionId: string): void {
    this.waiting.get(sessionId)?.unwatch();
    this.waiting.delete(sessionId);
  }
}

function isIdle(session: OutdatedRestartSessionView, coordinatorStartedAt: number): boolean {
  return (
    turnIsIdle(session, coordinatorStartedAt) &&
    session.pendingMessages.length === 0 &&
    session.pendingCodexInputs.length === 0 &&
    session.pendingCodexTurns.every((turn) => turn.status === "completed")
  );
}
