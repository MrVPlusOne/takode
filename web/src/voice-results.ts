/**
 * Puts finished voice transcriptions into the draft they were recorded for, exactly once.
 *
 * The server keeps every result that names its target draft until one browser claims it
 * (`shared/voice-results.ts`). The browser that recorded it claims it as soon as its request
 * returns; any browser shown the session claims results nobody took, such as after the recording
 * browser was reloaded or suspended. Drafts are synced, so the text reaches every browser.
 */
import { getGuidedReviewDraft, setGuidedReviewAnswer, setGuidedReviewMessage } from "./guided-review-state.js";
import { addTranscriptionTag } from "../shared/transcription-tag.js";
import { mergeVoiceText, type PendingVoiceResult } from "../shared/voice-results.js";
import { claimVoiceResult } from "./api/session-drafts.js";
import { useStore } from "./store.js";

/** How long a result announced by the server is left to the browser that recorded it, which applies it with more context. */
export const RECOVERY_GRACE_MS = 3_000;

/** This tab's own requests still running; their results come back with the request. */
const ownRequests = new Set<string>();
const claiming = new Set<string>();

/** Marks a request this tab is waiting for; call the returned function when it settles. */
export function trackOwnVoiceRequest(requestId: string): () => void {
  ownRequests.add(requestId);
  return () => ownRequests.delete(requestId);
}

/**
 * For the recording browser: whether it may apply its result. A result the server kept must be
 * claimed first, so it is never applied twice; one not kept (no target named) is this tab's alone.
 * When the claim cannot be made the result stays on the server for the next browser shown the session.
 */
export async function claimOwnVoiceResult(
  sessionId: string,
  requestId: string,
  result: { recoverable?: boolean },
): Promise<boolean> {
  if (!result.recoverable) return true;
  claiming.add(requestId);
  try {
    return (await claimVoiceResult(sessionId, requestId)) !== null;
  } catch (error) {
    console.warn("[voice] Could not claim the transcription; it stays saved for this session:", error);
    return false;
  } finally {
    claiming.delete(requestId);
  }
}

/** A result the server is keeping, from a session snapshot (`delayMs` 0) or a live announcement. */
export function receivePendingVoiceResult(sessionId: string, pending: PendingVoiceResult, delayMs: number): void {
  const claim = async () => {
    if (ownRequests.has(pending.requestId) || claiming.has(pending.requestId)) return;
    claiming.add(pending.requestId);
    try {
      const claimed = await claimVoiceResult(sessionId, pending.requestId);
      if (claimed) applyRecoveredVoiceResult(sessionId, claimed);
    } catch (error) {
      console.warn("[voice] Could not claim a saved transcription:", error);
    } finally {
      claiming.delete(pending.requestId);
    }
  };
  if (delayMs > 0) setTimeout(() => void claim(), delayMs);
  else void claim();
}

/** The draft text after inserting a transcript, tagged as transcribed when anything was said. */
export function insertVoiceText(current: string, pending: Pick<PendingVoiceResult, "target" | "text">): string {
  const merged = mergeVoiceText(current, pending.target, pending.text);
  return pending.text.trim() ? addTranscriptionTag(merged) : merged;
}

/**
 * Puts a claimed result into its draft. A voice edit becomes a proposal in its composer, but only
 * while the composer still holds the text it edits; otherwise accepting it would drop newer text.
 */
export function applyRecoveredVoiceResult(sessionId: string, pending: PendingVoiceResult): void {
  const store = useStore.getState();
  const { target } = pending;
  if (target.kind === "guided-review") {
    const draft = getGuidedReviewDraft(target.reviewId);
    if (target.stopKey === "message") {
      setGuidedReviewMessage(sessionId, target.reviewId, insertVoiceText(draft?.message ?? "", pending));
      return;
    }
    const current = draft?.answers[target.stopKey] ?? "";
    setGuidedReviewAnswer(sessionId, target.reviewId, Number(target.stopKey), insertVoiceText(current, pending));
    return;
  }
  if (target.kind === "needs-input") {
    const current = store.needsInputDrafts.get(sessionId)?.get(target.notificationId)?.[target.questionKey] ?? "";
    store.setNeedsInputDraftAnswer(
      sessionId,
      target.notificationId,
      target.questionKey,
      insertVoiceText(current, pending),
    );
    return;
  }
  const draft = store.composerDrafts.get(sessionId);
  const current = draft?.text ?? "";
  if (pending.mode === "edit") {
    if (current !== target.baseText) return;
    store.setRecoveredVoiceEdit(sessionId, {
      originalText: target.baseText,
      editedText: pending.text,
      instructionText: pending.instructionText ?? "",
    });
    return;
  }
  store.setComposerDraft(sessionId, { ...draft, text: insertVoiceText(current, pending), images: draft?.images ?? [] });
}
