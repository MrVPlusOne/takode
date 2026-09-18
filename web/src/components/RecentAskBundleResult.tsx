import { useCallback, useId, useState } from "react";
import { api, type RecentAskBundle, type RecentAskBundleStatus, type RecentAskMember } from "../api.js";
import { QuestInlineLink } from "./QuestInlineLink.js";

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

const COMPACT_TEXT_EXPAND_THRESHOLD = 96;

const DETAIL_STATUSES = new Set<RecentAskBundleStatus>([
  "needs_input",
  "thread_needs_input",
  "retrying",
  "failed",
  "interrupted",
]);

export function RecentAskBundleResult({
  bundle,
  selected,
  onPointerMove,
  onOpenMember,
  onNavigateQuest,
}: {
  bundle: RecentAskBundle;
  selected: boolean;
  onPointerMove: () => void;
  onOpenMember: (member: RecentAskMember) => void;
  onNavigateQuest: () => void;
}) {
  const [expandedText, setExpandedText] = useState<Record<string, string>>({});
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const attachmentDescriptionId = useId();

  const toggleMemberFormatting = useCallback(
    async (member: RecentAskMember) => {
      if (expandedText[member.messageId] != null) {
        setExpandedText((current) => {
          const next = { ...current };
          delete next[member.messageId];
          return next;
        });
        return;
      }

      if (!member.truncated) {
        setExpandedText((current) => ({ ...current, [member.messageId]: member.preview }));
        return;
      }

      setLoadingId(member.messageId);
      try {
        const message = await api.fetchMessagePreview(bundle.sessionId, member.historyIndex);
        if (typeof message?.content === "string" && message.content.length > 0) {
          setExpandedText((current) => ({ ...current, [member.messageId]: message.content }));
        }
      } catch (error) {
        console.warn("[recent-conversations] exact message expansion failed:", error);
      } finally {
        setLoadingId(null);
      }
    },
    [bundle.sessionId, expandedText],
  );

  const sessionLabel = bundle.sessionNum == null ? bundle.sessionName : `#${bundle.sessionNum} ${bundle.sessionName}`;
  const compactSessionLabel = bundle.sessionNum == null ? bundle.sessionName : `#${bundle.sessionNum}`;
  const threadLabel =
    bundle.ownerThreadKey === "main" ? "Main" : bundle.questTitle || bundle.questId || bundle.ownerThreadKey;
  const questOwned = bundle.ownerThreadKey !== "main" && Boolean(bundle.questId && bundle.questTitle);
  const visibleStatusDetail = bundle.statusDetail && DETAIL_STATUSES.has(bundle.status) ? bundle.statusDetail : null;

  return (
    <div
      role="option"
      aria-selected={selected}
      data-testid="recent-ask-bundle"
      data-bundle-id={bundle.id}
      onPointerMove={onPointerMove}
      className={`rounded-lg border px-2.5 py-1.5 transition-colors sm:px-3 ${
        selected ? "border-cc-primary/45 bg-cc-primary/8" : "border-cc-border/75 bg-cc-bg/45 hover:bg-cc-hover/35"
      }`}
    >
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-[10px] text-cc-muted">
          {questOwned ? (
            <>
              <QuestInlineLink
                questId={bundle.questId!}
                stopPropagation
                hoverCardZIndexClassName="z-[90]"
                onNavigate={onNavigateQuest}
                className="min-w-0 truncate font-medium text-cc-primary hover:underline"
              >
                {bundle.questTitle}
              </QuestInlineLink>
              <span aria-hidden="true">·</span>
              <span className="shrink-0" title={sessionLabel}>
                {compactSessionLabel}
              </span>
            </>
          ) : (
            <>
              <span className="truncate font-medium text-cc-fg/80" title={sessionLabel}>
                {sessionLabel}
              </span>
              <span aria-hidden="true">·</span>
              <span className="shrink-0">{threadLabel}</span>
            </>
          )}
          {bundle.archived && <span className="shrink-0 rounded border border-cc-border px-1 py-px">Archived</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <span
            className={`rounded-full border px-1.5 py-px text-[10px] font-medium ${STATUS_CLASSES[bundle.status]}`}
            title={bundle.statusDetail || STATUS_LABELS[bundle.status]}
          >
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

      <div className="mt-0.5">
        {bundle.members.map((member, index) => {
          const fullText = expandedText[member.messageId];
          const text = fullText ?? member.preview;
          const hasAttachments = member.imageCount > 0 || member.commentCount > 0;
          const imageLabel = `${member.imageCount} image attachment${member.imageCount === 1 ? "" : "s"}`;
          const commentLabel = `${member.commentCount} comment attachment${member.commentCount === 1 ? "" : "s"}`;
          const expandable =
            member.truncated ||
            member.preview.length > COMPACT_TEXT_EXPAND_THRESHOLD ||
            hasDisplayFormatting(member.preview);
          return (
            <div
              key={member.messageId}
              className={`group/member flex min-w-0 items-start gap-1 ${index > 0 ? "border-t border-cc-border/55" : ""}`}
            >
              <button
                type="button"
                className="flex min-h-11 min-w-0 flex-1 items-start gap-2 py-1.5 text-left outline-none hover:text-cc-primary focus-visible:text-cc-primary sm:min-h-0 sm:py-1"
                onClick={() => onOpenMember(member)}
                aria-label={`Open newest message in ${sessionLabel} ${threadLabel}`}
                aria-describedby={hasAttachments ? `${attachmentDescriptionId}-${index}` : undefined}
              >
                <time
                  className="mt-px w-11 shrink-0 text-[10px] tabular-nums text-cc-muted"
                  dateTime={new Date(member.timestamp).toISOString()}
                >
                  {formatClockTime(member.timestamp)}
                </time>
                <span className="flex min-w-0 flex-1 items-start gap-2">
                  {text && (
                    <span
                      data-testid="recent-ask-text"
                      className={`min-w-0 flex-1 break-words text-[13px] leading-[1.15rem] text-cc-fg ${
                        fullText == null ? "line-clamp-2 whitespace-normal" : "block whitespace-pre-wrap"
                      }`}
                    >
                      {text}
                    </span>
                  )}
                  {hasAttachments && (
                    <span className="inline-flex shrink-0 items-center gap-2 text-xs leading-[1.15rem] text-cc-muted">
                      {member.imageCount > 0 && (
                        <span className="inline-flex items-center gap-1" title={imageLabel} aria-hidden="true">
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            className="h-3.5 w-3.5"
                          >
                            <rect x="2" y="2" width="12" height="12" rx="2" />
                            <circle cx="5.5" cy="5.5" r="1" fill="currentColor" stroke="none" />
                            <path d="M2 11l3-3 2 2 3-4 4 5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          {member.imageCount}
                        </span>
                      )}
                      {member.commentCount > 0 && (
                        <span className="inline-flex items-center gap-1" title={commentLabel} aria-hidden="true">
                          <svg
                            aria-hidden="true"
                            viewBox="0 0 16 16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            className="h-3.5 w-3.5"
                          >
                            <path
                              d="M3 2.5h10a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H7l-4 3v-3H3a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z"
                              strokeLinejoin="round"
                            />
                            <path d="M5 6h6M5 8.5h4" strokeLinecap="round" />
                          </svg>
                          {member.commentCount}
                        </span>
                      )}
                      <span id={`${attachmentDescriptionId}-${index}`} className="sr-only">
                        {[member.imageCount > 0 && imageLabel, member.commentCount > 0 && commentLabel]
                          .filter(Boolean)
                          .join(", ")}
                      </span>
                    </span>
                  )}
                </span>
                <span
                  className="mt-px shrink-0 text-xs text-cc-muted/70 group-hover/member:text-cc-primary"
                  aria-hidden="true"
                >
                  ↗
                </span>
              </button>
              {expandable && (
                <button
                  type="button"
                  disabled={loadingId === member.messageId}
                  onClick={() => void toggleMemberFormatting(member)}
                  className="flex min-h-11 shrink-0 items-center rounded px-1.5 text-[10px] text-cc-muted hover:bg-cc-hover hover:text-cc-fg disabled:opacity-50 sm:min-h-0 sm:py-1"
                  aria-label={`${fullText == null ? "Expand" : "Collapse"} newest message`}
                  title={fullText == null ? "Show original formatting" : "Use compact formatting"}
                >
                  {loadingId === member.messageId ? "Loading…" : fullText == null ? "Expand" : "Collapse"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {visibleStatusDetail && (
        <p className="border-t border-cc-border/55 pt-1 text-[10px] leading-4 text-cc-muted line-clamp-1">
          {visibleStatusDetail}
        </p>
      )}
    </div>
  );
}

export function recentAskStatusLabel(status: RecentAskBundleStatus): string {
  return STATUS_LABELS[status];
}

function hasDisplayFormatting(value: string): boolean {
  return /[\r\n\t]| {2,}/.test(value);
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
