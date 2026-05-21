import { useId, useState } from "react";
import { MarkdownContent } from "./MarkdownContent.js";

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
  const contextId = useId();
  const sourceText = sourceContext?.trim() ?? "";
  const hasContext = sourceText.length > 0;
  const sourceContextTestId = testIdPrefix ? `${testIdPrefix}-source-context` : undefined;
  const sourceTargetTestId = testIdPrefix ? `${testIdPrefix}-source-target` : undefined;
  const sourceContextClassName = [
    "mt-1 max-w-full text-[11px] leading-snug",
    "[&]:leading-snug [&]:text-[11px] [&_p]:mb-1 [&_p:last-child]:mb-0 [&_ul]:mb-1 [&_ol]:mb-1",
    "[&_li]:leading-snug [&_blockquote]:my-1 [&_blockquote]:pl-2 [&_code]:text-[11px]",
    expanded ? "break-words" : "line-clamp-3",
    contextClassName,
  ].join(" ");

  return (
    <div className="min-w-0 max-w-full">
      <div className="flex min-w-0 items-start gap-1.5">
        {onNavigate ? (
          <button
            type="button"
            onClick={onNavigate}
            className="min-w-0 flex-1 rounded-sm text-left transition-colors hover:text-cc-attention focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-attention/45 cursor-pointer"
            aria-label={`Open source message for ${title}`}
            data-testid={sourceTargetTestId}
          >
            <span className={`block max-w-full truncate text-[12px] leading-snug ${titleClassName}`}>{title}</span>
          </button>
        ) : (
          <div className="min-w-0 flex-1 text-left" data-testid={sourceTargetTestId}>
            <span className={`block max-w-full truncate text-[12px] leading-snug ${titleClassName}`}>{title}</span>
          </div>
        )}
        {hasContext && (
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[10px] cc-muted-readable transition-colors hover:bg-cc-hover/60 hover:text-cc-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-attention/45 cursor-pointer"
            aria-expanded={expanded}
            aria-controls={contextId}
          >
            {expanded ? "Less" : "More"}
            <ChevronIcon expanded={expanded} />
          </button>
        )}
      </div>
      {hasContext && (
        <MarkdownContent
          id={contextId}
          data-testid={sourceContextTestId}
          text={sourceText}
          size="sm"
          variant="conservative"
          wrapLongContent
          className={sourceContextClassName}
        />
      )}
    </div>
  );
}
