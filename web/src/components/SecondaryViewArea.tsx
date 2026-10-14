import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { isShortcutEventTargetEditable } from "../shortcuts.js";
import { secondaryViewersOpen } from "../utils/secondary-view.js";

/**
 * The secondary view on wide screens: a page such as Questmaster and any viewers opened from the
 * conversation, which render into `contentRef` from their own place in the tree. It floats over
 * the app from the right; a click outside dismisses everything in it and Escape closes what is on
 * top. While open, focus moves into it, and returns where it was when it closes.
 */
export function SecondaryViewArea({
  width,
  open,
  title,
  onClose,
  onDismiss,
  contentRef,
  children,
}: {
  width: number;
  /** Whether anything is shown; the area stays mounted while empty so viewers have a stable target. */
  open: boolean;
  /** Name of the page shown, when its header is not covered by a viewer. */
  title?: string;
  /** Closes what is on top, from the header button or Escape; viewers handle their own Escape. */
  onClose: () => void;
  /** Closes everything in the area, for an outside click. */
  onDismiss: () => void;
  contentRef: (element: HTMLDivElement | null) => void;
  children?: ReactNode;
}) {
  const areaRef = useRef<HTMLElement>(null);
  useSecondaryViewFocus(areaRef, open);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Viewers close themselves, and dialogs opened from a page (or typing in it) own Escape.
      if (secondaryViewersOpen() || isShortcutEventTargetEditable(event.target)) return;
      if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
      onCloseRef.current();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  return (
    <>
      {open && (
        <div
          className="secondary-view-scrim absolute inset-0 z-50 bg-black/30"
          onClick={onDismiss}
          data-testid="secondary-view-scrim"
        />
      )}
      <aside
        ref={areaRef}
        tabIndex={-1}
        className={`${open ? "flex" : "hidden"} secondary-view-enter absolute right-0 top-0 z-50 h-full flex-col border-l border-cc-border bg-cc-bg shadow-2xl outline-none`}
        style={{ width }}
        data-testid="secondary-view-pane"
      >
        {title && (
          <div className="shrink-0 flex items-center justify-between gap-2 px-3 py-2 bg-cc-card border-b border-cc-border">
            <span className="truncate text-[12px] font-semibold text-cc-fg">{title}</span>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg"
              title="Close"
              aria-label={`Close ${title}`}
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3.5 w-3.5">
                <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}
        <div className="relative min-h-0 flex-1" ref={contentRef}>
          {/* Its own stacking context keeps a page's sticky headers under viewers opened on top. */}
          <div className="absolute inset-0 isolate">{children}</div>
        </div>
      </aside>
    </>
  );
}

/**
 * Moves focus into the area when it opens, unless a viewer already focused something inside it, and
 * gives it back to where it was (such as the composer) when the area closes. A layout effect reads
 * the focused element before the browser drops focus from the app made inert behind the area, and
 * the restore waits for the commit that lifts that inertness.
 */
function useSecondaryViewFocus(areaRef: RefObject<HTMLElement | null>, open: boolean) {
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!open || !area) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!area.contains(document.activeElement)) area.focus({ preventScroll: true });
    return () => queueMicrotask(() => previous?.focus({ preventScroll: true }));
  }, [areaRef, open]);
}
