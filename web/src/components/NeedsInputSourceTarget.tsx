import { useEffect, useId, useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";
import { createPortal } from "react-dom";
import { MarkdownContent } from "./MarkdownContent.js";

const PREVIEW_WIDTH_PX = 420;
const PREVIEW_GAP_PX = 6;

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={`h-3 w-3 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}

function SourcePreviewIcon() {
  return (
    <svg
      className="h-3 w-3"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 2.5h6l4 4V13a1 1 0 0 1-1 1H3.5a1 1 0 0 1-1-1V3a.5.5 0 0 1 .5-.5z" />
      <path d="M9 2.5V6a.5.5 0 0 0 .5.5H13" />
      <path d="M5 9h6M5 11.5h4" />
    </svg>
  );
}

function NeedsInputSourcePreview({
  title,
  sourceContext,
  anchorRect,
  onMouseEnter,
  onMouseLeave,
  testIdPrefix,
}: {
  title: string;
  sourceContext: string;
  anchorRect: DOMRect;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  testIdPrefix?: string;
}) {
  const popoverRef = useRef<HTMLDivElement>(null);
  const left = anchorRect.left;
  const top = anchorRect.bottom + PREVIEW_GAP_PX;

  useLayoutEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return;
    const rect = popover.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8) {
      popover.style.left = `${Math.max(8, window.innerWidth - rect.width - 8)}px`;
    }
    if (rect.bottom > window.innerHeight - 8) {
      popover.style.top = `${Math.max(8, anchorRect.top - rect.height - PREVIEW_GAP_PX)}px`;
    }
  }, [anchorRect]);

  return createPortal(
    <div
      ref={popoverRef}
      role="tooltip"
      data-testid={testIdPrefix ? `${testIdPrefix}-source-preview` : undefined}
      className="fixed z-50 max-h-[min(22rem,calc(100vh-1rem))] overflow-hidden rounded-lg border border-cc-border bg-cc-card shadow-xl"
      style={{ left, top, width: PREVIEW_WIDTH_PX }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <div className="border-b border-cc-border/50 px-3 py-2">
        <div className="truncate text-[11px] font-medium text-cc-muted">Source message</div>
        <div className="mt-0.5 truncate text-[12px] font-medium text-cc-fg">{title}</div>
      </div>
      <div className="max-h-[17rem] overflow-y-auto px-3 py-2.5" style={{ scrollbarGutter: "stable both-edges" }}>
        <MarkdownContent text={sourceContext} size="sm" variant="conservative" wrapLongContent />
      </div>
    </div>,
    document.body,
  );
}

export function NeedsInputSourceTarget({
  title,
  sourceContext,
  onNavigate,
  titleClassName = "text-cc-fg/95",
  contextClassName = "text-cc-muted/85",
  testIdPrefix,
}: {
  title: string;
  sourceContext?: string | null;
  onNavigate?: () => void;
  titleClassName?: string;
  contextClassName?: string;
  testIdPrefix?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [previewAnchorRect, setPreviewAnchorRect] = useState<DOMRect | null>(null);
  const hidePreviewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contextId = useId();
  const hasContext = !!sourceContext?.trim();
  const previewText = sourceContext?.trim() ?? "";

  useEffect(
    () => () => {
      if (hidePreviewTimerRef.current) clearTimeout(hidePreviewTimerRef.current);
    },
    [],
  );

  const showPreview = (event: SyntheticEvent<HTMLElement>) => {
    if (!hasContext) return;
    if (hidePreviewTimerRef.current) clearTimeout(hidePreviewTimerRef.current);
    setPreviewAnchorRect(event.currentTarget.getBoundingClientRect());
  };

  const keepPreviewOpen = () => {
    if (hidePreviewTimerRef.current) clearTimeout(hidePreviewTimerRef.current);
  };

  const hidePreview = () => {
    if (hidePreviewTimerRef.current) clearTimeout(hidePreviewTimerRef.current);
    hidePreviewTimerRef.current = setTimeout(() => setPreviewAnchorRect(null), 100);
  };

  const closePreview = () => {
    if (hidePreviewTimerRef.current) clearTimeout(hidePreviewTimerRef.current);
    setPreviewAnchorRect(null);
  };

  const targetContent = (
    <>
      <span className={`block max-w-full truncate text-[12px] leading-snug ${titleClassName}`}>{title}</span>
      {hasContext && (
        <span
          id={contextId}
          data-testid={testIdPrefix ? `${testIdPrefix}-source-context` : undefined}
          className={`mt-0.5 block max-w-full text-[11px] leading-snug ${
            expanded ? "whitespace-pre-line break-words" : "truncate"
          } ${contextClassName}`}
        >
          {sourceContext}
        </span>
      )}
    </>
  );

  return (
    <div className="flex min-w-0 items-start gap-1.5">
      {onNavigate ? (
        <button
          type="button"
          onClick={onNavigate}
          className="min-w-0 flex-1 rounded-sm text-left transition-colors hover:text-amber-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/45 cursor-pointer"
          aria-label={`Open source message for ${title}`}
          data-testid={testIdPrefix ? `${testIdPrefix}-source-target` : undefined}
        >
          {targetContent}
        </button>
      ) : (
        <div
          className="min-w-0 flex-1 text-left"
          data-testid={testIdPrefix ? `${testIdPrefix}-source-target` : undefined}
        >
          {targetContent}
        </div>
      )}
      {hasContext && (
        <div className="mt-[1.15rem] flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-cc-muted/80 transition-colors hover:bg-cc-hover/60 hover:text-cc-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/45 cursor-pointer"
            aria-expanded={expanded}
            aria-controls={contextId}
          >
            {expanded ? "Less" : "More"}
            <ChevronIcon expanded={expanded} />
          </button>
          <button
            type="button"
            onMouseEnter={showPreview}
            onMouseLeave={hidePreview}
            onFocus={showPreview}
            onBlur={closePreview}
            onClick={(event) => event.stopPropagation()}
            className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-cc-muted/80 transition-colors hover:bg-cc-hover/60 hover:text-cc-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/45 cursor-pointer"
            aria-label="Preview source message"
            data-testid={testIdPrefix ? `${testIdPrefix}-source-preview-trigger` : undefined}
          >
            <SourcePreviewIcon />
            <span>Preview</span>
          </button>
          {previewAnchorRect && (
            <NeedsInputSourcePreview
              title={title}
              sourceContext={previewText}
              anchorRect={previewAnchorRect}
              onMouseEnter={keepPreviewOpen}
              onMouseLeave={hidePreview}
              testIdPrefix={testIdPrefix}
            />
          )}
        </div>
      )}
    </div>
  );
}
