import { useId, useState } from "react";

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
  const hasContext = !!sourceContext?.trim();
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
          title={hasContext ? `${title}\n${sourceContext}` : title}
          aria-label={`Open source message for ${title}`}
          data-testid={testIdPrefix ? `${testIdPrefix}-source-target` : undefined}
        >
          {targetContent}
        </button>
      ) : (
        <div className="min-w-0 flex-1 text-left" title={hasContext ? `${title}\n${sourceContext}` : title}>
          {targetContent}
        </div>
      )}
      {hasContext && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-[1.15rem] inline-flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[10px] text-cc-muted/80 transition-colors hover:bg-cc-hover/60 hover:text-cc-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-400/45 cursor-pointer"
          aria-expanded={expanded}
          aria-controls={contextId}
        >
          {expanded ? "Less" : "More"}
          <ChevronIcon expanded={expanded} />
        </button>
      )}
    </div>
  );
}
