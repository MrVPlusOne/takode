import { useRef, useState } from "react";
import { useStore } from "../store.js";

/** Keep the captured draft until authoritative acceptance; failures never change its recipient. */
export function useReportCommentSend(sessionId: string, threadKey: string) {
  const pending = useRef(false);
  const [status, setStatus] = useState<{ sessionId: string; message: string } | null>(null);
  async function send(): Promise<boolean> {
    if (pending.current) return false;
    const draft = useStore.getState().composerDrafts.get(sessionId);
    if (!draft?.annotations?.some((annotation) => annotation.reportSource)) return false;
    pending.current = true;
    try {
      if (!draft.reportRecipientSessionId) throw new Error("Choose who should receive the report comments.");
      if (
        draft.images.length ||
        useStore.getState().replyContexts.get(sessionId) ||
        draft.annotations.some((a) => !a.reportSource)
      ) {
        throw new Error(
          "Send report comments separately from images, replies, or comments on other messages. Your draft has been kept.",
        );
      }
      setStatus({ sessionId, message: "Sending report comments…" });
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/report-annotations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: draft.text,
          annotations: draft.annotations,
          threadKey,
          recipientSessionId: draft.reportRecipientSessionId,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Comments were not accepted. Your draft has been kept.");
      const store = useStore.getState();
      // A late acknowledgement must not erase text or comments edited during the request.
      if (store.composerDrafts.get(sessionId) === draft) store.clearComposerDraft(sessionId);
      setStatus({
        sessionId,
        message:
          result.recipientSessionId === sessionId
            ? "Comments sent to this session."
            : "Comments sent to the recorded worker.",
      });
      return true;
    } catch (error) {
      setStatus({
        sessionId,
        message: error instanceof Error ? error.message : "Could not send comments. Your draft has been kept.",
      });
      return false;
    } finally {
      pending.current = false;
    }
  }
  return { send, status: status?.sessionId === sessionId ? status.message : null };
}
