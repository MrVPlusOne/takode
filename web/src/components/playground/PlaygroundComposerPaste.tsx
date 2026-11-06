import { useEffect } from "react";
import { Composer } from "../Composer.js";
import { ComposerFeedLayout } from "../ComposerFeedLayout.js";
import { useStore } from "../../store.js";
import { MOCK_SESSION_ID } from "./fixtures.js";

const DRAFT_KEY = "playground-paste-draft";

/** Real secondary composer for paste into existing text, selected replacement, images and undo. */
export function PlaygroundComposerPaste() {
  const reset = () => useStore.getState().setComposerDraft(DRAFT_KEY, { text: "Before link after", images: [] });
  useEffect(() => {
    reset();
  }, []);
  return (
    <div data-testid="playground-composer-paste" className="space-y-2">
      <p className="text-xs text-cc-muted">
        Place the caret in the draft or select “link”, then paste. Check that it inserts once and Undo restores the
        draft.
      </p>
      <button
        type="button"
        title="Restore the sample draft for another paste check"
        onClick={reset}
        className="rounded bg-cc-hover px-3 py-1 text-xs"
      >
        Reset sample draft
      </button>
      <div data-testid="side-column" className="h-[260px] border border-cc-border rounded-xl overflow-hidden">
        <ComposerFeedLayout>
          <div className="flex-1 p-4 text-xs text-cc-muted">Example conversation</div>
          <Composer sessionId={MOCK_SESSION_ID} draftKey={DRAFT_KEY} secondary />
        </ComposerFeedLayout>
      </div>
    </div>
  );
}
