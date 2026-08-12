import { useEffect, useMemo, useState } from "react";
import { useStore } from "../store.js";
import type { ChatMessage } from "../types.js";
import { parseCodexReasoningDetail } from "../utils/codex-reasoning-detail.js";
import { getMessageFeedBlockId } from "./message-feed-utils.js";
import { MarkdownContent } from "./MarkdownContent.js";

function ReasoningChevron({ grouped = false }: { grouped?: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      className={`h-3 w-3 shrink-0 transition-transform ${grouped ? "group-open/reasoning-group:rotate-90" : "group-open/reasoning:rotate-90"}`}
      aria-hidden="true"
    >
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}

function ReasoningBulb() {
  return (
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
  );
}

function ReasoningStreamingDot() {
  return <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-cc-primary" aria-label="Streaming" />;
}

function ReasoningExpandedContent({ message, sessionId }: { message: ChatMessage; sessionId?: string }) {
  const parsed = parseCodexReasoningDetail(message.content);
  const streaming = message.metadata?.codexReasoningDetail?.status === "streaming";

  return (
    <div className="px-3 py-2.5 text-[13px] leading-relaxed">
      <div className="flex items-center gap-2">
        <strong className="min-w-0 font-semibold text-cc-fg" data-testid="codex-reasoning-expanded-title">
          {parsed.title}
        </strong>
        {streaming && <ReasoningStreamingDot />}
      </div>
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
  );
}

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
        <ReasoningChevron />
        <ReasoningBulb />
        <span className="min-w-0 flex-1 truncate font-medium text-cc-fg/80" data-testid="codex-reasoning-title">
          {parsed.title}
        </span>
        {streaming && <ReasoningStreamingDot />}
      </summary>
      {open && (
        <div className="border-t border-cc-border/20">
          <ReasoningExpandedContent message={message} sessionId={sessionId} />
        </div>
      )}
    </details>
  );
}

export function CodexReasoningDetailGroup({
  messages,
  defaultOpen = false,
  sessionId,
}: {
  messages: ChatMessage[];
  defaultOpen?: boolean;
  sessionId?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const expandTargetId = useStore((state) => (sessionId ? state.expandAllInTurn.get(sessionId) : undefined));
  const messageIds = useMemo(() => messages.map((message) => message.id), [messages]);
  const latest = messages[messages.length - 1];
  const first = messages[0];
  const latestParsed = parseCodexReasoningDetail(latest?.content ?? "");
  const streaming = messages.some((message) => message.metadata?.codexReasoningDetail?.status === "streaming");
  const countLabel = `${messages.length} summaries`;

  useEffect(() => {
    if (expandTargetId && messageIds.includes(expandTargetId)) setOpen(true);
  }, [expandTargetId, messageIds]);

  if (!first || !latest) return null;

  return (
    <details
      open={open}
      className="group/reasoning-group rounded-md border border-cc-border/35 bg-cc-card/25 text-cc-muted"
      data-testid="codex-reasoning-detail-group"
      data-message-id={first.id}
      data-message-role={first.role}
      data-message-variant={first.variant}
      data-feed-block-id={getMessageFeedBlockId(first.id)}
    >
      <summary
        onClick={(event) => {
          event.preventDefault();
          setOpen((current) => !current);
        }}
        aria-label={`${latestParsed.title}; ${countLabel}`}
        className="flex min-h-8 cursor-pointer list-none items-center gap-2 px-2.5 py-1.5 text-[12px] hover:bg-cc-hover/35 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/50 [&::-webkit-details-marker]:hidden"
      >
        <ReasoningChevron grouped />
        <ReasoningBulb />
        <span className="min-w-0 flex-1 truncate font-medium text-cc-fg/80" data-testid="codex-reasoning-group-title">
          {latestParsed.title}
        </span>
        <span
          className="shrink-0 rounded-full border border-cc-border/30 bg-cc-bg/30 px-1.5 py-0.5 text-[10px] font-medium text-cc-muted/80"
          data-testid="codex-reasoning-group-count"
        >
          {countLabel}
        </span>
        {streaming && <ReasoningStreamingDot />}
      </summary>
      {open && (
        <div
          className="divide-y divide-cc-border/20 border-t border-cc-border/20"
          data-testid="codex-reasoning-group-members"
        >
          {messages.map((message, index) => (
            <div
              key={message.id}
              data-testid="codex-reasoning-group-member"
              data-message-id={index === 0 ? undefined : message.id}
              data-message-role={message.role}
              data-message-variant={message.variant}
              data-feed-block-id={index === 0 ? undefined : getMessageFeedBlockId(message.id)}
            >
              <ReasoningExpandedContent message={message} sessionId={sessionId} />
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
