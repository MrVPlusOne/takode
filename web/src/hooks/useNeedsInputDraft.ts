import { useCallback } from "react";
import { useStore } from "../store.js";
import type { NeedsInputDraftAnswers } from "../store-needs-input-drafts.js";

const EMPTY_ANSWERS: NeedsInputDraftAnswers = {};

/**
 * Unsubmitted answers for one needs-input prompt, held in the store rather than the
 * card so they survive the card remounting and are shared by every surface that
 * renders the same prompt (feed card, global needs-input menu).
 */
export function useNeedsInputDraft(sessionId: string | undefined, notificationId: string | undefined) {
  const answers = useStore(
    (s) =>
      (sessionId && notificationId ? s.needsInputDrafts?.get(sessionId)?.get(notificationId) : undefined) ??
      EMPTY_ANSWERS,
  );
  const setAnswer = useCallback(
    (questionKey: string, value: string) => {
      if (!sessionId || !notificationId) return;
      useStore.getState().setNeedsInputDraftAnswer(sessionId, notificationId, questionKey, value);
    },
    [sessionId, notificationId],
  );
  const clear = useCallback(() => {
    if (!sessionId || !notificationId) return;
    useStore.getState().clearNeedsInputDraft(sessionId, notificationId);
  }, [sessionId, notificationId]);
  return { answers, setAnswer, clear };
}
