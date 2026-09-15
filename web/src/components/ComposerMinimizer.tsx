import { createContext, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";

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

/** Fit manual minimization into the existing toolbar without adding a row. */
export function ComposerMinimizeButton({ onClick, disabled = false }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label="Minimize composer"
      title="Minimize composer"
      aria-expanded="true"
      disabled={disabled}
      onClick={onClick}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-cc-muted hover:bg-cc-hover hover:text-cc-fg disabled:opacity-40"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="h-4 w-4"
      >
        <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
