export function StarIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
      <path d="M8 1.75 9.83 5.7l4.32.52-3.2 2.95.84 4.27L8 11.32l-3.79 2.12.84-4.27-3.2-2.95 4.32-.52L8 1.75z" />
    </svg>
  );
}

export function StarredMessageRailMarker({ side }: { side: "assistant" | "user" }) {
  return (
    <span
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-md border border-amber-300/25 bg-amber-300/10 text-amber-200 shadow-[0_0_0_1px_rgba(251,191,36,0.05)] ${
        side === "assistant" ? "mt-1.5" : ""
      }`}
      title="Starred message"
      aria-label="Starred message"
      data-testid={`starred-message-${side}-rail`}
    >
      <StarIcon className="h-3 w-3" />
    </span>
  );
}
