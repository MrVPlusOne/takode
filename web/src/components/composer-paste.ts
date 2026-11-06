import { traceInputEvent } from "../utils/input-trace.js";

/** Inserts the text already delivered by a paste, without asking the browser to read the clipboard again. */
export function insertComposerPaste(textarea: HTMLTextAreaElement, text: string): void {
  if (!text || textarea.disabled || textarea.readOnly) return;
  const before = textarea.value.length;
  // Keep the browser's undoable insertion. Native paste can stop after beforeinput without
  // inserting anything; insertText uses this event's text instead of that clipboard path.
  if (!textarea.ownerDocument.execCommand?.("insertText", false, text)) {
    textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, "end");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }
  traceInputEvent({ type: "composer-paste", before, after: textarea.value.length });
}
