/**
 * Which sessions are Scribes (the agents that keep leaders' topic pages), and what happens when a
 * Scribe ends a turn. Bridge and herd code ask here so they can keep a Scribe's routine turns from
 * notifying its leader, and report its turn ends to the topic service; the server sets the hooks
 * at startup.
 */
interface ScribeHooks {
  isScribe: (sessionId: string) => boolean;
  /** `unfinished`: the turn was interrupted or failed rather than finished normally. */
  turnEnded: (sessionId: string, outcome: { unfinished: boolean }) => void;
}

/** What a turn end says about whether the turn finished, as `turn_end` event data carries it. */
export interface TurnEndOutcome {
  reason?: string;
  is_error?: boolean;
  interrupted?: boolean;
  provisional?: boolean;
  recovery_pending?: boolean;
}

/** Turn-end reasons of a turn that stopped before it finished (a disconnect, a stuck turn, a failed start). */
const UNFINISHED_REASON = /disconnect|stuck|timeout|failure|error|interrupt|suppressed/;

let hooks: ScribeHooks = { isScribe: () => false, turnEnded: () => {} };

export function setScribeHooks(next: ScribeHooks): void {
  hooks = next;
}

export function isScribeSession(sessionId: string): boolean {
  return hooks.isScribe(sessionId);
}

/**
 * Called for every session's turn end; only a Scribe's reaches the topic service. A provisional
 * end (the backend may still finish) is not a turn end yet.
 */
export function noteTurnEnded(sessionId: string, data: TurnEndOutcome = {}): void {
  if (!hooks.isScribe(sessionId) || data.provisional || data.recovery_pending) return;
  const unfinished = !!data.interrupted || !!data.is_error || UNFINISHED_REASON.test(data.reason ?? "");
  hooks.turnEnded(sessionId, { unfinished });
}
