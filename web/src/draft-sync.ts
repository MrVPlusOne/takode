import { readConversationAnnotations } from "../shared/conversation-annotations.js";
import {
  normalizeSyncedNeedsInputAnswers,
  sessionDraftKey,
  type SessionDraftChange,
  type SessionDraftWrite,
  type SessionDraftsState,
  type SyncedComposerDraft,
  type SyncedNeedsInputAnswers,
} from "../shared/session-drafts.js";
import { DraftWriteRejectedError, fetchSessionDrafts, writeSessionDraft } from "./api/session-drafts.js";
import { setLocalDraftChangeListener, type LocalDraftTarget } from "./draft-sync-bridge.js";
import { useStore } from "./store.js";
import { scopedGetItem, scopedRemoveItem } from "./utils/scoped-storage.js";
import { toSyncedComposerDraft } from "./utils/synced-composer-draft.js";

/**
 * Shares unsent drafts (composer text and comments, needs-input answers) between the
 * user's browsers through the server, so a draft started on one device continues on
 * another and survives reloads.
 *
 * - Images are shared once uploaded; their bytes are already on the server, so only
 *   the reference travels (utils/synced-composer-draft.ts).
 * - Traffic: edits are sent after a short pause in typing (at most every
 *   DRAFT_SYNC_MAX_WAIT_MS while typing continues), clears at once, and everything
 *   pending is flushed when the page is hidden.
 * - Concurrent edits: the write the server receives last wins, per draft. A tab never
 *   lets another browser's change overwrite its own unsent edit; it sends its edit,
 *   and adopts the other change only if the server ordered that one after its own.
 */
export const DRAFT_SYNC_DELAY_MS = 400;
export const DRAFT_SYNC_MAX_WAIT_MS = 1500;
const DRAFT_SYNC_RETRY_MS = 5000;

type DraftValue = SyncedComposerDraft | SyncedNeedsInputAnswers | null;

interface DraftSlot {
  target: LocalDraftTarget;
  /** JSON of the value the server is known to hold ("null" when it holds none). */
  serverValue: string;
  /** Highest server revision this tab has seen for the draft. */
  revision: number;
  timer: ReturnType<typeof setTimeout> | null;
  firstQueuedAt: number | null;
  inFlight: boolean;
  resendAfterFlight: boolean;
  /** Another browser's change that arrived while this tab had its own edit pending. */
  deferred: SessionDraftChange | null;
}

const clientId = createClientId();
const slots = new Map<string, Map<string, DraftSlot>>();
const hydratedSessions = new Set<string>();

export function getDraftSyncClientId(): string {
  return clientId;
}

