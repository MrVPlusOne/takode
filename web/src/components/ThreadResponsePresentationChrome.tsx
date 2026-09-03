import type { ReactNode } from "react";

export function ThreadResponseCoverageBadge({
  messageCount,
  className = "",
}: {
  messageCount: number;
  className?: string;
}) {
  if (messageCount <= 1) return null;
  return (
    <div
      className={`${className} inline-flex max-w-full items-center rounded-full border border-cc-primary/25 bg-cc-primary/10 px-2 py-0.5 text-[10px] font-medium text-cc-primary`}
      data-testid="thread-response-group-provenance"
    >
      Answers {messageCount} messages
    </div>
  );
}

export function ExpandedCurrentThreadResponse({
  messageCount,
  children,
}: {
  messageCount: number;
  children: ReactNode;
}) {
  return (
    <div
      className="rounded-xl border border-cc-primary/25 px-2.5 py-2 sm:px-3"
      data-testid="thread-response-current-expanded"
    >
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span
          className="inline-flex items-center rounded-full border border-cc-primary/20 bg-cc-primary/5 px-2 py-0.5 text-[10px] font-medium text-cc-primary"
          data-testid="thread-response-current-label"
        >
          Current answer
        </span>
        <ThreadResponseCoverageBadge messageCount={messageCount} />
      </div>
      {children}
    </div>
  );
}
