/**
 * Which sessions are Scribes (the agents that keep leaders' topic pages), and what happens when a
 * Scribe ends a turn. Bridge and herd code ask here so they can keep a Scribe's routine turns from
 * notifying its leader, and report its turn ends to the topic service; the server sets the hooks
 * at startup.
 */
interface ScribeHooks {
  isScribe: (sessionId: string) => boolean;
  turnEnded: (sessionId: string) => void;
}

let hooks: ScribeHooks = { isScribe: () => false, turnEnded: () => {} };

export function setScribeHooks(next: ScribeHooks): void {
  hooks = next;
}

export function isScribeSession(sessionId: string): boolean {
  return hooks.isScribe(sessionId);
}

/** Called for every session's turn end; only a Scribe's reaches the topic service. */
export function noteTurnEnded(sessionId: string): void {
  if (hooks.isScribe(sessionId)) hooks.turnEnded(sessionId);
}
