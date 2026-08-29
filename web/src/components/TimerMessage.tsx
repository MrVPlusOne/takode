import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FeedEntry } from "../hooks/use-feed-model.js";
import { useMessageSearchHighlight, type SearchHighlightInfo } from "../hooks/use-message-search-highlight.js";
import { useStore, getSessionSearchState } from "../store.js";
import type { ChatMessage } from "../types.js";
import { HighlightedText } from "./HighlightedText.js";
import { MarkdownContent } from "./MarkdownContent.js";
import type { QuestLinkSurface } from "./quest-link-surface.js";
import { MessageTimestamp, formatExactMessageTimestamp, formatMessageTimestamp } from "./MessageTimestamp.js";
import { escapeSelectorValue, getMessageFeedBlockId } from "./message-feed-utils.js";
import { MinuteBoundaryTimestamp } from "./MinuteBoundaryTimestamp.js";

export type ParsedTimerMessage = {
  kind: "fired" | "cancelled" | "unknown";
  title: string;
  description: string;
  timerId: string | null;
};

export type TimerMessageBatch = {
  messages: ChatMessage[];
  nextIndex: number;
};

export function parseTimerMessageContent(content: string): ParsedTimerMessage {
  const trimmed = content.trim();
  const parts = trimmed.split(/\n{2,}/);
  const header = parts[0]?.trim() ?? "";
  const description = parts.slice(1).join("\n\n").trim();
  const cancelledMatch = header.match(/^\[⏰ Timer ([^\]\s]+) cancelled\]\s*(.*)$/);
  if (cancelledMatch) {
    return {
      kind: "cancelled",
      timerId: cancelledMatch[1],
      title: (cancelledMatch[2] || header).trim(),
      description,
    };
  }

  const firedMatch = header.match(/^\[⏰ Timer ([^\]\s]+)\]\s*(.*)$/);
  if (firedMatch) {
    return {
      kind: "fired",
      timerId: firedMatch[1],
      title: (firedMatch[2] || header).trim(),
      description,
    };
  }

  const reminderMatch = header.match(/^\[⏰ Timer ([^\]\s]+) reminder\]\s*(.*)$/);
  if (reminderMatch) {
    return {
      kind: "fired",
      timerId: reminderMatch[1],
      title: (reminderMatch[2] || header).trim(),
      description,
    };
  }

  const fallbackMatch = header.match(/^\[[^\]]+\]\s*(.*)$/);
  const title = (fallbackMatch?.[1] ?? header).trim();
  return {
    kind: "unknown",
    timerId: null,
    title: title || trimmed,
    description,
  };
}

function timerMessageGroupKey(message: ChatMessage): string | null {
  if (message.role !== "user") return null;
  const sourceId = message.agentSource?.sessionId;
  if (!sourceId?.startsWith("timer:")) return null;
  const parsed = parseTimerMessageContent(message.content);
  if (parsed.kind !== "fired" || !parsed.timerId || sourceId !== `timer:${parsed.timerId}`) return null;
  const routeKey = JSON.stringify({
    sourceLabel: message.agentSource?.sessionLabel ?? null,
    threadKey: message.metadata?.threadKey ?? null,
    questId: message.metadata?.questId ?? null,
    threadRefs: message.metadata?.threadRefs ?? [],
  });
  return `${sourceId}\n${routeKey}\n${message.content.replace(/\r\n?/g, "\n").trim()}`;
}

export function collectTimerMessageBatch(
  entries: FeedEntry[],
  startIndex: number,
  options: {
    isInvisible?: (entry: FeedEntry) => boolean;
    isDateBoundary?: (message: ChatMessage) => boolean;
  } = {},
): TimerMessageBatch | null {
  const first = entries[startIndex];
  if (first?.kind !== "message") return null;
  const groupKey = timerMessageGroupKey(first.msg);
  if (!groupKey) return null;

  const messages = [first.msg];
  const seenMessageIds = new Set([first.msg.id]);
  let matchingEntries = 1;
  let nextIndex = startIndex + 1;

  while (nextIndex < entries.length) {
    const candidate = entries[nextIndex];
    if (candidate.kind === "message" && timerMessageGroupKey(candidate.msg) === groupKey) {
      if (options.isDateBoundary?.(candidate.msg)) break;
      matchingEntries += 1;
      if (!seenMessageIds.has(candidate.msg.id)) {
        seenMessageIds.add(candidate.msg.id);
        messages.push(candidate.msg);
      }
      nextIndex += 1;
      continue;
    }
    if (options.isInvisible?.(candidate)) {
      nextIndex += 1;
      continue;
    }
    break;
  }

  return matchingEntries >= 2 ? { messages, nextIndex } : null;
}

function TimerEventIcon({ muted = false }: { muted?: boolean }) {
  return (
    <span aria-hidden="true" className={`shrink-0 text-[13px] leading-none ${muted ? "opacity-50" : ""}`}>
      ⏰
    </span>
  );
}

