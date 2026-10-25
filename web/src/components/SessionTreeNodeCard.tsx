import { hasUnreadSessionAttention } from "../utils/session-attention-status.js";
import type { TreeNode } from "../utils/tree-grouping.js";
import type { SidebarSessionItem as SessionItemType } from "../utils/sidebar-session-item.js";
import type { HerdGroupBadgeTheme } from "../utils/herd-group-theme.js";
import { SessionItem, StatusCountDots, type SessionItemProps, type StatusCounts } from "./SessionItem.js";
import { deriveSessionStatus } from "./SessionStatusDot.js";
import { useStore } from "../store.js";

/** Row handlers and editing state shared by every session row in a sidebar list. */
export type SessionTreeRowProps = Pick<
  SessionItemProps,
  | "onSelect"
  | "onStartRename"
  | "onUnarchive"
  | "onDelete"
  | "onClearRecentlyRenamed"
  | "onContextMenu"
  | "onHoverStart"
  | "onHoverEnd"
  | "editingSessionId"
  | "editingName"
  | "setEditingName"
  | "onConfirmRename"
  | "onCancelRename"
  | "editInputRef"
  | "archiveConfirmation"
  | "onConfirmArchive"
  | "onConfirmArchiveHerdMembers"
  | "onCancelArchive"
  | "reorderMode"
  | "isDraggable"
  | "onMobileReorderHandleActiveChange"
>;

export interface SessionTreeNodeCardProps {
  node: TreeNode;
  currentSessionId: string | null;
  recentlyRenamed: Set<string>;
  sessionAttention?: Map<string, "action" | "error" | "review" | null>;
  herdHoverHighlights?: Map<string, "leader" | "worker">;
  herdGroupBadgeThemes?: Map<string, HerdGroupBadgeTheme>;
  /** Session Space shown on the root row, for lists that mix spaces. */
  spaceLabel?: string;
  rowProps: SessionTreeRowProps;
}

/**
 * One sidebar card: a leader with its collapsible herd of workers and
 * reviewers, or a standalone session.
 */
export function SessionTreeNodeCard({
  node,
  currentSessionId,
  recentlyRenamed,
  sessionAttention,
  herdHoverHighlights,
  herdGroupBadgeThemes,
  spaceLabel,
  rowProps,
}: SessionTreeNodeCardProps) {
  const isExpanded = useStore((s) => s.expandedHerdNodes.has(node.leader.id));
  const toggleHerdNodeExpand = useStore((s) => s.toggleHerdNodeExpand);

  function renderSessionItem(
    s: SessionItemType,
    opts?: {
      compact?: boolean;
      reviewerSession?: SessionItemType;
      spaceLabel?: string;
    },
  ) {
    const attention = sessionAttention?.get(s.id) ?? null;
    return (
      <SessionItem
        key={s.id}
        session={s}
        isActive={currentSessionId === s.id}
        sessionName={s.name ?? undefined}
        sessionPreview={s.lastMessagePreview || undefined}
        permCount={s.permCount}
        isRecentlyRenamed={recentlyRenamed.has(s.id)}
        attention={attention}
        hasUnread={hasUnreadSessionAttention(attention)}
        herdGroupBadgeTheme={herdGroupBadgeThemes?.get(s.id)}
        herdHoverHighlight={herdHoverHighlights?.get(s.id)}
        compact={opts?.compact}
        reviewerSession={opts?.reviewerSession}
        spaceLabel={opts?.spaceLabel}
        {...rowProps}
      />
    );
  }

  const leaderReviewer = node.reviewers.find((r) => r.reviewerOf === node.leader.sessionNum);

  // Herded nodes (leader with workers): collapsible container pattern
  if (node.workers.length > 0) {
    const childSessions = [...node.workers, ...node.reviewers];
    const childSummary = computeChildSessionSummary(childSessions, sessionAttention);
    const idleCount =
      childSessions.length -
      (childSummary.running + childSummary.permission + childSummary.unread + (childSummary.waiting ?? 0));
    const reviewerCount = node.reviewers.length;
    const workerLabel = `${node.workers.length} worker${node.workers.length !== 1 ? "s" : ""}`;
    const memberLabel =
      reviewerCount > 0 ? `${workerLabel}, ${reviewerCount} reviewer${reviewerCount !== 1 ? "s" : ""}` : workerLabel;

    return (
      <div className="border border-cc-border/40 rounded-lg overflow-hidden bg-cc-card/20 border-l-[3px] border-l-cc-primary/30">
        {/* Leader chip -- full width, no chevron, no indent */}
        {renderSessionItem(node.leader, {
          reviewerSession: leaderReviewer,
          spaceLabel,
        })}

        {/* Herd summary bar -- always visible, toggles expand/collapse */}
        <button
          data-testid={`herd-summary-${node.leader.id}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleHerdNodeExpand(node.leader.id);
          }}
          className="w-full flex items-center gap-1.5 px-3 py-1 border-t border-cc-border/30 text-[10px] text-cc-muted hover:bg-cc-hover/50 transition-colors cursor-pointer"
          title={isExpanded ? "Collapse sessions" : "Expand sessions"}
        >
          <span className="text-cc-muted/50 shrink-0">{memberLabel}</span>
          <span className="ml-auto flex items-center gap-1.5">
            <StatusCountDots counts={childSummary} />
            {idleCount > 0 && (
              <span className="flex items-center gap-0.5 text-cc-muted/50">
                {idleCount}
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-cc-muted/30" />
              </span>
            )}
          </span>
          <svg
            viewBox="0 0 16 16"
            fill="currentColor"
            className={`w-3 h-3 text-cc-muted/40 transition-transform shrink-0 ${isExpanded ? "rotate-180" : ""}`}
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </button>

        {/* Workers container -- only when expanded */}
        {isExpanded && (
          <div className="border-t border-cc-border/30 pl-3">
            {node.workers.map((w) => {
              const workerReviewer = node.reviewers.find((r) => r.reviewerOf === w.sessionNum);
              return (
                <div key={w.id}>
                  {renderSessionItem(w, {
                    compact: true,
                    reviewerSession: workerReviewer,
                  })}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // Standalone node, with its reviewer (if any) as an inline chip
  return (
    <div className="border border-cc-border/20 rounded-lg">
      {renderSessionItem(node.leader, {
        reviewerSession: leaderReviewer,
        spaceLabel,
      })}
    </div>
  );
}

/** Count child sessions by visual status for the herd summary bar. */
function computeChildSessionSummary(
  sessions: SessionItemType[],
  sessionAttention: SessionTreeNodeCardProps["sessionAttention"],
): StatusCounts {
  const counts = { running: 0, permission: 0, unread: 0, waiting: 0 };
  for (const s of sessions) {
    const attention = sessionAttention?.get(s.id) ?? null;
    const status = deriveSessionStatus({
      archived: s.archived,
      permCount: s.permCount,
      isConnected: s.isConnected,
      sdkState: s.sdkState,
      status: s.status,
      hasUnread: hasUnreadSessionAttention(attention),
      idleKilled: s.idleKilled,
    });
    const isWaiting = (s.pendingTimerCount ?? 0) > 0 || (s.waits?.length ?? 0) > 0;
    const showsWaitingStatus =
      !(s.paused ?? !!s.pause?.pausedAt) && status === "idle" && !attention && s.permCount === 0 && isWaiting;
    if (showsWaitingStatus) counts.waiting++;
    else if (status === "running" || status === "compacting") counts.running++;
    else if (status === "permission") counts.permission++;
    else if (status === "completed_unread") counts.unread++;
  }
  return counts;
}
