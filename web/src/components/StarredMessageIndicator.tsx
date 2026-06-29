export function StarIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 1.75 9.83 5.7l4.32.52-3.2 2.95.84 4.27L8 11.32l-3.79 2.12.84-4.27-3.2-2.95 4.32-.52L8 1.75z" />
    </svg>
  );
}

export function StarredMessageIndicator({ compact = false }: { compact?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border border-amber-300/20 bg-amber-300/10 text-amber-200 ${
        compact ? "px-1 py-0.5" : "px-1.5 py-0.5"
      }`}
      title="Starred message"
      aria-label="Starred message"
      data-testid="starred-message-indicator"
    >
      <StarIcon className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
      {!compact && <span className="sr-only">Starred</span>}
    </span>
  );
}
