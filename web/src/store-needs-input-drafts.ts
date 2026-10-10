import type { StateCreator } from "zustand";
import type { AppState } from "./store-types.js";

type StoreSet = Parameters<StateCreator<AppState>>[0];
type NeedsInputDraftStoreSlice = Pick<
  AppState,
  "needsInputDrafts" | "setNeedsInputDraftAnswer" | "clearNeedsInputDraft" | "retainNeedsInputDrafts"
>;

/** Answers typed or picked per question key for one unsubmitted needs-input prompt. */
export type NeedsInputDraftAnswers = Record<string, string>;

/**
 * Unsubmitted needs-input answers, keyed by session and then notification ID.
 *
 * Like composer drafts, these are local UI state rather than session state: the
 * server owns the notification, while the user's partly filled answers live here so
 * they survive the card remounting when the feed regroups, a thread window is
 * replaced, or the user sends another message. A draft ends when the user submits
 * the prompt or the server reports the notification resolved or gone.
 */
export function createNeedsInputDraftStoreSlice(set: StoreSet): NeedsInputDraftStoreSlice {
  return {
    needsInputDrafts: new Map(),

    setNeedsInputDraftAnswer: (sessionId, notificationId, questionKey, value) =>
      set((s) => {
        const current = s.needsInputDrafts.get(sessionId)?.get(notificationId) ?? {};
        if ((current[questionKey] ?? "") === value) return s;
        const nextAnswers: NeedsInputDraftAnswers = { ...current };
        if (value) nextAnswers[questionKey] = value;
        else delete nextAnswers[questionKey];
        const sessionDrafts = new Map(s.needsInputDrafts.get(sessionId));
        if (Object.keys(nextAnswers).length > 0) sessionDrafts.set(notificationId, nextAnswers);
        else sessionDrafts.delete(notificationId);
        return { needsInputDrafts: withSessionDrafts(s.needsInputDrafts, sessionId, sessionDrafts) };
      }),

    clearNeedsInputDraft: (sessionId, notificationId) =>
      set((s) => {
        if (!s.needsInputDrafts.get(sessionId)?.has(notificationId)) return s;
        const sessionDrafts = new Map(s.needsInputDrafts.get(sessionId));
        sessionDrafts.delete(notificationId);
        return { needsInputDrafts: withSessionDrafts(s.needsInputDrafts, sessionId, sessionDrafts) };
      }),

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