export function TimerMessage({
  message,
  sessionId,
  showTimestamp,
  searchHighlight,
  questLinkSurface = "legacy",
}: {
  message: ChatMessage;
  sessionId?: string;
  showTimestamp: boolean;
  searchHighlight?: SearchHighlightInfo;
  questLinkSurface?: QuestLinkSurface;
}) {
  const { title, description, timerId, kind } = useMemo(
    () => parseTimerMessageContent(message.content),
    [message.content],
  );
  const [expanded, setExpanded] = useState(false);
  const hasDescription = description.length > 0;
  const timerLabel = timerId ?? message.agentSource?.sessionLabel ?? "timer";
  const fullTimerLabel = message.agentSource?.sessionLabel ?? (timerId ? `Timer ${timerId}` : timerLabel);
  const titleClassName = kind === "cancelled" ? "text-cc-muted/85" : "text-cc-fg/95";
  const normalizedQuery = searchHighlight?.query.trim().toLowerCase() ?? "";
  const shouldShowFullTimerLabel =
    normalizedQuery.length > 0 &&
    searchHighlight?.mode === "strict" &&
    !timerLabel.toLowerCase().includes(normalizedQuery) &&
    fullTimerLabel.toLowerCase().includes(normalizedQuery);
  const visibleTimerLabel = shouldShowFullTimerLabel ? fullTimerLabel : timerLabel;
  const renderedTimerLabel = searchHighlight?.query ? (
    <HighlightedText
      text={visibleTimerLabel}
      query={searchHighlight.query}
      mode={searchHighlight.mode}
      isCurrent={searchHighlight.isCurrent}
    />
  ) : (
    visibleTimerLabel
  );
  const renderedTitle = searchHighlight?.query ? (
    <HighlightedText
      text={title}
      query={searchHighlight.query}
      mode={searchHighlight.mode}
      isCurrent={searchHighlight.isCurrent}
    />
  ) : (
    title
  );

  return (
    <div className="pl-9 py-0.5 animate-[fadeSlideIn_0.2s_ease-out]">
      <div className="max-w-3xl">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {hasDescription && kind !== "cancelled" ? (
              <button
                type="button"
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
                aria-label={expanded ? "Collapse timer description" : "Expand timer description"}
                className="flex w-full min-w-0 items-start gap-2 text-left cursor-pointer"
              >
                <TimerEventIcon />
                <span className="shrink-0 pt-0.5 font-mono-code text-[11px] leading-none text-orange-300/85">
                  {renderedTimerLabel}
                </span>
                <span className={`min-w-0 flex-1 break-words text-[13px] font-medium leading-snug ${titleClassName}`}>
                  {renderedTitle}
                </span>
                <svg
                  viewBox="0 0 16 16"
                  fill="currentColor"
                  className={`mt-0.5 h-3 w-3 shrink-0 text-cc-muted/45 transition-transform ${expanded ? "rotate-90" : ""}`}
                >
                  <path d="M6 3l5 5-5 5V3z" />
                </svg>
              </button>
            ) : (
              <div className="flex min-w-0 items-start gap-2">
                <TimerEventIcon muted={kind === "cancelled"} />
                <span
                  className={`shrink-0 pt-0.5 font-mono-code text-[11px] leading-none ${
                    kind === "cancelled" ? "text-cc-muted/60" : "text-orange-300/85"
                  }`}
                >
                  {renderedTimerLabel}
                </span>
                {kind === "cancelled" && (
                  <span className="shrink-0 pt-[1px] text-[10px] uppercase tracking-[0.18em] text-cc-muted/45">
                    cancelled
                  </span>
                )}
                <span className={`min-w-0 flex-1 break-words text-[13px] font-medium leading-snug ${titleClassName}`}>
                  {renderedTitle}
                </span>
              </div>
            )}
            {expanded && hasDescription && kind !== "cancelled" && (
              <div className="ml-6 mt-2 rounded-2xl border border-cc-border/20 bg-cc-card/45 px-3 py-2.5">
                <MarkdownContent
                  text={description}
                  variant="conservative"
                  sessionId={sessionId}
                  searchHighlight={searchHighlight}
                  questLinkSurface={questLinkSurface}
                />
              </div>
            )}
          </div>
          {showTimestamp && <MessageTimestamp timestamp={message.timestamp} />}
        </div>
      </div>
    </div>
  );
}

function TimerOccurrenceDetail({
  message,
  sessionId,
  occurrenceNumber,
  questLinkSurface,
}: {
  message: ChatMessage;
  sessionId: string;
  occurrenceNumber: number;
  questLinkSurface: QuestLinkSurface;
}) {
  const searchHighlight = useMessageSearchHighlight(sessionId, message);
  const timestamp = formatMessageTimestamp(message.timestamp);
  const exactTimestamp = formatExactMessageTimestamp(message.timestamp);

  return (
    <li
      data-message-id={message.id}
      data-message-role={message.role}
      data-feed-block-id={getMessageFeedBlockId(message.id)}
      data-timer-occurrence-id={message.id}
      className={`border-t border-cc-border/25 px-3 py-2 first:border-t-0 ${
        searchHighlight?.isCurrent ? "bg-cc-primary/8" : ""
      }`}
    >
      <div className="mb-1 flex items-center gap-2 font-mono-code text-[10px] text-cc-muted/65">
        <time dateTime={new Date(message.timestamp).toISOString()} title={exactTimestamp}>
          {timestamp}
        </time>
        <span className="text-cc-muted/30">·</span>
        <span>Occurrence {occurrenceNumber}</span>
      </div>
      <MarkdownContent
        text={message.content}
        variant="conservative"
        sessionId={sessionId}
        searchHighlight={searchHighlight}
        questLinkSurface={questLinkSurface}
      />
    </li>
  );
}

