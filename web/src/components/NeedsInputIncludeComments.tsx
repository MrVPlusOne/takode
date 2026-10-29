import { useCallback, useState } from "react";
import type { ConversationAnnotation } from "../../shared/conversation-annotations.js";
import { useStore } from "../store.js";

const NO_COMMENTS: ConversationAnnotation[] = [];

/**
 * The user's pending conversation comments (the composer draft's unsent comments) that a needs-input reply
 * can carry, as the composer's send does. Nothing is included until the user checks the card's box; the
 * comments are read at send time, and only the ones actually sent leave the draft, so comments added while
 * the reply is on its way stay pending.
 */
export function usePendingReplyComments(sessionId: string | undefined) {
  const pending = useStore((s) => (sessionId ? s.composerDrafts.get(sessionId)?.annotations : undefined));
  const comments = pending ?? NO_COMMENTS;
  const [checked, setChecked] = useState(false);
  const include = checked && comments.length > 0;

  /** After the reply arrived: drop the comments it carried from the draft and clear the box. */
  const retire = useCallback(
    (sent: readonly ConversationAnnotation[] | undefined) => {
      setChecked(false);
      if (!sessionId || !sent?.length) return;
      const ids = new Set(sent.map((comment) => comment.id));
      const state = useStore.getState();
      const current = state.composerDrafts.get(sessionId);
      if (current?.annotations?.some((comment) => ids.has(comment.id)))
        state.setComposerDraft(sessionId, {
          ...current,
          annotations: current.annotations.filter((comment) => !ids.has(comment.id)),
        });
      const editor = state.annotationEditor;
      if (editor?.sessionId === sessionId && ids.has(editor.annotation.id)) state.setAnnotationEditor(null);
    },
    [sessionId],
  );

  return {
    count: comments.length,
    checked: include,
    setChecked,
    /** The comments to send with the reply now, or undefined when the box is clear. */
    toSend: include ? comments : undefined,
    retire,
  };
}

export type PendingReplyComments = ReturnType<typeof usePendingReplyComments>;

/** "Include my N comments": shown on a needs-input card only while the user has pending comments. */
export function IncludeCommentsCheckbox({
  count,
  checked,
  onChange,
}: {
  count: number;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  if (count === 0) return null;
  return (
    <label
      className="inline-flex cursor-pointer items-center gap-1.5 px-1 py-1 text-[11px] font-normal cc-muted-readable hover:text-cc-fg"
      onClick={(event) => event.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-cc-primary cursor-pointer"
      />
      {count === 1 ? "Include my comment" : `Include my ${count} comments`}
    </label>
  );
}
