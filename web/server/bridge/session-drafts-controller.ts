import {
  normalizeSyncedComposerDraft,
  normalizeSyncedNeedsInputAnswers,
  type SessionDraftChange,
  type SessionDraftWriteRequest,
  type SessionDraftsState,
  type SyncedComposerDraft,
} from "../../shared/session-drafts.js";
import { deriveAttachmentPaths } from "../attachment-paths.js";
import type { BrowserIncomingMessage, SessionNotification } from "../session-types.js";

/** The parts of a bridge session the draft store reads and writes. */
export interface DraftSession {
  id: string;
  drafts?: SessionDraftsState;
  notifications: SessionNotification[];
}

export interface SessionDraftDeps<S extends DraftSession = DraftSession> {
  broadcastToBrowsers: (session: S, message: BrowserIncomingMessage) => void;
  persistSession: (session: S) => void;
  now?: () => number;
}

export type SessionDraftWriteResult = { ok: true; change: SessionDraftChange } | { ok: false; error: string };

function openNeedsInputIds(session: DraftSession): Set<string> {
  return new Set(
    session.notifications
      .filter((notification) => notification.category === "needs-input" && !notification.done)
      .map((notification) => notification.id),
  );
}

/**
 * Drops needs-input drafts whose prompt is resolved or gone. Pruning happens when
 * drafts are read or written rather than on every notification change: browsers
 * clear their own copies from the notification list, so a stale server entry only
 * matters for the next snapshot or the saved session.
 */
export function pruneSessionDrafts(session: DraftSession): boolean {
  const needsInput = session.drafts?.needsInput;
  if (!session.drafts || !needsInput) return false;
  const open = openNeedsInputIds(session);
  const kept = Object.entries(needsInput).filter(([notificationId]) => open.has(notificationId));
  if (kept.length === Object.keys(needsInput).length) return false;
  const { needsInput: _removed, ...rest } = session.drafts;
  session.drafts = kept.length > 0 ? { ...rest, needsInput: Object.fromEntries(kept) } : rest;
  return true;
}

/** Current drafts for a browser snapshot, with resolved prompts' drafts removed. */
export function getSessionDraftsSnapshot(session: DraftSession): SessionDraftsState | undefined {
  pruneSessionDrafts(session);
  return session.drafts;
}

/**
 * Applies one browser write, last write wins: the server's arrival order decides,
 * recorded as a per-session revision. The change is acknowledged to the writer and
 * broadcast to every browser of the session, which ignore their own echoes.
 */
export function applySessionDraftWrite<S extends DraftSession>(
  session: S,
  request: SessionDraftWriteRequest,
  deps: SessionDraftDeps<S>,
): SessionDraftWriteResult {
  const { write, clientId } = request;
  if (write.kind === "needs-input" && write.answers && !openNeedsInputIds(session).has(write.notificationId)) {
    return { ok: false, error: "This prompt is already resolved." };
  }
  pruneSessionDrafts(session);
  const updatedAt = (deps.now ?? Date.now)();
  const revision = (session.drafts?.revision ?? 0) + 1;
  const meta = { revision, clientId, updatedAt };
  const drafts: SessionDraftsState = { ...session.drafts, revision };
  let change: SessionDraftChange;
  if (write.kind === "composer") {
    const draft = normalizeSyncedComposerDraft(withServerImagePaths(session.id, write.draft));
    if (draft) drafts.composer = { ...meta, draft };
    else delete drafts.composer;
    change = { kind: "composer", draft, ...meta };
  } else {
    const answers = normalizeSyncedNeedsInputAnswers(write.answers);
    const needsInput = { ...drafts.needsInput };
    if (answers) needsInput[write.notificationId] = { ...meta, answers };
    else delete needsInput[write.notificationId];
    if (Object.keys(needsInput).length > 0) drafts.needsInput = needsInput;
    else delete drafts.needsInput;
    change = { kind: "needs-input", notificationId: write.notificationId, answers, ...meta };
  }
  session.drafts = drafts;
  deps.persistSession(session);
  deps.broadcastToBrowsers(session, { type: "session_draft_update", change });
  return { ok: true, change };
}

/**
 * Fills each draft image's agent-visible path from its server reference, so a path
 * written by a browser is never passed on. It is the path image preparation returned.
 */
function withServerImagePaths(sessionId: string, draft: SyncedComposerDraft | null): SyncedComposerDraft | null {
  if (!draft?.images?.length) return draft;
  const paths = deriveAttachmentPaths(
    sessionId,
    draft.images.map((image) => image.imageRef),
  );
  return { ...draft, images: draft.images.map((image, index) => ({ ...image, path: paths[index]! })) };
}
