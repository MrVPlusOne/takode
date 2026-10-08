import { processHostOf } from "./host-registry.js";

/** What the restart gate needs to know about one session. */
export interface HostSessionView {
  sessionId: string;
  hostId?: string;
  hostProcId?: string;
  archived?: boolean;
  /** Launcher state; an `exited` session has no process a restart could end. */
  state: string;
}

/** The bridge's view of a session's turn. */
export interface BridgeTurnView {
  isGenerating: boolean;
  pendingPermissions: { size: number };
  messageHistory: ReadonlyArray<{ type: string; timestamp?: number }>;
}

/**
 * Whether restarting `takode node` on a host would end no turn: every live
 * session on it is idle. A session whose process this coordinator took over
 * after its own restart has no turn state yet, so a turn its history shows
 * opened before `coordinatorStartedAt` and never finished counts as running.
 */
export function hostCanRestart(
  hostId: string,
  deps: {
    sessions: HostSessionView[];
    awaitingReattach: (sessionId: string) => boolean;
    bridgeSession: (sessionId: string) => BridgeTurnView | undefined;
    coordinatorStartedAt: number;
  },
): boolean {
  return deps.sessions.every((session) => {
    if (processHostOf(session) !== hostId || session.archived || session.state === "exited") return true;
    if (deps.awaitingReattach(session.sessionId)) return false;
    const bridge = deps.bridgeSession(session.sessionId);
    if (!bridge) return true;
    if (bridge.isGenerating || bridge.pendingPermissions.size > 0) return false;
    const opened = openTurnStartedAt(bridge.messageHistory);
    return opened === null || opened >= deps.coordinatorStartedAt;
  });
}

/** When the last user message without a later result was sent, or null when the last turn finished. */
export function openTurnStartedAt(history: BridgeTurnView["messageHistory"]): number | null {
  for (let index = history.length - 1; index >= 0; index--) {
    const message = history[index]!;
    if (message.type === "result") return null;
    if (message.type === "user_message") return message.timestamp ?? 0;
  }
  return null;
}
