import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Height of a clipped report in a collapsed turn: its header and first sections. */
const CLIPPED_HEIGHT_PX = 320;

/**
 * A published report embedded in a collapsed turn: framed so its boundary is
 * clear, clipped to its opening, and expandable in place. Short reports show
 * whole without a toggle.
 */
export function CollapsedReportPreview({ children }: { children: ReactNode }) {
  const contentRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
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
  const toggle = () => {
    setExpanded(!expanded);
    // Collapsing a long report from its end would leave the reader far below
    // it; bring the toggle back on screen beside the clipped report.
    if (expanded) requestAnimationFrame(() => toggleRef.current?.scrollIntoView({ block: "center" }));
  };

  return (
    <div className="min-w-0 rounded-lg border border-cc-border bg-cc-card px-3 py-2.5" data-testid="collapsed-report">
      <div className="relative min-w-0 overflow-hidden" style={clipped ? { maxHeight: CLIPPED_HEIGHT_PX } : undefined}>
        <div ref={contentRef}>{children}</div>
        {clipped && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-cc-card to-transparent" />
        )}
      </div>
      {overflows && (
        <button
          ref={toggleRef}
          type="button"
          aria-expanded={expanded}
          onClick={toggle}
          className="mt-1 cursor-pointer rounded-md py-0.5 text-[11px] font-medium text-cc-primary hover:text-cc-primary-hover"
        >
          {expanded ? "Show less" : "Show full report"}
        </button>
      )}
    </div>
  );
}
