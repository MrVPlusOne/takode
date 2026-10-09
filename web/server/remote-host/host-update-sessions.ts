import { randomUUID } from "node:crypto";
import { processHostOf } from "./host-registry.js";
import { hostCanRestart, type BridgeTurnView, type HostSessionView } from "./host-restart-gate.js";

/**
 * How an auto-updating host is updated: right away after the user's Restart
 * Server, with turns interrupted and continued like in a single-machine
 * restart, or otherwise only once none of its sessions is in a turn.
 */
export type HostUpdateMode = "immediate" | "when_idle";

/** How long interrupted turns get to end before the host's sessions are stopped anyway. */
export const HOST_UPDATE_INTERRUPT_TIMEOUT_MS = 10_000;

export interface HostUpdateSession extends HostSessionView {
  herdedBy?: string | null;
  isOrchestrator?: boolean;
}

export interface HostUpdateSessionsDeps {
  sessions: () => HostUpdateSession[];
  awaitingReattach: (sessionId: string) => boolean;
  bridgeSession: (sessionId: string) => BridgeTurnView | undefined;
  coordinatorStartedAt: number;
  /** Whether a landing run is under way on the host; restarting its node would cut it off. */
  landingRunOn: (hostId: string) => boolean;
  /** Interrupt a session's turn as Restart Server does, keeping input that is still queued. */
  interrupt: (sessionId: string, operationId: string) => Promise<unknown>;
  /** Keep the interrupted turns' ends from waking their leaders, as Restart Server does. */
  holdHerdEvents: (operation: {
    operationId: string;
    sessionIds: string[];
    leaderIds: string[];
    timeoutMs: number;
  }) => void;
  /** Stop every live session the host's node runs, like an idle stop. */
  stopSessions: (hostId: string) => Promise<void>;
  /** Send an interrupted session the restart continuation. */
  continueSession: (sessionId: string, operationId: string) => void;
  interruptTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * The session side of updating a host, whose node restart ends every process
 * on it: what the update must wait for, stopping the sessions first, and, for
 * an immediate update, interrupting turns and continuing them once the host
 * is back on the new build.
 */
export class HostUpdateSessions {
  /** Interrupted sessions per host, continued when its node has restarted. */
  private readonly continuations = new Map<string, { operationId: string; sessionIds: Set<string> }>();

  constructor(private readonly deps: HostUpdateSessionsDeps) {}

  /**
   * What updating the host must wait for now, worded to follow "It updates
   * once", or null when it may update. A landing run there is never cut off,
   * and sessions still waiting to take over their processes are let finish.
   * Only a non-immediate update waits for turns to end.
   */
  blocker(hostId: string, mode: HostUpdateMode): string | null {
    if (this.deps.landingRunOn(hostId)) return "the landing run there finishes";
    const live = this.liveOn(hostId);
    if (live.some((session) => this.deps.awaitingReattach(session.sessionId))) return "its sessions are taken over";
    if (mode === "immediate") return null;
    const idle = hostCanRestart(hostId, {
      sessions: live,
      awaitingReattach: this.deps.awaitingReattach,
      bridgeSession: this.deps.bridgeSession,
      coordinatorStartedAt: this.deps.coordinatorStartedAt,
    });
    return idle ? null : "its sessions finish their turns";
  }

  /**
   * Get the host's sessions ready for the update: stopped like idle sessions,
   * so they relaunch on their next message. Before an immediate update, turns
   * are interrupted first and continued once the host has restarted. Returns
   * false, with the turns continued at once, when something the update must
   * wait for began meanwhile; the update is then tried again later.
   */
  async prepare(hostId: string, mode: HostUpdateMode): Promise<boolean> {
    if (mode === "when_idle") {
      await this.deps.stopSessions(hostId);
      return true;
    }
    const operationId = `host-update:${hostId}:${randomUUID().slice(0, 8)}`;
    const interrupted = this.liveOn(hostId).filter((session) => this.inTurn(session.sessionId));
    if (interrupted.length > 0) {
      const timeoutMs = this.deps.interruptTimeoutMs ?? HOST_UPDATE_INTERRUPT_TIMEOUT_MS;
      this.deps.holdHerdEvents({
        operationId,
        sessionIds: interrupted.map((session) => session.sessionId),
        leaderIds: this.leadersOf(interrupted),
        timeoutMs,
      });
      await Promise.all(
        interrupted.map((session) =>
          this.deps.interrupt(session.sessionId, operationId).catch((error) => {
            console.warn(
              `[host-update] Could not interrupt session ${session.sessionId} before updating its host:`,
              error,
            );
          }),
        ),
      );
      await this.waitUntil(
        () => interrupted.every((session) => !this.deps.bridgeSession(session.sessionId)?.isGenerating),
        timeoutMs,
      );
    }
    const continued = new Set(interrupted.map((session) => session.sessionId));
    if (this.blocker(hostId, "immediate") !== null) {
      for (const sessionId of continued) this.deps.continueSession(sessionId, operationId);
      return false;
    }
    // A turn that began meanwhile ends with the restart too.
    for (const session of this.liveOn(hostId)) if (this.inTurn(session.sessionId)) continued.add(session.sessionId);
    if (continued.size > 0) {
      const pending = this.continuations.get(hostId);
      this.continuations.set(hostId, {
        operationId: pending?.operationId ?? operationId,
        sessionIds: new Set([...(pending?.sessionIds ?? []), ...continued]),
      });
    }
    await this.deps.stopSessions(hostId);
    return true;
  }

  /** The host's node restarted or could not update: continue the turns its update interrupted. */
  hostRestarted(hostId: string): void {
    const pending = this.continuations.get(hostId);
    if (!pending) return;
    this.continuations.delete(hostId);
    for (const sessionId of pending.sessionIds) this.deps.continueSession(sessionId, pending.operationId);
  }

  private liveOn(hostId: string): HostUpdateSession[] {
    return this.deps
      .sessions()
      .filter((session) => processHostOf(session) === hostId && !session.archived && session.state !== "exited");
  }

  private inTurn(sessionId: string): boolean {
    const bridge = this.deps.bridgeSession(sessionId);
    return Boolean(bridge && (bridge.isGenerating || bridge.pendingPermissions.size > 0));
  }

  /** The leaders above the sessions, and the sessions that lead others themselves. */
  private leadersOf(sessions: HostUpdateSession[]): string[] {
    const byId = new Map(this.deps.sessions().map((session) => [session.sessionId, session]));
    const leaders = new Set<string>();
    for (const session of sessions) {
      if (session.isOrchestrator) leaders.add(session.sessionId);
      const seen = new Set([session.sessionId]);
      let leaderId = session.herdedBy ?? null;
      while (leaderId && !seen.has(leaderId)) {
        seen.add(leaderId);
        leaders.add(leaderId);
        leaderId = byId.get(leaderId)?.herdedBy ?? null;
      }
    }
    return [...leaders];
  }

  private async waitUntil(condition: () => boolean, timeoutMs: number): Promise<void> {
    const sleep = this.deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    for (let waited = 0; !condition() && waited < timeoutMs; waited += 100) await sleep(100);
  }
}
