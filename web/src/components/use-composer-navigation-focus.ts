import { useEffect, useRef, type RefObject } from "react";
import { useStore } from "../store.js";

export function useComposerNavigationFocus(options: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  sessionId: string;
  threadKey: string;
  usesTouchKeyboard: boolean;
  /** This composer's draft key: a focus request naming it reaches it (see `focusComposer`). */
  draftKey?: string;
  /** False for a composer beside the main one, which focus requests reach only by naming it. */
  enabled?: boolean;
}): void {
  const { textareaRef, sessionId, threadKey, usesTouchKeyboard, draftKey = sessionId, enabled = true } = options;
  const focusTrigger = useStore((state) => state.focusComposerTrigger);
  const previousFocusTriggerRef = useRef(focusTrigger);
  const previousNavigationRef = useRef({ sessionId, threadKey });

  useEffect(() => {
    const previousFocusTrigger = previousFocusTriggerRef.current;
    previousFocusTriggerRef.current = focusTrigger;
    if (typeof focusTrigger !== "number" || typeof previousFocusTrigger !== "number") return;
    if (focusTrigger <= previousFocusTrigger) return;
    // A request for one composer (a side chat's after a Reply there) reaches only that one; one naming
    // none, the main composer.
    const target = useStore.getState().focusComposerTarget;
    if (target ? target !== draftKey : !enabled) return;
    if (target && useStore.getState().focusComposerPending === target)
      useStore.setState({ focusComposerPending: null });
    focusAtEnd(textareaRef.current);
  }, [draftKey, enabled, focusTrigger, textareaRef]);

  // A request made before this composer appeared (`focusComposer(draftKey, { whenShown: true })`).
  // It is taken a frame later, once the view that brought the composer has settled: a composer
  // shown and replaced at once (a remount) leaves the request to its replacement.
  useEffect(() => {
    if (useStore.getState().focusComposerPending !== draftKey) return;
    const frame = requestAnimationFrame(() => {
      if (useStore.getState().focusComposerPending !== draftKey || !textareaRef.current) return;
      useStore.setState({ focusComposerPending: null });
      focusAtEnd(textareaRef.current);
    });
    return () => cancelAnimationFrame(frame);
  }, [draftKey, textareaRef]);

  useEffect(() => {
    const previous = previousNavigationRef.current;
    previousNavigationRef.current = { sessionId, threadKey };
    if (previous.sessionId === sessionId && previous.threadKey === threadKey) return;
    if (!usesTouchKeyboard || typeof document === "undefined") return;
    if (document.activeElement === textareaRef.current) textareaRef.current?.blur();
  }, [sessionId, textareaRef, threadKey, usesTouchKeyboard]);
}

/** A focus request means "continue typing here": the cursor goes after the draft, not where it last was. */
function focusAtEnd(textarea: HTMLTextAreaElement | null): void {
  if (!textarea) return;
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}