export function TimerMessageGroup({
  messages,
  sessionId,
  dateLabel,
  questLinkSurface = "legacy",
}: {
  messages: ChatMessage[];
  sessionId: string;
  dateLabel?: string;
  questLinkSurface?: QuestLinkSurface;
}) {
  const first = messages[0];
  const groupRef = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const messageIds = useMemo(() => messages.map((message) => message.id), [messages]);
  const expandTargetId = useStore((state) => state.expandAllInTurn.get(sessionId) ?? null);
  const searchTargetId = useStore((state) => {
    const search = getSessionSearchState(state, sessionId);
    if (!search.isOpen || search.currentMatchIndex < 0) return null;
    return search.matches[search.currentMatchIndex]?.messageId ?? null;
  });
  const activeTargetId =
    (expandTargetId && messageIds.includes(expandTargetId) ? expandTargetId : null) ??
    (searchTargetId && messageIds.includes(searchTargetId) ? searchTargetId : null);

  useEffect(() => {
    if (activeTargetId) setExpanded(true);
  }, [activeTargetId]);

  useLayoutEffect(() => {
    if (!expanded || !activeTargetId) return;
    const target = groupRef.current?.querySelector<HTMLElement>(
      `[data-timer-occurrence-id="${escapeSelectorValue(activeTargetId)}"]`,
    );
    target?.scrollIntoView({ block: "nearest" });
  }, [activeTargetId, expanded]);

  if (!first) return null;
  if (messages.length === 1) {
    return (
      <div
        data-message-id={first.id}
        data-message-role={first.role}
        data-feed-block-id={getMessageFeedBlockId(first.id)}
      >
        {dateLabel && <MinuteBoundaryTimestamp timestamp={first.timestamp} label={dateLabel} />}
        <TimerMessage message={first} sessionId={sessionId} showTimestamp={false} questLinkSurface={questLinkSurface} />
      </div>
    );
  }

  const parsed = parseTimerMessageContent(first.content);
  const timerLabel = parsed.timerId ?? first.agentSource?.sessionLabel ?? "timer";
  const countLabel = `${messages.length} firings`;

  return (
    <div ref={groupRef} data-testid="timer-message-group" data-feed-block-id={`timer-group:${first.id}`}>
      {dateLabel && <MinuteBoundaryTimestamp timestamp={first.timestamp} label={dateLabel} />}
      <div className="pl-9 py-0.5 animate-[fadeSlideIn_0.2s_ease-out]">
        <div className="max-w-3xl">
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${countLabel} for ${timerLabel}: ${parsed.title}`}
            className="flex w-full min-w-0 items-start gap-2 text-left cursor-pointer"
          >
            <TimerEventIcon />
            <span className="shrink-0 pt-0.5 font-mono-code text-[11px] leading-none text-orange-300/85">
              {timerLabel}
            </span>
            <span className="min-w-0 flex-1 break-words text-[13px] font-medium leading-snug text-cc-fg/95">
              {parsed.title}
            </span>
            <span className="shrink-0 rounded-full border border-orange-300/20 bg-orange-300/8 px-1.5 py-0.5 font-mono-code text-[10px] leading-none text-orange-200/80">
              {countLabel}
            </span>
            <svg
              viewBox="0 0 16 16"
              fill="currentColor"
              className={`mt-0.5 h-3 w-3 shrink-0 text-cc-muted/45 transition-transform ${expanded ? "rotate-90" : ""}`}
            >
              <path d="M6 3l5 5-5 5V3z" />
            </svg>
          </button>
          {!expanded && (
            <>
              <span
                data-message-id={first.id}
                data-message-role={first.role}
                data-feed-block-id={getMessageFeedBlockId(first.id)}
                aria-hidden="true"
                className="sr-only"
              />
              {messages.slice(1).map((message) => (
                <span
                  key={message.id}
                  data-message-id={message.id}
                  data-message-role={message.role}
                  data-feed-block-id={getMessageFeedBlockId(message.id)}
                  aria-hidden="true"
                  className="sr-only"
                />
              ))}
            </>
          )}
          {expanded && (
            <ol
              aria-label={`${timerLabel} occurrence history`}
              className="ml-5 mt-2 max-h-[32rem] overflow-y-auto rounded-md border border-cc-border/30 bg-cc-card/35"
            >
              {messages.map((message, index) => (
                <TimerOccurrenceDetail
                  key={message.id}
                  message={message}
                  sessionId={sessionId}
                  occurrenceNumber={index + 1}
                  questLinkSurface={questLinkSurface}
                />
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
