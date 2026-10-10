/**
 * Lets store actions report local draft edits to the draft sync (draft-sync.ts)
 * without the store importing it. Remote changes applied by the sync use their
 * own store actions, which do not report back here.
 */
export type LocalDraftTarget = { kind: "composer" } | { kind: "needs-input"; notificationId: string };

type LocalDraftChangeListener = (sessionId: string, target: LocalDraftTarget) => void;

let listener: LocalDraftChangeListener | null = null;

export function setLocalDraftChangeListener(next: LocalDraftChangeListener | null): void {
  listener = next;
}

export function notifyLocalDraftChange(sessionId: string, target: LocalDraftTarget): void {
  listener?.(sessionId, target);
}
