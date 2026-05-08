import { useState } from "react";
import type { ChatMessage } from "../types.js";
import { buildInjectedEventMessageViewModel } from "../utils/injected-event-message.js";
import { HighlightedText } from "./HighlightedText.js";
import { MarkdownContent } from "./MarkdownContent.js";

type SearchHighlightInfo = { query: string; mode: "strict" | "fuzzy"; isCurrent: boolean } | null;

function formatEventMessageTime(timestamp: number): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function EventTimestamp({ timestamp }: { timestamp: number }) {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return null;
  const timeText = formatEventMessageTime(timestamp);
  if (!timeText) return null;
  return (
    <time
      data-testid="message-timestamp"
      dateTime={d.toISOString()}
      title={d.toLocaleString()}
      className="inline-block ml-2 text-[11px] text-cc-muted/70"
    >
      {timeText}
    </time>
  );
}

export function InjectedEventMessageView({
  event,
  message,
  sessionId,
  showTimestamp,
  searchHighlight,
}: {
  event: NonNullable<ReturnType<typeof buildInjectedEventMessageViewModel>>;
  message: ChatMessage;
  sessionId?: string;
  showTimestamp: boolean;
  searchHighlight?: SearchHighlightInfo;
}) {
  const [expanded, setExpanded] = useState(false);
  const renderedTitle = searchHighlight?.query ? (
    <HighlightedText
      text={event.title}
      query={searchHighlight.query}
      mode={searchHighlight.mode}
      isCurrent={searchHighlight.isCurrent}
    />
  ) : (
    event.title
  );

  return (
    <div className="pl-9 py-0.5 animate-[fadeSlideIn_0.2s_ease-out]">
      <div className="max-w-3xl">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              aria-expanded={expanded}
              aria-label={`${expanded ? "Collapse" : "Expand"} ${event.title}`}
              className="inline-flex max-w-full items-center gap-2 rounded-md border border-cc-border/30 bg-cc-hover/15 px-2 py-1 text-left text-[11px] leading-snug text-cc-muted/85 transition-colors hover:border-cc-border/50 hover:bg-cc-hover/30 hover:text-cc-fg/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-primary/60"
              data-testid="injected-event-message-chip"
            >
              <svg
                viewBox="0 0 16 16"
                fill="currentColor"
                className={`h-3 w-3 shrink-0 text-cc-muted/55 transition-transform ${expanded ? "rotate-90" : ""}`}
              >
                <path d="M6 4l4 4-4 4" />
              </svg>
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                className="h-3.5 w-3.5 shrink-0 text-cc-muted/65"
                aria-hidden="true"
              >
                <path d="M8 2.5v4.25" strokeLinecap="round" />
                <path d="M8 9.25v4.25" strokeLinecap="round" />
                <path d="M2.5 8h4.25" strokeLinecap="round" />
                <path d="M9.25 8h4.25" strokeLinecap="round" />
                <circle cx="8" cy="8" r="1.35" />
              </svg>
              <span className="min-w-0 truncate font-mono-code">{renderedTitle}</span>
              <span className="shrink-0 rounded-full border border-cc-border/35 px-1.5 py-0.5 font-mono-code text-[9px] leading-none text-cc-muted/60">
                event
              </span>
            </button>
            {expanded && (
              <div className="mt-1.5 rounded-md border border-cc-border/20 bg-cc-card/35 px-2.5 py-2 text-left">
                <p className="mb-1.5 text-[11px] leading-snug text-cc-muted">{event.description}</p>
                <MarkdownContent
                  text={event.rawContent}
                  variant="conservative"
                  sessionId={sessionId}
                  searchHighlight={searchHighlight}
                />
              </div>
            )}
          </div>
          {showTimestamp && <EventTimestamp timestamp={message.timestamp} />}
        </div>
      </div>
    </div>
  );
}
