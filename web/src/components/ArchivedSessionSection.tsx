import type { RefObject } from "react";
import { SessionItem, type SessionItemProps } from "./SessionItem.js";
import type { HerdGroupBadgeTheme } from "../utils/herd-group-theme.js";
import type { SidebarSessionItem } from "../utils/sidebar-session-item.js";

export type CommonSessionItemProps = Omit<
  SessionItemProps,
  | "session"
  | "isActive"
  | "isArchived"
  | "sessionName"
  | "sessionPreview"
  | "permCount"
  | "isRecentlyRenamed"
  | "herdGroupBadgeTheme"
  | "herdHoverHighlight"
  | "reviewerSession"
  | "useStatusBar"
>;

export interface ArchivedSessionSectionProps {
  showArchived: boolean;
  hasNoActiveSessionRows: boolean;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  hasMore: boolean;
  total: number | null;
  archivedSessions: SidebarSessionItem[];
  autoLoadUnsupported: boolean;
  loadMoreSentinelRef: RefObject<HTMLDivElement | null>;
  currentSessionId: string | null;
  sessionNames: Map<string, string>;
  sessionPreviews: Map<string, string>;
  pendingPermissions: Map<string, Map<string, unknown>>;
  recentlyRenamed: Set<string>;
  herdGroupBadgeThemes: Map<string, HerdGroupBadgeTheme>;
  herdHoverHighlights: Map<string, "leader" | "worker">;
  reviewerByParent: Map<number, SidebarSessionItem>;
  sessionItemProps: CommonSessionItemProps;
  countUserPermissions: (perms: Map<string, unknown> | undefined) => number;
  onToggle: () => void;
  onLoadMore: () => void;
  editInputRef?: RefObject<HTMLInputElement | null>;
}

export function ArchivedSessionSection({
  showArchived,
  hasNoActiveSessionRows,
  loaded,
  loading,
  error,
  hasMore,
  total,
  archivedSessions,
  autoLoadUnsupported,
  loadMoreSentinelRef,
  currentSessionId,
  sessionNames,
  sessionPreviews,
  pendingPermissions,
  recentlyRenamed,
  herdGroupBadgeThemes,
  herdHoverHighlights,
  reviewerByParent,
  sessionItemProps,
  countUserPermissions,
  onToggle,
  onLoadMore,
}: ArchivedSessionSectionProps) {
  const archivedCount = total ?? archivedSessions.length;
  const label = loaded || archivedCount > 0 ? `Archived (${archivedCount})` : "Archived";
  const showLoadMoreFallback = !loading && (Boolean(error) || (hasMore && autoLoadUnsupported));
  return (
    <div className="mt-2 pt-2 border-t border-cc-border">
      {hasNoActiveSessionRows && !showArchived && (
        <p className="px-3 pb-2 text-[11px] leading-relaxed text-cc-muted">
          {archivedCount > 0
            ? "Imported history is archived. Open Archived to browse past sessions."
            : "No active sessions. Open Archived to load imported history."}
        </p>
      )}
      <button
        onClick={onToggle}
        className="w-full px-3 py-1.5 text-[11px] font-medium text-cc-muted uppercase tracking-wider flex items-center gap-1.5 hover:text-cc-fg transition-colors cursor-pointer"
      >
        <svg
          viewBox="0 0 16 16"
          fill="currentColor"
          className={`w-3 h-3 transition-transform ${showArchived ? "rotate-90" : ""}`}
        >
          <path d="M6 4l4 4-4 4" />
        </svg>
        {label}
      </button>
      {showArchived && (
        <div className="space-y-2 sm:space-y-0.5 mt-1">
          {archivedSessions.map((session) => (
            <div key={session.id}>
              <SessionItem
                session={session}
                isActive={currentSessionId === session.id}
                isArchived
                sessionName={sessionNames.get(session.id)}
                sessionPreview={sessionPreviews.get(session.id)}
                permCount={countUserPermissions(pendingPermissions.get(session.id))}
                isRecentlyRenamed={recentlyRenamed.has(session.id)}
                herdGroupBadgeTheme={herdGroupBadgeThemes.get(session.id)}
                herdHoverHighlight={herdHoverHighlights.get(session.id)}
                reviewerSession={session.sessionNum != null ? reviewerByParent.get(session.sessionNum) : undefined}
                useStatusBar
                {...sessionItemProps}
              />
            </div>
          ))}
          {loading && <div className="px-3 py-2 text-[11px] text-cc-muted">Loading archived sessions...</div>}
          {error && <div className="px-3 py-2 text-[11px] text-cc-error">{error}</div>}
          {!loading && loaded && archivedSessions.length === 0 && (
            <div className="px-3 py-2 text-[11px] text-cc-muted">No archived sessions.</div>
          )}
          {hasMore && !error && (
            <div
              ref={loadMoreSentinelRef}
              data-testid="archived-session-load-sentinel"
              aria-hidden="true"
              className="h-px"
            />
          )}
          {showLoadMoreFallback && (
            <button
              type="button"
              onClick={onLoadMore}
              className="mx-3 my-1 rounded-md border border-cc-border px-2 py-1 text-[11px] text-cc-muted hover:text-cc-fg hover:bg-cc-hover transition-colors"
            >
              {error ? "Retry archived sessions" : "Load more archived sessions"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
