import type { StateCreator } from "zustand";
import { notifyLocalDraftChange } from "./draft-sync-bridge.js";
import type { AppState } from "./store-types.js";

type StoreSet = Parameters<StateCreator<AppState>>[0];
type NeedsInputDraftStoreSlice = Pick<
  AppState,
  | "needsInputDrafts"
  | "setNeedsInputDraftAnswer"
  | "clearNeedsInputDraft"
  | "retainNeedsInputDrafts"
  | "applySyncedNeedsInputDraft"
>;

/** Answers typed or picked per question key for one unsubmitted needs-input prompt. */
export type NeedsInputDraftAnswers = Record<string, string>;

/**
 * Unsent needs-input answers, keyed by session and then notification ID.
 *
 * The server keeps these drafts so every browser of the user shares them and they
 * survive reloads (draft-sync.ts); this map is the browser's working copy. Holding
 * it in the store rather than the card keeps answers when the card remounts as the
 * feed regroups. Local edits are reported to the draft sync; changes from other
 * browsers arrive through `applySyncedNeedsInputDraft`. A draft ends when the user
 * submits the prompt or the server reports the notification resolved or gone.
 */
export function createNeedsInputDraftStoreSlice(set: StoreSet): NeedsInputDraftStoreSlice {
  return {
    needsInputDrafts: new Map(),

    setNeedsInputDraftAnswer: (sessionId, notificationId, questionKey, value) => {
      set((s) => {
        const current = s.needsInputDrafts.get(sessionId)?.get(notificationId) ?? {};
        if ((current[questionKey] ?? "") === value) return s;
        const nextAnswers: NeedsInputDraftAnswers = { ...current };
        if (value) nextAnswers[questionKey] = value;
        else delete nextAnswers[questionKey];
        return withDraft(s, sessionId, notificationId, nextAnswers);
      });
      notifyLocalDraftChange(sessionId, { kind: "needs-input", notificationId });
    },

    clearNeedsInputDraft: (sessionId, notificationId) => {
      set((s) => withDraft(s, sessionId, notificationId, null));
      notifyLocalDraftChange(sessionId, { kind: "needs-input", notificationId });
    },

    applySyncedNeedsInputDraft: (sessionId, notificationId, answers) =>
      set((s) => withDraft(s, sessionId, notificationId, answers)),

    retainNeedsInputDrafts: (sessionId, openNotificationIds) =>
      set((s) => {
        const current = s.needsInputDrafts.get(sessionId);
        if (!current) return s;
        const sessionDrafts = new Map([...current].filter(([id]) => openNotificationIds.has(id)));
        if (sessionDrafts.size === current.size) return s;
        return { needsInputDrafts: withSessionDrafts(s.needsInputDrafts, sessionId, sessionDrafts) };
      }),
  };
}

/** Sets or (with null or no answers) removes one prompt's draft. */
function withDraft(
  s: AppState,
  sessionId: string,
  notificationId: string,
  answers: NeedsInputDraftAnswers | null,
): AppState | Partial<AppState> {
  const hasAnswers = !!answers && Object.keys(answers).length > 0;
  if (!hasAnswers && !s.needsInputDrafts.get(sessionId)?.has(notificationId)) return s;
  const sessionDrafts = new Map(s.needsInputDrafts.get(sessionId));
  if (hasAnswers) sessionDrafts.set(notificationId, answers);
  else sessionDrafts.delete(notificationId);
  return { needsInputDrafts: withSessionDrafts(s.needsInputDrafts, sessionId, sessionDrafts) };
}

function withSessionDrafts(
  drafts: Map<string, Map<string, NeedsInputDraftAnswers>>,
  sessionId: string,
  sessionDrafts: Map<string, NeedsInputDraftAnswers>,
): Map<string, Map<string, NeedsInputDraftAnswers>> {
  const next = new Map(drafts);
  if (sessionDrafts.size > 0) next.set(sessionId, sessionDrafts);
  else next.delete(sessionId);
  return next;
}