function createClientId(): string {
  const random = globalThis.crypto?.randomUUID?.();
  return random ?? `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function slotFor(sessionId: string, target: LocalDraftTarget): DraftSlot {
  let sessionSlots = slots.get(sessionId);
  if (!sessionSlots) {
    sessionSlots = new Map();
    slots.set(sessionId, sessionSlots);
  }
  const key = sessionDraftKey(target);
  let slot = sessionSlots.get(key);
  if (!slot) {
    slot = {
      target,
      serverValue: "null",
      revision: 0,
      timer: null,
      firstQueuedAt: null,
      inFlight: false,
      resendAfterFlight: false,
      deferred: null,
    };
    sessionSlots.set(key, slot);
  }
  return slot;
}

function isPending(slot: DraftSlot): boolean {
  return slot.timer !== null || slot.inFlight;
}

function localValue(sessionId: string, target: LocalDraftTarget): DraftValue {
  const state = useStore.getState();
  if (target.kind === "composer") return toSyncedComposerDraft(state.composerDrafts.get(sessionId));
  return normalizeSyncedNeedsInputAnswers(state.needsInputDrafts.get(sessionId)?.get(target.notificationId) ?? null);
}

function serialize(value: DraftValue): string {
  return JSON.stringify(value ?? null);
}

function handleLocalDraftChange(sessionId: string, target: LocalDraftTarget): void {
  const slot = slotFor(sessionId, target);
  const value = serialize(localValue(sessionId, target));
  if (!isPending(slot) && value === slot.serverValue) return;
  if (value === "null") {
    sendDraft(sessionId, slot);
    return;
  }
  if (slot.inFlight) {
    slot.resendAfterFlight = true;
    return;
  }
  const now = Date.now();
  slot.firstQueuedAt ??= now;
  const delay = Math.min(DRAFT_SYNC_DELAY_MS, Math.max(0, slot.firstQueuedAt + DRAFT_SYNC_MAX_WAIT_MS - now));
  if (slot.timer) clearTimeout(slot.timer);
  slot.timer = setTimeout(() => sendDraft(sessionId, slot), delay);
}

function sendDraft(sessionId: string, slot: DraftSlot, options: { keepalive?: boolean } = {}): void {
  if (slot.timer) clearTimeout(slot.timer);
  slot.timer = null;
  slot.firstQueuedAt = null;
  if (slot.inFlight) {
    slot.resendAfterFlight = true;
    return;
  }
  const value = localValue(sessionId, slot.target);
  const sent = serialize(value);
  if (sent === slot.serverValue) {
    afterSettled(sessionId, slot);
    return;
  }
  const write: SessionDraftWrite =
    slot.target.kind === "composer"
      ? { kind: "composer", draft: value as SyncedComposerDraft | null }
      : {
          kind: "needs-input",
          notificationId: slot.target.notificationId,
          answers: value as SyncedNeedsInputAnswers | null,
        };
  slot.inFlight = true;
  slot.resendAfterFlight = false;
  writeSessionDraft(sessionId, { clientId, write }, options)
    .then((change) => {
      slot.inFlight = false;
      slot.serverValue = sent;
      slot.revision = Math.max(slot.revision, change.revision);
      afterSettled(sessionId, slot);
    })
    .catch((error: unknown) => {
      slot.inFlight = false;
      if (error instanceof DraftWriteRejectedError) {
        // The server refused this draft for good (resolved prompt, unknown session,
        // oversized text); stop retrying and keep the local copy.
        console.warn("[takode] Draft was not saved:", error.message);
        slot.serverValue = sent;
        afterSettled(sessionId, slot);
        return;
      }
      slot.timer = setTimeout(() => sendDraft(sessionId, slot), DRAFT_SYNC_RETRY_MS);
    });
}

/** After a write settles: send newer local edits, or adopt a later change from another browser. */
function afterSettled(sessionId: string, slot: DraftSlot): void {
  const localChanged = serialize(localValue(sessionId, slot.target)) !== slot.serverValue;
  if (slot.resendAfterFlight || localChanged) {
    slot.deferred = null;
    handleLocalDraftChange(sessionId, slot.target);
    return;
  }
  const deferred = slot.deferred;
  slot.deferred = null;
  if (deferred && deferred.revision > slot.revision) applyChange(sessionId, slot, deferred);
}

function changeValue(change: SessionDraftChange): DraftValue {
  return change.kind === "composer" ? change.draft : change.answers;
}

function applyChange(sessionId: string, slot: DraftSlot, change: SessionDraftChange): void {
  const value = changeValue(change);
  const state = useStore.getState();
  if (change.kind === "composer") state.applySyncedComposerDraft(sessionId, value as SyncedComposerDraft | null);
  else state.applySyncedNeedsInputDraft(sessionId, change.notificationId, value as SyncedNeedsInputAnswers | null);
  slot.serverValue = serialize(value);
  slot.revision = Math.max(slot.revision, change.revision);
}

function targetOf(change: SessionDraftChange): LocalDraftTarget {
  return change.kind === "composer"
    ? { kind: "composer" }
    : { kind: "needs-input", notificationId: change.notificationId };
}

/** Applies another browser's draft change broadcast by the server. */
export function applyRemoteDraftChange(sessionId: string, change: SessionDraftChange): void {
  const slot = slotFor(sessionId, targetOf(change));
  if (change.clientId === clientId) {
    // Our own write's echo; the write's acknowledgement already updated this slot.
    return;
  }
  if (change.revision <= slot.revision) return;
  if (isPending(slot)) {
    if (!slot.deferred || slot.deferred.revision < change.revision) slot.deferred = change;
    return;
  }
  applyChange(sessionId, slot, change);
}

/**
 * Replaces this tab's drafts for a session with the server's, except drafts this tab
 * is still sending. Runs on every subscribe (state_snapshot) and for sessions loaded
 * without a subscription.
 */
export function applySessionDraftsSnapshot(sessionId: string, drafts: SessionDraftsState | undefined): void {
  hydratedSessions.add(sessionId);
  const changes = new Map<string, SessionDraftChange>();
  const revision = drafts?.revision ?? 0;
  const remember = (change: SessionDraftChange) => changes.set(sessionDraftKey(change), change);
  remember({ kind: "composer", draft: drafts?.composer?.draft ?? null, ...meta(drafts?.composer, revision) });
  for (const [notificationId, entry] of Object.entries(drafts?.needsInput ?? {})) {
    remember({ kind: "needs-input", notificationId, answers: entry.answers, ...meta(entry, revision) });
  }
  // Local needs-input drafts the server no longer holds were cleared or resolved elsewhere.
  for (const notificationId of useStore.getState().needsInputDrafts.get(sessionId)?.keys() ?? []) {
    const change: SessionDraftChange = {
      kind: "needs-input",
      notificationId,
      answers: null,
      ...meta(undefined, revision),
    };
    if (!changes.has(sessionDraftKey(change))) remember(change);
  }
  for (const change of changes.values()) {
    const slot = slotFor(sessionId, targetOf(change));
    // Older than what this tab already saw (a fetched snapshot racing a live change).
    if (change.revision < slot.revision) continue;
    if (isPending(slot)) {
      if (change.revision > slot.revision && (!slot.deferred || slot.deferred.revision < change.revision)) {
        slot.deferred = change;
      }
      continue;
    }
    if (serialize(localValue(sessionId, slot.target)) === serialize(changeValue(change))) {
      slot.serverValue = serialize(changeValue(change));
      slot.revision = Math.max(slot.revision, change.revision);
      continue;
    }
    applyChange(sessionId, slot, change);
  }
  adoptLegacyReportCommentDraft(sessionId);
}

function meta(entry: { revision: number; clientId: string; updatedAt: number } | undefined, revision: number) {
  return entry ?? { revision, clientId: "", updatedAt: 0 };
}

/** Loads a session's drafts once for surfaces (like the global needs-input menu) that show unsubscribed sessions. */
export function ensureSessionDraftsLoaded(sessionId: string): void {
  if (hydratedSessions.has(sessionId)) return;
  hydratedSessions.add(sessionId);
  fetchSessionDrafts(sessionId)
    .then((drafts) => applySessionDraftsSnapshot(sessionId, drafts))
    .catch(() => {
      // Not fatal: the next mount, or a subscribe snapshot, loads them again.
      hydratedSessions.delete(sessionId);
    });
}

/** Sends every pending draft now; used when the page is hidden or closed. */
export function flushPendingDrafts(options: { keepalive?: boolean } = {}): void {
  for (const [sessionId, sessionSlots] of slots) {
    for (const slot of sessionSlots.values()) if (slot.timer) sendDraft(sessionId, slot, options);
  }
}

/**
 * One-time move of report comments that the previous build saved in this browser's
 * storage: they become this session's composer draft, which now syncs.
 */
function adoptLegacyReportCommentDraft(sessionId: string): void {
  const key = `report-comment-draft:${sessionId}`;
  let stored: string | null;
  try {
    stored = scopedGetItem(key);
  } catch {
    return;
  }
  if (!stored) return;
  try {
    const state = useStore.getState();
    const current = state.composerDrafts.get(sessionId);
    const parsed = JSON.parse(stored) as { text?: unknown; annotations?: unknown; reportRecipientSessionId?: unknown };
    const annotations = readConversationAnnotations(parsed.annotations);
    if (!current?.text && !current?.annotations?.length && typeof parsed.text === "string") {
      if (annotations.some((annotation) => annotation.reportSource)) {
        state.setComposerDraft(sessionId, {
          text: parsed.text,
          images: current?.images ?? [],
          annotations,
          ...(typeof parsed.reportRecipientSessionId === "string"
            ? { reportRecipientSessionId: parsed.reportRecipientSessionId }
            : {}),
        });
      }
    }
    scopedRemoveItem(key);
  } catch (error) {
    console.warn("[takode] Could not restore saved report comments; the saved copy was kept.", error);
  }
}

export function resetDraftSyncForTests(): void {
  for (const sessionSlots of slots.values()) {
    for (const slot of sessionSlots.values()) if (slot.timer) clearTimeout(slot.timer);
  }
  slots.clear();
  hydratedSessions.clear();
}

setLocalDraftChangeListener(handleLocalDraftChange);

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => flushPendingDrafts({ keepalive: true }));
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushPendingDrafts({ keepalive: true });
  });
}
