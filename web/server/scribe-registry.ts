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
  /** "restart_prep": Restart Server (or a host update) interrupted the turn and continues it afterwards. */
  interrupt_origin?: string;
}

/** Turn-end reasons of a turn that stopped before it finished (a disconnect, a stuck turn, a failed start). */
const UNFINISHED_REASON = /disconnect|stuck|timeout|failure|error|interrupt|suppressed/;

let hooks: ScribeHooks = { isScribe: () => false, turnEnded: () => {} };

/**
 * Scribe turn ends not reported yet. A failed Claude turn ends with an ordinary result and its
 * error follows as a session error in the same handling, so each end waits a tick for it.
 */
const ending = new Map<string, { unfinished: boolean }>();

export function setScribeHooks(next: ScribeHooks): void {
  hooks = next;
}

export function isScribeSession(sessionId: string): boolean {
  return hooks.isScribe(sessionId);
}

/**
 * Called for every session's turn end; only a Scribe's reaches the topic service. A provisional
 * end (the backend may still finish) is not a turn end yet, and neither is a turn a restart
 * interrupted: the restart continues it, so it is neither finished nor failed.
 */
export function noteTurnEnded(sessionId: string, data: TurnEndOutcome = {}): void {
  if (!hooks.isScribe(sessionId) || data.provisional || data.recovery_pending) return;
  if (data.interrupt_origin === "restart_prep") return;
  const unfinished = !!data.interrupted || !!data.is_error || UNFINISHED_REASON.test(data.reason ?? "");
  const outcome = { unfinished };
  ending.set(sessionId, outcome);
  setTimeout(() => {
    if (ending.get(sessionId) === outcome) ending.delete(sessionId);
    hooks.turnEnded(sessionId, outcome);
  }, 0);
}

/** A session reported an error; right after a Scribe's turn end, it means that turn failed. */
export function noteSessionError(sessionId: string): void {
  const outcome = ending.get(sessionId);
  if (outcome) outcome.unfinished = true;
}
