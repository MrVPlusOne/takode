import { useState } from "react";
import type { ChatMessage } from "../types.js";
import { parseCodexReasoningDetail } from "../utils/codex-reasoning-detail.js";
import { MarkdownContent } from "./MarkdownContent.js";

export function CodexReasoningDetail({
  message,
  defaultOpen = false,
  sessionId,
}: {
  message: ChatMessage;
  defaultOpen?: boolean;
  sessionId?: string;
}) {
  const parsed = parseCodexReasoningDetail(message.content);
  const streaming = message.metadata?.codexReasoningDetail?.status === "streaming";
  const [open, setOpen] = useState(defaultOpen);

  return (
    <details
      open={open}
      className="group/reasoning rounded-md border border-cc-border/30 bg-cc-card/20 text-cc-muted"
      data-testid="codex-reasoning-detail"
    >
      <summary
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
        className="flex min-h-8 cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-[12px] hover:bg-cc-hover/35 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/50 [&::-webkit-details-marker]:hidden"
      >
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className="h-3 w-3 shrink-0 transition-transform group-open/reasoning:rotate-90"
          aria-hidden="true"
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          className="h-3.5 w-3.5 shrink-0 text-cc-muted/70"
          aria-hidden="true"
        >
          <path d="M5.8 12h4.4M6.3 14h3.4M5.2 9.8C4.4 9 4 7.9 4 6.7a4 4 0 118 0c0 1.2-.4 2.3-1.2 3.1-.6.6-.9 1.1-1 1.7H6.2c-.1-.6-.4-1.1-1-1.7z" />
        </svg>
        <span className="min-w-0 flex-1 truncate font-medium text-cc-fg/80" data-testid="codex-reasoning-title">
          {parsed.title}
        </span>
        {streaming && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-cc-primary" />}
      </summary>
      {open && (
        <div className="border-t border-cc-border/20 px-3 py-2.5 text-[13px] leading-relaxed">
          <strong className="font-semibold text-cc-fg" data-testid="codex-reasoning-expanded-title">
            {parsed.title}
          </strong>
          {parsed.body && (
            <MarkdownContent
              text={parsed.body}
              size="sm"
              variant="conservative"
              sessionId={sessionId}
              wrapLongContent
              className="mt-1.5 text-cc-muted"
              data-testid="codex-reasoning-body"
            />
          )}
        </div>
      )}
    </details>
  );
}
