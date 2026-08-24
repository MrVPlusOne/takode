import { useCallback, useState } from "react";
import { api, type RecentAskBundle, type RecentAskBundleStatus, type RecentAskMember } from "../api.js";

const STATUS_LABELS: Record<RecentAskBundleStatus, string> = {
  awaiting_response: "Awaiting response",
  queued: "Queued",
  working: "Working",
  needs_input: "Needs input",
  thread_needs_input: "Thread needs input",
  response_unread: "Response unread",
  responded: "Responded",
  caught_up: "Caught up",
  retrying: "Retrying",
  failed: "Failed",
  interrupted: "Interrupted",
  completed: "Completed",
};

const STATUS_CLASSES: Record<RecentAskBundleStatus, string> = {
  awaiting_response: "border-cc-border bg-cc-bg text-cc-muted",
  queued: "border-sky-500/25 bg-sky-500/10 text-sky-400",
  working: "border-violet-500/25 bg-violet-500/10 text-violet-400",
  needs_input: "border-amber-500/30 bg-amber-500/12 text-amber-400",
  thread_needs_input: "border-amber-500/30 bg-amber-500/12 text-amber-400",
  response_unread: "border-blue-500/30 bg-blue-500/12 text-blue-400",
  responded: "border-cc-border bg-cc-bg text-cc-muted",
  caught_up: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
  retrying: "border-violet-500/25 bg-violet-500/10 text-violet-400",
  failed: "border-red-500/30 bg-red-500/10 text-red-400",
  interrupted: "border-red-500/30 bg-red-500/10 text-red-400",
  completed: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
};

export function RecentAskBundleResult({
  bundle,
  selected,
  onPointerMove,
  onOpenMember,
  onOpenResponse,
}: {
  bundle: RecentAskBundle;
  selected: boolean;
  onPointerMove: () => void;
  onOpenMember: (member: RecentAskMember) => void;
  onOpenResponse: () => void;
}) {
  const [expandedText, setExpandedText] = useState<Record<string, string>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const expandMember = useCallback(
    async (member: RecentAskMember) => {
      if (!member.truncated || expandedText[member.messageId]) return;
      setLoadingId(member.messageId);
      const message = await api.fetchMessagePreview(bundle.sessionId, member.historyIndex);
      setLoadingId(null);
      if (typeof message?.content === "string" && message.content.trim()) {
        setExpandedText((current) => ({ ...current, [member.messageId]: message.content }));
      }
    },
    [bundle.sessionId, expandedText],
  );

  const sessionLabel = bundle.sessionNum == null ? bundle.sessionName : `#${bundle.sessionNum} ${bundle.sessionName}`;
  const threadLabel =
    bundle.ownerThreadKey === "main" ? "Main" : bundle.questTitle || bundle.questId || bundle.ownerThreadKey;

  return (
    <div
      role="option"
      aria-selected={selected}
      data-testid="recent-ask-bundle"
      data-bundle-id={bundle.id}
      onPointerMove={onPointerMove}
      className={`rounded-xl border px-3 py-3 transition-colors sm:px-4 ${
        selected ? "border-cc-primary/45 bg-cc-primary/8" : "border-cc-border/75 bg-cc-bg/45 hover:bg-cc-hover/35"
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-cc-muted">
            <span className="truncate font-medium text-cc-fg" title={sessionLabel}>
              {sessionLabel}
            </span>
            <span aria-hidden="true">·</span>
            <span className="truncate" title={threadLabel}>
              {threadLabel}
            </span>
            {bundle.archived && (
              <span className="rounded border border-cc-border px-1 py-px text-[10px]">Archived</span>
            )}
            <span className="rounded border border-cc-border/70 px-1 py-px text-[10px]" title={bundle.sessionSpaceName}>
              {bundle.sessionSpaceName}
            </span>
          </div>
          {bundle.statusDetail && <p className="mt-1 line-clamp-1 text-[11px] text-cc-muted">{bundle.statusDetail}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${STATUS_CLASSES[bundle.status]}`}>
            {STATUS_LABELS[bundle.status]}
          </span>
          <time
            className="text-[10px] tabular-nums text-cc-muted"
            dateTime={new Date(bundle.lastAskedAt).toISOString()}
          >
            {formatRelativeTime(bundle.lastAskedAt)}
          </time>
        </div>
      </div>

      <div className="mt-2 space-y-1.5">
        {bundle.members.map((member, index) => {
          const fullText = expandedText[member.messageId];
          const text = fullText || member.preview;
          return (
            <div
              key={member.messageId}
              className="group/member flex min-w-0 items-start gap-2 rounded-lg bg-cc-card/60 px-2.5 py-2"
            >
              <time
                className="mt-0.5 w-11 shrink-0 text-[10px] tabular-nums text-cc-muted"
                dateTime={new Date(member.timestamp).toISOString()}
              >
                {formatClockTime(member.timestamp)}
              </time>
              <button
                type="button"
                className="min-w-0 flex-1 text-left text-xs leading-5 text-cc-fg outline-none hover:text-cc-primary focus-visible:text-cc-primary"
                onClick={() => onOpenMember(member)}
                aria-label={`Open ask ${index + 1} in ${sessionLabel} ${threadLabel}`}
              >
                <span className={fullText ? "whitespace-pre-wrap" : "line-clamp-3 whitespace-pre-wrap"}>{text}</span>
                {member.imageCount > 0 && (
                  <span className="mt-1 block text-[10px] text-cc-muted">
                    {member.imageCount} {member.imageCount === 1 ? "attachment" : "attachments"}
                  </span>
                )}
              </button>
              <div className="flex shrink-0 items-center gap-1">
                {member.truncated && !fullText && (
                  <button
                    type="button"
                    disabled={loadingId === member.messageId}
                    onClick={() => void expandMember(member)}
                    className="rounded px-1.5 py-0.5 text-[10px] text-cc-muted hover:bg-cc-hover hover:text-cc-fg disabled:opacity-50"
                  >
                    {loadingId === member.messageId ? "Loading…" : "Expand"}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => onOpenMember(member)}
                  className="flex h-6 w-6 items-center justify-center rounded text-cc-muted hover:bg-cc-hover hover:text-cc-primary"
                  aria-label={`Jump to ask ${index + 1}`}
                  title="Jump to exact message"
                >
                  ↗
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {bundle.response && (
        <button
          type="button"
          onClick={onOpenResponse}
          className="mt-2 flex w-full items-start gap-2 rounded-lg border border-cc-border/60 bg-cc-card/40 px-2.5 py-2 text-left hover:border-cc-primary/30 hover:bg-cc-hover/30"
        >
          <span className="mt-px shrink-0 text-[10px] font-medium uppercase tracking-wide text-cc-muted">Response</span>
          <span className="line-clamp-2 min-w-0 flex-1 text-[11px] leading-4 text-cc-muted">
            {bundle.response.preview}
          </span>
          <span className="shrink-0 text-cc-muted" aria-hidden="true">
            ↗
          </span>
        </button>
      )}
    </div>
  );
}

export function recentAskStatusLabel(status: RecentAskBundleStatus): string {
  return STATUS_LABELS[status];
}

function formatRelativeTime(timestamp: number): string {
  const difference = Math.max(0, Date.now() - timestamp);
  if (difference < 60_000) return "now";
  const minutes = Math.floor(difference / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatClockTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(timestamp);
}
