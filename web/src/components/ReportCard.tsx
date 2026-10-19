import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Height of a clipped report: its header and first sections. */
const CLIPPED_HEIGHT_PX = 320;

/**
 * The frame of a published report in the feed: bordered so its boundary is
 * clear, clipped to its opening, and expandable in place. Short reports show
 * whole without a toggle.
 */
export function ReportCard({ children }: { children: ReactNode }) {
  const cardRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);

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

  const clipped = overflows && !expanded;
  const collapse = () => {
    setExpanded(false);
    // Collapsing from deep inside a long report would leave the reader far below
    // it; bring the clipped card back on screen.
    requestAnimationFrame(() => cardRef.current?.scrollIntoView({ block: "nearest" }));
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
        // so the negative top reaches the feed's visible top edge.
        <div className="sticky -top-4 sm:-top-6 z-10 -mx-3 -mt-2.5 mb-1 flex justify-end rounded-t-lg border-b border-cc-border bg-cc-card px-3 py-0.5">
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
      className={`cursor-pointer rounded-md text-[11px] font-medium text-cc-primary hover:text-cc-primary-hover ${expanded ? "py-1 pl-2" : "mt-1 py-0.5"}`}
    >
      {expanded ? "Show less" : "Show full report"}
    </button>
  );
}
