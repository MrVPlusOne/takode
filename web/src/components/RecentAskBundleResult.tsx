import { useCallback, useId, useState } from "react";
import { api, type RecentAskBundle, type RecentAskBundleStatus, type RecentAskMember } from "../api.js";
import { timeAgo } from "../utils/quest-helpers.js";
import { QuestInlineLink } from "./QuestInlineLink.js";
import { SEARCH_ROW_CLASS, SearchMeta, SearchRowContent } from "./SearchSheet.js";

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

/** Status colors match the rest of the app: amber needs the user, blue is an unread result. */
const STATUS_COLORS: Record<RecentAskBundleStatus, string | null> = {
  awaiting_response: null,
  queued: "var(--color-cc-phase-sky)",
  working: "var(--color-cc-phase-violet)",
  needs_input: "var(--color-cc-attention)",
  thread_needs_input: "var(--color-cc-attention)",
  response_unread: "var(--color-cc-info)",
  responded: null,
  caught_up: "var(--color-cc-success)",
  retrying: "var(--color-cc-phase-violet)",
  failed: "var(--color-cc-error)",
  interrupted: "var(--color-cc-error)",
  completed: "var(--color-cc-success)",
};

/** Settled conversations get a faded bar, like finished tabs in Find. */
const SETTLED_STATUSES = new Set<RecentAskBundleStatus>(["awaiting_response", "responded", "caught_up", "completed"]);

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
  const statusColor = STATUS_COLORS[bundle.status];
  // The meta line's Expand serves the newest message; older members (legacy bundles) stay compact.
  const newest = bundle.members[0];
  const newestExpanded = newest ? expandedText[newest.messageId] != null : false;
  const newestExpandable =
    newest != null &&
    (newest.truncated || newest.preview.length > COMPACT_TEXT_EXPAND_THRESHOLD || hasDisplayFormatting(newest.preview));
  const place = questOwned ? (
    <QuestInlineLink
      questId={bundle.questId!}
      stopPropagation
      hoverCardZIndexClassName="z-[90]"
      onNavigate={onNavigateQuest}
      className="hover:underline"
    >
      {bundle.questTitle}
    </QuestInlineLink>
  ) : (
    <span title={sessionLabel}>{sessionLabel}</span>
  );

  return (
    <div
      role="option"
      aria-selected={selected}
      data-testid="recent-ask-bundle"
      data-bundle-id={bundle.id}
      onPointerMove={onPointerMove}
      // The whole row opens the newest message, as a row does in Find.
      onClick={() => newest && onOpenMember(newest)}
      className={`${SEARCH_ROW_CLASS} cursor-pointer ${selected ? "md:bg-cc-hover/60" : "hover:bg-cc-hover/40"}`}
    >
      <SearchRowContent
        barColor={statusColor ?? "var(--color-cc-muted)"}
        barQuiet={SETTLED_STATUSES.has(bundle.status)}
        meta={
          <>
            <SearchMeta
              items={[
                place,
                questOwned ? <span title={sessionLabel}>{compactSessionLabel}</span> : threadLabel,
                <span
                  style={statusColor ? { color: statusColor } : undefined}
                  title={bundle.statusDetail || STATUS_LABELS[bundle.status]}
                >
                  {STATUS_LABELS[bundle.status]}
                </span>,
                <time dateTime={new Date(bundle.lastAskedAt).toISOString()} title={formatClockTime(bundle.lastAskedAt)}>
                  {timeAgo(bundle.lastAskedAt)}
                </time>,
                bundle.archived ? "Archived" : null,
              ]}
            />
            {newest && newestExpandable && (
              <button
                type="button"
                disabled={loadingId === newest.messageId}
                onClick={(event) => {
                  event.stopPropagation();
                  void toggleMemberFormatting(newest);
                }}
                className="ml-auto shrink-0 pl-3 hover:text-cc-fg disabled:opacity-50"
                aria-label={`${newestExpanded ? "Collapse" : "Expand"} newest message`}
                title={newestExpanded ? "Use compact formatting" : "Show original formatting"}
              >
                {loadingId === newest.messageId ? "Loading…" : newestExpanded ? "Collapse" : "Expand"}
              </button>
            )}
          </>
        }
      >
        {bundle.members.map((member, index) => {
          const fullText = expandedText[member.messageId];
          const text = fullText ?? member.preview;
          const hasAttachments = member.imageCount > 0 || member.commentCount > 0;
          const imageLabel = `${member.imageCount} image attachment${member.imageCount === 1 ? "" : "s"}`;
          const commentLabel = `${member.commentCount} comment attachment${member.commentCount === 1 ? "" : "s"}`;
          return (
            <button
              key={member.messageId}
              type="button"
              className={`flex min-w-0 items-start gap-2 text-left outline-none focus-visible:underline ${index > 0 ? "mt-1" : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                onOpenMember(member);
              }}
              aria-label={`Open newest message in ${sessionLabel} ${threadLabel}`}
              aria-describedby={hasAttachments ? `${attachmentDescriptionId}-${index}` : undefined}
            >
              {text && (
                <span
                  data-testid="recent-ask-text"
                  className={`min-w-0 flex-1 break-words text-[14px] text-cc-fg ${
                    fullText == null ? "line-clamp-2 whitespace-normal" : "block whitespace-pre-wrap"
                  }`}
                >
                  {text}
                </span>
              )}
              {hasAttachments && (
                <span className="inline-flex shrink-0 items-center gap-2 text-[12px] leading-snug text-cc-muted">
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
            </button>
          );
        })}
        {visibleStatusDetail && (
          <span className="mt-0.5 line-clamp-1 text-[11.5px] text-cc-muted">{visibleStatusDetail}</span>
        )}
      </SearchRowContent>
    </div>
  );
}

export function recentAskStatusLabel(status: RecentAskBundleStatus): string {
  return STATUS_LABELS[status];
}

function hasDisplayFormatting(value: string): boolean {
  return /[\r\n\t]| {2,}/.test(value);
}

function formatClockTime(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(timestamp);
}
