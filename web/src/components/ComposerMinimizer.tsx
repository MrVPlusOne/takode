import { createContext, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useComposerOverlayMeasurement } from "./ComposerFeedLayout.js";

export const ComposerVisibilityContext = createContext(true);

/** Own deliberate focus changes while keeping the draft and attachments mounted. */
export function ComposerMinimizer({
  children,
  destination,
  expanded,
  onExpandedChange,
  overlay = false,
}: {
  children: ReactNode;
  destination: string;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  overlay?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const insidePointerEvent = useRef<Event | null>(null);
  const insideFocusEvent = useRef<Event | null>(null);
  useComposerOverlayMeasurement(root, overlay);

  useEffect(() => {
    const pointerDown = (event: PointerEvent) => {
      const inside = event === insidePointerEvent.current || (root.current?.contains(event.target as Node) ?? false);
      insidePointerEvent.current = null;
      if (!inside) onExpandedChange(false);
    };
    const focusIn = (event: FocusEvent) => {
      const inside = event === insideFocusEvent.current || (root.current?.contains(event.target as Node) ?? false);
      insideFocusEvent.current = null;
      if (!inside) onExpandedChange(false);
    };
    document.addEventListener("pointerdown", pointerDown);
    // Blur alone is not an outside action: internal taps and disabled voice controls
    // can temporarily leave no focused element. Observe the actual new focus target.
    document.addEventListener("focusin", focusIn);
    return () => {
      document.removeEventListener("pointerdown", pointerDown);
      document.removeEventListener("focusin", focusIn);
    };
  }, [onExpandedChange]);

  useLayoutEffect(() => {
    // Desktop focus may intentionally survive navigation; an unfocused destination starts compact.
    onExpandedChange(root.current?.contains(document.activeElement) ?? false);
  }, [destination, onExpandedChange]);

  useLayoutEffect(() => {
    if (expanded || !root.current?.contains(document.activeElement)) return;
    // Hidden toolbar controls must not retain focus after send or manual minimization.
    (document.activeElement as HTMLElement | null)?.blur();
  }, [expanded]);

  return (
    <div className={`relative shrink-0 ${overlay ? "composer-dock" : ""}`}>
      <div
        ref={root}
        className="composer-boundary shrink-0 bg-cc-card"
        data-testid="composer-minimizer"
        data-collapsed={!expanded}
        onPointerDownCapture={(event) => {
          // React-owned portals, such as an attachment lightbox, belong to this same interaction.
          insidePointerEvent.current = event.nativeEvent;
        }}
        onFocusCapture={(event) => {
          insideFocusEvent.current = event.nativeEvent;
          onExpandedChange(true);
        }}
      >
        <ComposerVisibilityContext.Provider value={expanded}>{children}</ComposerVisibilityContext.Provider>
      </div>
    </div>
  );
}
