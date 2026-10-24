/**
 * Which sessions are Scribes (leaders' topics writers). Bridge and herd code ask here so they can
 * keep a Scribe's routine turns from notifying its leader; the server sets the lookup at startup.
 */
let lookup: (sessionId: string) => boolean = () => false;

export function setScribeLookup(next: (sessionId: string) => boolean): void {
  lookup = next;
}

export function isScribeSession(sessionId: string): boolean {
  return lookup(sessionId);
}
