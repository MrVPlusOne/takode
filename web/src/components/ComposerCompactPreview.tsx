/** Present a one-line draft preview without changing the mounted textarea's complete value. */
export function ComposerCompactPreview({
  text,
  placeholder,
  imageCount,
  commentCount,
  descriptionId,
}: {
  text: string;
  placeholder: string;
  imageCount: number;
  commentCount: number;
  descriptionId: string;
}) {
  const lineBreak = text.search(/[\r\n]/);
  const preview = lineBreak < 0 ? text : `${text.slice(0, lineBreak)} …`;
  const images = `${imageCount} image attachment${imageCount === 1 ? "" : "s"}`;
  const comments = `${commentCount} comment attachment${commentCount === 1 ? "" : "s"}`;
  return (
    <>
      <div
        aria-hidden="true"
        data-testid="composer-compact-preview"
        className="pointer-events-none absolute inset-0 flex items-center gap-2 px-4 text-base sm:text-sm font-sans-ui"
      >
        <span className={`min-w-0 flex-1 truncate whitespace-pre ${text ? "text-cc-fg" : "text-cc-muted"}`}>
          {text ? preview : placeholder}
        </span>
        {imageCount > 0 && (
          <span
            data-testid="compact-image-count"
            className="inline-flex shrink-0 items-center gap-1 text-xs text-cc-muted"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
              <rect x="2" y="2" width="12" height="12" rx="2" />
              <circle cx="5.5" cy="5.5" r="1" fill="currentColor" stroke="none" />
              <path d="M2 11l3-3 2 2 3-4 4 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {imageCount}
          </span>
        )}
        {commentCount > 0 && (
          <span
            data-testid="compact-comment-count"
            className="inline-flex shrink-0 items-center gap-1 text-xs text-cc-muted"
          >
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3.5 w-3.5">
              <path
                d="M3 2.5h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7l-4 3v-3H3a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z"
                strokeLinejoin="round"
              />
              <path d="M5 6h6M5 8.5h4" strokeLinecap="round" />
            </svg>
            {commentCount}
          </span>
        )}
      </div>
      <span id={descriptionId} className="sr-only">
        {[
          lineBreak >= 0 && "Draft continues beyond the first line.",
          imageCount > 0 && images,
          commentCount > 0 && comments,
        ]
          .filter(Boolean)
          .join(" ")}
      </span>
    </>
  );
}
