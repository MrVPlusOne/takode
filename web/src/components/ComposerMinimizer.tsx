import {
  createContext,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
  type Dispatch,
  type SetStateAction,
} from "react";

export const ComposerVisibilityContext = createContext(true);

/** A desktop hover departure can hide active work without ending its lifetime. */
export type ComposerExpansion = boolean | "hover-collapsed";

/** Own focus and desktop hover presentation while keeping the draft and attachments mounted. */
export function ComposerMinimizer({
  children,
  destination,
  expanded,
  onExpandedChange,
  textareaRef,
  overlay = false,
}: {
  children: ReactNode;
  destination: string;
  expanded: boolean;
  onExpandedChange: Dispatch<SetStateAction<ComposerExpansion>>;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  overlay?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const insidePointerEvent = useRef<Event | null>(null);
  const insideFocusEvent = useRef<Event | null>(null);
  const editingPosition = useRef<{
    text: string;
    start: number;
    end: number;
    direction: "forward" | "backward" | "none";
    scrollTop: number;
    scrollLeft: number;
    focused: boolean;
  } | null>(null);
  const restoreEditingPosition = useRef(false);

  useEffect(() => {
    const pointerDown = (event: PointerEvent) => {
      const inside = event === insidePointerEvent.current || (root.current?.contains(event.target as Node) ?? false);
      insidePointerEvent.current = null;
      if (!inside) onExpandedChange((current) => (current === "hover-collapsed" ? current : false));
    };
    const focusIn = (event: FocusEvent) => {
      const inside = event === insideFocusEvent.current || (root.current?.contains(event.target as Node) ?? false);
      insideFocusEvent.current = null;
      if (!inside) onExpandedChange((current) => (current === "hover-collapsed" ? current : false));
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
    editingPosition.current = null;
    restoreEditingPosition.current = false;
    // Desktop focus may intentionally survive navigation; an unfocused destination starts compact.
    onExpandedChange(root.current?.contains(document.activeElement) ?? false);
  }, [destination, onExpandedChange]);

  useLayoutEffect(() => {
    const position = editingPosition.current;
    const textarea = textareaRef?.current;
    if (expanded && restoreEditingPosition.current && position && textarea) {
      restoreEditingPosition.current = false;
      editingPosition.current = null;
      // Restore after the child has refitted the expanded textarea. Focus must not scroll the feed.
      if (position.focused) textarea.focus({ preventScroll: true });
      // A pending voice result may have already supplied a newer editing position.
      if (textarea.value === position.text) {
        textarea.setSelectionRange(position.start, position.end, position.direction);
        textarea.scrollTop = position.scrollTop;
        textarea.scrollLeft = position.scrollLeft;
      }
    }
    if (expanded || !root.current?.contains(document.activeElement)) return;
    // Hidden toolbar controls must not retain focus after send or manual minimization.
    (document.activeElement as HTMLElement | null)?.blur();
  }, [expanded, textareaRef]);

  return (
    <div className={`relative shrink-0 ${overlay ? "composer-dock" : ""}`}>
      <div
        ref={root}
        className="composer-boundary shrink-0 bg-cc-card"
        data-testid="composer-minimizer"
        data-collapsed={!expanded}
        onPointerEnter={(event) => {
          if (
            event.pointerType !== "mouse" ||
            event.buttons !== 0 ||
            !window.matchMedia("(hover: hover) and (pointer: fine)").matches
          )
            return;
          restoreEditingPosition.current = !expanded;
          onExpandedChange(true);
        }}
        onPointerLeave={(event) => {
          if (event.pointerType !== "mouse" || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
          const textarea = textareaRef?.current;
          if (expanded && textarea) {
            editingPosition.current = {
              text: textarea.value,
              start: textarea.selectionStart,
              end: textarea.selectionEnd,
              direction: textarea.selectionDirection,
              scrollTop: textarea.scrollTop,
              scrollLeft: textarea.scrollLeft,
              focused: document.activeElement === textarea,
            };
          }
          onExpandedChange("hover-collapsed");
        }}
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
