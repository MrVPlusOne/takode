import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useMessageExpansion } from "../hooks/use-message-expansion.js";

/** Height of a clipped report: its header and first sections. */
const CLIPPED_HEIGHT_PX = 320;

/**
 * The frame of a published report in the feed: bordered so its boundary is
 * clear, clipped to its opening, and expandable in place. Short reports show
 * whole without a toggle. Whether the report is expanded is the session's state,
 * the same in every browser.
 */
export function ReportCard({
  sessionId,
  messageId,
  title,
  children,
}: {
  sessionId?: string;
  messageId?: string;
  /** Shown in the pinned bar of an expanded report, so a reader deep inside it knows what it is. */
  title?: string;
  children: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useMessageExpansion(sessionId, messageId);
  const [overflows, setOverflows] = useState(false);
  const collapseRequestedRef = useRef(false);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return;
    // Images and Markdown can grow after the first render, so keep measuring.
    const measure = () => setOverflows(content.scrollHeight > CLIPPED_HEIGHT_PX);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  // Collapsing from deep inside a long report would leave the reader far below
  // it; once the collapse arrives, bring the clipped card back on screen.
  useLayoutEffect(() => {
    if (expanded || !collapseRequestedRef.current) return;
    collapseRequestedRef.current = false;
    requestAnimationFrame(() => cardRef.current?.scrollIntoView({ block: "nearest" }));
  }, [expanded]);

  const clipped = overflows && !expanded;
  const collapse = () => {
    collapseRequestedRef.current = true;
    setExpanded(false);
  };

  return (
    <div
      ref={cardRef}
      className="min-w-0 rounded-lg border border-cc-border bg-cc-card px-3 py-2.5"
      data-testid="report-card"
    >
      {overflows && expanded && (
        // An expanded report can run many screens, so its collapse control stays
        // pinned to the top of the feed while any part of the report is in view.
        // Sticky offsets start inside the feed's vertical padding (py-4 sm:py-6),
        // so the negative top reaches the feed's visible top edge; in a topic
        // conversation it pins under the quest strip (`--feed-pinned-top`). The
        // feed's top controls move below it while it is pinned (`useFeedPinnedTop`).
        <div
          data-feed-pinned-bar=""
          className="sticky top-[calc(var(--feed-pinned-top,0px)-1rem)] sm:top-[calc(var(--feed-pinned-top,0px)-1.5rem)] z-10 -mx-3 -mt-2.5 mb-1 flex items-center gap-2 rounded-t-lg border-b border-cc-border bg-cc-card px-3 py-0.5"
        >
          <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-cc-fg" title={title}>
            {title}
          </span>
          <ReportToggle expanded onClick={collapse} />
        </div>
      )}
      {/* Clip rather than hide: focus or scrollIntoView cannot scroll a clipped box past its header. */}
      <div className="relative min-w-0 overflow-clip" style={clipped ? { maxHeight: CLIPPED_HEIGHT_PX } : undefined}>
        <div ref={contentRef}>{children}</div>
        {clipped && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-cc-card to-transparent" />
        )}
      </div>
      {clipped && <ReportToggle expanded={false} onClick={() => setExpanded(true)} />}
    </div>
  );
}

function ReportToggle({ expanded, onClick }: { expanded: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      onClick={onClick}
      className={`shrink-0 cursor-pointer rounded-md text-[11px] font-medium text-cc-primary hover:text-cc-primary-hover ${expanded ? "py-1 pl-2" : "mt-1 py-0.5"}`}
    >
      {expanded ? "Show less" : "Show full report"}
    </button>
  );
}
