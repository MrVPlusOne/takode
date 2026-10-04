import { useEffect, useRef, useState } from "react";
import { readConversationAnnotations } from "../../shared/conversation-annotations.js";
import { useStore } from "../store.js";
import { scopedGetItem, scopedRemoveItem, scopedSetItem } from "../utils/scoped-storage.js";

/** Persist editable report comments locally; authoritative sent history remains server-owned. */
export function useReportCommentDraft(sessionId: string): string | null {
  const draft = useStore((state) => state.composerDrafts.get(sessionId));
  const observed = useRef<{ sessionId: string; draft: typeof draft } | null>(null);
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
    observed.current = { sessionId, draft: useStore.getState().composerDrafts.get(sessionId) };
  }, [sessionId]);
  useEffect(() => {
    if (observed.current?.sessionId !== sessionId || observed.current.draft === draft) return;
    if (useStore.getState().composerDrafts.get(sessionId) !== draft) return;
    observed.current = { sessionId, draft };
    const key = `report-comment-draft:${sessionId}`;
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
  }, [sessionId, draft]);
  return error;
}
