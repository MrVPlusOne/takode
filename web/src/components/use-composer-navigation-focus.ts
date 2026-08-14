import { useEffect, useRef, type RefObject } from "react";
import { useStore } from "../store.js";

export function useComposerNavigationFocus(options: {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  sessionId: string;
  threadKey: string;
  usesTouchKeyboard: boolean;
}): void {
  const { textareaRef, sessionId, threadKey, usesTouchKeyboard } = options;
  const focusTrigger = useStore((state) => state.focusComposerTrigger);
  const previousFocusTriggerRef = useRef(focusTrigger);
  const previousNavigationRef = useRef({ sessionId, threadKey });

  useEffect(() => {
    const previousFocusTrigger = previousFocusTriggerRef.current;
    previousFocusTriggerRef.current = focusTrigger;
    if (typeof focusTrigger !== "number" || typeof previousFocusTrigger !== "number") return;
    if (focusTrigger <= previousFocusTrigger) return;
    textareaRef.current?.focus();
  }, [focusTrigger, textareaRef]);

  useEffect(() => {
    const previous = previousNavigationRef.current;
    previousNavigationRef.current = { sessionId, threadKey };
    if (previous.sessionId === sessionId && previous.threadKey === threadKey) return;
    if (!usesTouchKeyboard || typeof document === "undefined") return;
    if (document.activeElement === textareaRef.current) textareaRef.current?.blur();
  }, [sessionId, textareaRef, threadKey, usesTouchKeyboard]);
}
