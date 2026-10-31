import type { AnnotationSlide } from "../../shared/conversation-annotations.js";
import type { MarkdownReportSource } from "../../shared/markdown-report.js";

/**
 * Marks a comment as made on a published report rather than on the message
 * around it, and on which slide for a deck. `compact` shows only the icon, for chips.
 */
export function ReportCommentTarget({
  source,
  slide,
  compact = false,
}: {
  source: MarkdownReportSource;
  slide?: AnnotationSlide;
  compact?: boolean;
}) {
  // The file name is enough to recognize the report; the full path shows on hover.
  const name = source.sourcePath.split("/").pop() || source.sourcePath;
  const where = slide ? `slide ${slide.number} of ` : "";
  return (
    <span
      className="inline-flex min-w-0 max-w-full items-center gap-1 text-xs font-normal text-cc-muted"
      title={`On ${where}report ${source.sourcePath}`}
      data-testid="report-comment-target"
    >
      <ReportFileIcon />
      {!compact && (
        <span className="min-w-0 truncate">
          On {where}report <span className="text-cc-fg">{name}</span>
        </span>
      )}
    </span>
  );
}

function ReportFileIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <path d="M4 1.75h5.25L12.5 5v9.25H4z" strokeLinejoin="round" />
      <path d="M9 1.75V5.25h3.5M6 8h4.5M6 10.5h4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
