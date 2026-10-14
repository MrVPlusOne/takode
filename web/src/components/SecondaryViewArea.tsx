import type { ReactNode } from "react";
import { setSecondaryViewMode, type SecondaryViewMode } from "../utils/secondary-view.js";

/**
 * The right-hand area of wide screens, holding the secondary view: a page such as Questmaster and
 * any viewers opened from the conversation, which render into `contentRef` from their own place
 * in the tree. Beside the conversation it stays open while the user works in the chat; floating
 * over it, a click anywhere outside dismisses it.
 */
export function SecondaryViewArea({
  width,
  open,
  mode,
  canShowBeside,
  title,
  onClose,
  onDismiss,
  contentRef,
  children,
}: {
  width: number;
  /** Whether anything is shown; the area stays mounted while empty so viewers have a stable target. */
  open: boolean;
  /** How the area is shown right now: beside the conversation or floating over it. */
  mode: SecondaryViewMode;
  /** Whether the window is wide enough to show the area beside the conversation. */
  canShowBeside: boolean;
  /** Name of the page shown, when its header is not covered by a viewer. */
  title?: string;
  onClose: () => void;
  /** Closes everything in the area, for an outside click while it floats. */
  onDismiss: () => void;
  contentRef: (element: HTMLDivElement | null) => void;
  children?: ReactNode;
}) {
  const floating = mode === "overlay";
  return (
    <>
      {open && floating && (
        <div className="absolute inset-0 z-40 bg-black/20" onClick={onDismiss} data-testid="secondary-view-scrim" />
      )}
      <aside
        className={`${open ? "flex" : "hidden"} h-full shrink-0 flex-col border-l border-cc-border bg-cc-bg ${
          floating ? "absolute right-0 top-0 z-40 shadow-2xl" : "relative"
        }`}
        style={{ width }}
        data-testid="secondary-view-pane"
        data-mode={mode}
      >
        {canShowBeside && <SecondaryViewModeToggle mode={mode} />}
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

/** A small handle on the area's left edge that switches between beside and over the conversation. */
function SecondaryViewModeToggle({ mode }: { mode: SecondaryViewMode }) {
  const label = mode === "side" ? "Show over the conversation" : "Show beside the conversation";
  return (
    <button
      type="button"
      onClick={() => setSecondaryViewMode(mode === "side" ? "overlay" : "side")}
      className="absolute left-0 top-1/2 z-50 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-cc-border bg-cc-card text-cc-muted shadow-sm transition-colors hover:bg-cc-hover hover:text-cc-fg"
      title={label}
      aria-label={label}
      data-testid="secondary-view-mode-toggle"
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-3.5 w-3.5">
        {mode === "side" ? (
          // Two stacked sheets: switch to floating over the conversation.
          <>
            <rect x="2" y="4.5" width="8.5" height="9" rx="1.5" />
            <path d="M5.5 4.5V3.5A1.5 1.5 0 017 2h5.5A1.5 1.5 0 0114 3.5v6a1.5 1.5 0 01-1.5 1.5h-2" />
          </>
        ) : (
          // Two columns: switch to beside the conversation.
          <>
            <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
            <path d="M9 2.75v10.5" />
          </>
        )}
      </svg>
    </button>
  );
}
