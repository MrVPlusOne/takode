import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from "react";

const VIEWPORT_SCROLL_KEYS = new Set(["ArrowDown", "ArrowUp", "End", "Home", "PageDown", "PageUp", " "]);
const OVERLAY_SCROLLBAR_GUTTER_PX = 16;

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof Element
    ? Boolean(target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]'))
    : false;
}

function isKeyboardIntentScopedToContainer(target: EventTarget | null, container: HTMLDivElement): boolean {
  if (target === document || target === document.body || target === document.documentElement) return true;
  return target instanceof Node && container.contains(target);
}

function canScrollForKey(container: HTMLDivElement, key: string, shiftKey: boolean): boolean {
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  if (maxScrollTop <= 0) return false;
  const scrollsUp = key === "ArrowUp" || key === "Home" || key === "PageUp" || (key === " " && shiftKey);
  return scrollsUp ? container.scrollTop > 0 : container.scrollTop < maxScrollTop;
}

export function useMessageFeedManualScrollHandlers({
  boundaryTriggerPx,
  containerRef,
  getRealContentBottom,
  onUserNavigationIntent,
  triggerSectionLoadNearBoundary,
}: {
  boundaryTriggerPx: number;
  containerRef: RefObject<HTMLDivElement | null>;
  getRealContentBottom: () => number | null;
  onUserNavigationIntent: () => void;
  triggerSectionLoadNearBoundary: (direction: "older" | "newer") => void;
}) {
  const pendingKeyboardIntentUntilRef = useRef(0);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const container = containerRef.current;
      if (!container || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (!VIEWPORT_SCROLL_KEYS.has(event.key) || isEditableTarget(event.target)) return;
      if (!isKeyboardIntentScopedToContainer(event.target, container)) return;
      if (event.key === " " && event.target instanceof Element && event.target.closest("button, a")) return;
      if (!canScrollForKey(container, event.key, event.shiftKey)) return;
      pendingKeyboardIntentUntilRef.current = Date.now() + 750;
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [containerRef]);

  const handleKeyboardScroll = useCallback(() => {
    if (pendingKeyboardIntentUntilRef.current < Date.now()) return;
    pendingKeyboardIntentUntilRef.current = 0;
    onUserNavigationIntent();
  }, [onUserNavigationIntent]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container || event.button !== 0 || event.target !== container) return;
      const rect = container.getBoundingClientRect();
      const scrollbarWidth = Math.max(OVERLAY_SCROLLBAR_GUTTER_PX, container.offsetWidth - container.clientWidth);
      if (event.clientX >= rect.right - scrollbarWidth && event.clientX <= rect.right) onUserNavigationIntent();
    },
    [containerRef, onUserNavigationIntent],
  );

  const handleWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      const container = containerRef.current;
      if (!container) return;
      if (event.deltaY !== 0) onUserNavigationIntent();
      if (event.deltaY < 0 && container.scrollTop <= boundaryTriggerPx) {
        triggerSectionLoadNearBoundary("older");
        return;
      }
      const realContentBottom = getRealContentBottom() ?? container.scrollHeight;
      if (event.deltaY > 0 && realContentBottom - container.scrollTop - container.clientHeight <= boundaryTriggerPx) {
        triggerSectionLoadNearBoundary("newer");
      }
    },
    [boundaryTriggerPx, containerRef, getRealContentBottom, onUserNavigationIntent, triggerSectionLoadNearBoundary],
  );

  return { handleKeyboardScroll, handlePointerDown, handleTouchMove: onUserNavigationIntent, handleWheel };
}
