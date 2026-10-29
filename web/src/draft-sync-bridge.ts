/**
 * Lets store actions report local draft edits to the draft sync (draft-sync.ts)
 * without the store importing it. Remote changes applied by the sync use their
 * own store actions, which do not report back here.
 */
export type LocalDraftTarget =
  | { kind: "composer" }
  | { kind: "side-composer"; place: string }
  | { kind: "needs-input"; notificationId: string }
  | { kind: "guided-review"; reviewId: string };

type LocalDraftChangeListener = (sessionId: string, target: LocalDraftTarget) => void;

let listener: LocalDraftChangeListener | null = null;

export function setLocalDraftChangeListener(next: LocalDraftChangeListener | null): void {
  listener = next;
}

export function notifyLocalDraftChange(sessionId: string, target: LocalDraftTarget): void {
  listener?.(sessionId, target);
}

const SIDE_PLACE_SEPARATOR = "#side:";

/**
 * The store key of a side column message box's draft (`composerDrafts`): its leader session, then
 * its place, the thread the side conversation shows or `new` for the side chat not started yet.
 * The main message box's key is the session ID itself.
 */
export function sideComposerDraftKey(sessionId: string, place: string): string {
  return `${sessionId}${SIDE_PLACE_SEPARATOR}${place.toLowerCase()}`;
}

/** The session and synced draft a `composerDrafts` key belongs to. */
export function composerDraftOwner(key: string): { sessionId: string; target: LocalDraftTarget } {
  const at = key.indexOf(SIDE_PLACE_SEPARATOR);
  if (at < 0) return { sessionId: key, target: { kind: "composer" } };
  return {
    sessionId: key.slice(0, at),
    target: { kind: "side-composer", place: key.slice(at + SIDE_PLACE_SEPARATOR.length) },
  };
}
