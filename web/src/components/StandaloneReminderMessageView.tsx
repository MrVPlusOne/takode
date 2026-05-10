import { useState } from "react";
import type { ChatMessage, SessionNotification } from "../types.js";
import { buildNeedsInputReminderViewModel } from "../utils/needs-input-reminder.js";
import { buildQuestThreadReminderViewModel } from "../utils/quest-thread-reminder.js";
import {
  buildSystemReminderViewModel,
  isStandaloneReminderMessage,
  type SystemReminderViewModel,
} from "../utils/standalone-reminder-message.js";
import { buildThreadRoutingReminderViewModel } from "../utils/thread-routing-reminder.js";
import { useStore } from "../store.js";
import { HighlightedText } from "./HighlightedText.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { NeedsInputReminderView, QuestThreadReminderView, ThreadRoutingReminderView } from "./MessageReminderViews.js";

type SearchHighlightInfo = { query: string; mode: "strict" | "fuzzy"; isCurrent: boolean } | null;

function formatReminderTime(timestamp: number): string {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function ReminderTimestamp({ timestamp }: { timestamp: number }) {
  const d = new Date(timestamp);
  if (Number.isNaN(d.getTime())) return null;
  const timeText = formatReminderTime(timestamp);
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

export { isStandaloneReminderMessage };

export function StandaloneReminderMessageView({
  message,
  sessionId,
  showTimestamp,
  searchHighlight,
}: {
  message: ChatMessage;
  sessionId?: string;
  showTimestamp: boolean;
  searchHighlight?: SearchHighlightInfo;
}) {
  const notifications = useStore((s) => (sessionId ? s.sessionNotifications.get(sessionId) : undefined));
  const body = buildStandaloneReminderBody(message, notifications, searchHighlight, sessionId);
  if (!body) return null;

  return (
    <div className="pl-9 py-0.5 animate-[fadeSlideIn_0.2s_ease-out]">
      <div className="max-w-3xl">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">{body}</div>
          {showTimestamp && <ReminderTimestamp timestamp={message.timestamp} />}
        </div>
      </div>
    </div>
  );
}

function buildStandaloneReminderBody(
  message: ChatMessage,
  notifications: ReadonlyArray<SessionNotification> | undefined,
  searchHighlight: SearchHighlightInfo | undefined,
  sessionId: string | undefined,
) {
  const threadRoutingReminder = buildThreadRoutingReminderViewModel(message);
  if (threadRoutingReminder) return <ThreadRoutingReminderView reminder={threadRoutingReminder} />;

  const questThreadReminder = buildQuestThreadReminderViewModel(message);
  if (questThreadReminder) return <QuestThreadReminderView reminder={questThreadReminder} />;

  const needsInputReminder = buildNeedsInputReminderViewModel(message, notifications);
  if (needsInputReminder) {
    return (
      <div className="rounded-md border border-cc-border/45 bg-cc-hover/15 px-2 py-1">
        <NeedsInputReminderView reminder={needsInputReminder} />
      </div>
    );
  }

  const systemReminder = buildSystemReminderViewModel(message);
  if (systemReminder) {
    return <SystemReminderChip reminder={systemReminder} searchHighlight={searchHighlight} sessionId={sessionId} />;
  }
  return null;
}

function SystemReminderChip({
  reminder,
  searchHighlight,
  sessionId,
}: {
  reminder: SystemReminderViewModel;
  searchHighlight?: SearchHighlightInfo;
  sessionId?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const tone = systemReminderTone(reminder.kind);
  const renderedTitle = searchHighlight?.query ? (
    <HighlightedText
      text={reminder.title}
      query={searchHighlight.query}
      mode={searchHighlight.mode}
      isCurrent={searchHighlight.isCurrent}
    />
  ) : (
    reminder.title
  );
  const renderedSummary = searchHighlight?.query ? (
    <HighlightedText
      text={reminder.summary}
      query={searchHighlight.query}
      mode={searchHighlight.mode}
      isCurrent={searchHighlight.isCurrent}
    />
  ) : (
    reminder.summary
  );

  return (
    <div className="text-left">
      <button
        type="button"
        className={`flex w-full min-w-0 items-center gap-2 rounded-md border ${tone.border} ${tone.bg} px-2 py-1 text-left transition-colors hover:bg-cc-hover/35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-primary/60`}
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Collapse" : "Expand"} ${reminder.title}`}
        data-testid="standalone-system-reminder-chip"
        data-reminder-kind={reminder.kind}
      >
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`h-3 w-3 shrink-0 text-cc-muted/55 transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        <SystemReminderIcon kind={reminder.kind} className={`h-3.5 w-3.5 shrink-0 ${tone.icon}`} />
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium leading-snug text-cc-muted">
          <span className="text-cc-fg/85">{renderedTitle}</span>
          {reminder.summary && <span className="text-cc-muted/75"> · {renderedSummary}</span>}
        </span>
        <span
          className={`shrink-0 rounded-full border px-1.5 py-0.5 font-mono-code text-[9px] leading-none ${tone.badge}`}
        >
          {reminder.badge}
        </span>
      </button>
      {expanded && (
        <div className="mt-1.5 rounded-md border border-cc-border/25 bg-cc-card/35 px-2.5 py-2">
          <MarkdownContent
            text={reminder.rawContent}
            variant="conservative"
            sessionId={sessionId}
            searchHighlight={searchHighlight}
          />
        </div>
      )}
    </div>
  );
}

function systemReminderTone(kind: SystemReminderViewModel["kind"]) {
  if (kind === "resource-lease") {
    return {
      border: "border-emerald-400/20",
      bg: "bg-emerald-500/8",
      icon: "text-emerald-300/80",
      badge: "border-emerald-400/25 text-emerald-200/80",
    };
  }
  if (kind === "long-sleep-guard") {
    return {
      border: "border-amber-300/20",
      bg: "bg-amber-500/8",
      icon: "text-amber-200/85",
      badge: "border-amber-300/25 text-amber-200/80",
    };
  }
  return {
    border: "border-sky-400/18",
    bg: "bg-sky-500/8",
    icon: "text-sky-300/80",
    badge: "border-sky-300/25 text-sky-200/75",
  };
}

function SystemReminderIcon({ kind, className }: { kind: SystemReminderViewModel["kind"]; className: string }) {
  if (kind === "resource-lease") {
    return (
      <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
        <path
          d="M5.5 7V5a2.5 2.5 0 015 0v2M4 7h8v6H4V7z"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  if (kind === "long-sleep-guard") {
    return (
      <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
        <path
          d="M8 2l6 11H2L8 2zM8 6v3M8 12h.01"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" fill="none" className={className} aria-hidden="true">
      <path
        d="M12.5 5.5A5 5 0 003.7 4.3L2.5 5.5M3.5 10.5a5 5 0 008.8 1.2l1.2-1.2M2.5 2.5v3h3M13.5 13.5v-3h-3"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
