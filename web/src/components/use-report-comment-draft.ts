import { useEffect, useState } from "react";
import { readConversationAnnotations } from "../../shared/conversation-annotations.js";
import { useStore } from "../store.js";
import { scopedGetItem, scopedRemoveItem, scopedSetItem } from "../utils/scoped-storage.js";

/** Persist editable report comments locally; authoritative sent history remains server-owned. */
export function useReportCommentDraft(sessionId: string): string | null {
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const key = `report-comment-draft:${sessionId}`;
    setError(null);
    try {
      const current = useStore.getState().composerDrafts.get(sessionId);
      const stored = scopedGetItem(key);
      if (stored && !current) {
        const parsed = JSON.parse(stored);
        const annotations = readConversationAnnotations(parsed.annotations);
        if (typeof parsed.text !== "string" || !annotations.some((annotation) => annotation.reportSource)) {
          throw new Error("Invalid saved report comments.");
        }
        useStore.getState().setComposerDraft(sessionId, {
          text: parsed.text,
          images: [],
          annotations,
          ...(typeof parsed.reportRecipientSessionId === "string"
            ? { reportRecipientSessionId: parsed.reportRecipientSessionId }
            : {}),
        });
      }
    } catch (cause) {
      console.error("Could not restore report comments:", cause);
      setError("Saved report comments could not be restored. The saved copy was kept.");
    }
    return useStore.subscribe((state, previous) => {
      const draft = state.composerDrafts.get(sessionId);
      if (draft === previous.composerDrafts.get(sessionId)) return;
      try {
        if (draft?.annotations?.some((annotation) => annotation.reportSource)) {
          scopedSetItem(
            key,
            JSON.stringify({
              text: draft.text,
              annotations: draft.annotations,
              reportRecipientSessionId: draft.reportRecipientSessionId,
            }),
          );
        } else scopedRemoveItem(key);
        setError(null);
      } catch (cause) {
        console.error("Could not save report comments:", cause);
        setError("Report comments remain in this tab but could not be saved for reload.");
      }
    });
  }, [sessionId]);
  return error;
}
