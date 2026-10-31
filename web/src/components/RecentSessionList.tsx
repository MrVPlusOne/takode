import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { RecentSessionNode } from "../utils/recent-sessions.js";
import { PENDING_TREE_GROUP_ID, type TreeViewGroupData } from "../utils/tree-grouping.js";
import type { HerdGroupBadgeTheme } from "../utils/herd-group-theme.js";
import { useOutsidePress } from "../hooks/useOutsidePress.js";
import { StatusCountDots } from "./SessionItem.js";
import { SessionTreeNodeCard, type SessionTreeRowProps } from "./SessionTreeNodeCard.js";
import { TOUCH_MENU_CONTAINER_CLASS, TOUCH_MENU_ITEM_CLASS } from "./ContextMenu.js";

interface RecentSessionListProps {
  nodes: RecentSessionNode[];
  currentSessionId: string | null;
  recentlyRenamed: Set<string>;
  sessionAttention: Map<string, "action" | "error" | "review" | null>;
  herdGroupBadgeThemes: Map<string, HerdGroupBadgeTheme>;
  rowProps: SessionTreeRowProps;
}

/** The Recent sidebar view: every space's cards in one list, newest interaction first. */
export function RecentSessionList({
  nodes,
  currentSessionId,
  recentlyRenamed,
  sessionAttention,
  herdGroupBadgeThemes,
  rowProps,
}: RecentSessionListProps) {
  return (
    <div className="space-y-0.5">
      {nodes.map((node) => (
        <SessionTreeNodeCard
          key={node.leader.id}
          node={node}
          currentSessionId={currentSessionId}
          recentlyRenamed={recentlyRenamed}
          sessionAttention={sessionAttention}
          herdGroupBadgeThemes={herdGroupBadgeThemes}
          spaceLabel={node.spaceName}
          rowProps={rowProps}
        />
      ))}
    </div>
  );
}

/**
 * Status totals across every Session Space, with the per-space breakdown on
 * hover (mouse) or tap (touch).
 */
export function RecentSpacesStatus({ spaces }: { spaces: TreeViewGroupData[] }) {
  const popover = useAnchoredPopover();
  const lastPointerType = useRef<string>("mouse");
  const listed = listedSpaces(spaces);
  const totals = listed.reduce(
    (sum, space) => ({
      running: sum.running + space.runningCount,
      permission: sum.permission + space.permCount,
      unread: sum.unread + space.unreadCount,
    }),
    { running: 0, permission: 0, unread: 0 },
  );
  const totalSessions = listed.reduce((sum, space) => sum + countSpaceSessions(space), 0);

  return (
    <>
      <button
        ref={popover.anchorRef}
        type="button"
        data-testid="recent-spaces-status"
        aria-label="Status by Session Space"
        aria-expanded={popover.isOpen}
        onPointerDown={(e) => {
          lastPointerType.current = e.pointerType;
        }}
        onPointerEnter={(e) => {
          if (e.pointerType === "mouse") popover.open();
        }}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") popover.close();
        }}
        onClick={() => {
          // A mouse already opened it on hover; a tap toggles it.
          if (lastPointerType.current !== "mouse") popover.toggle();
        }}
        className="shrink-0 h-7 px-1.5 inline-flex items-center gap-1.5 rounded-md hover:bg-cc-hover transition-colors cursor-pointer"
      >
        {/* The totals are the point; the session count only keeps the control visible when all is quiet. */}
        {hasAnyStatus(totals) ? (
          <StatusCountDots counts={totals} />
        ) : (
          <span className="text-[10px] text-cc-muted/60">{totalSessions}</span>
        )}
      </button>
      {popover.render(
        <div className="min-w-[160px] py-1" data-testid="recent-spaces-status-breakdown">
          {listed.map((space) => (
            <div key={space.id} className="px-2.5 py-1 flex items-center gap-2 text-[11px] text-cc-fg">
              <span className="min-w-0 flex-1 truncate">{space.name}</span>
              <StatusCountDots counts={spaceStatus(space)} />
              <span className="text-[10px] text-cc-muted/60 shrink-0">{countSpaceSessions(space)}</span>
            </div>
          ))}
        </div>,
      )}
    </>
  );
}

/** "+ New" button whose menu picks the Session Space for the new session. */
export function RecentNewSessionMenuButton({
  spaces,
  onCreateSession,
}: {
  spaces: TreeViewGroupData[];
  onCreateSession: (spaceId: string) => void;
}) {
  const popover = useAnchoredPopover();
  return (
    <>
      <button
        ref={popover.anchorRef}
        type="button"
        onClick={popover.toggle}
        className="shrink-0 h-6 px-2 inline-flex items-center justify-center gap-1 rounded-md bg-cc-primary hover:bg-cc-primary-hover text-white text-[10px] font-semibold leading-none whitespace-nowrap transition-colors cursor-pointer"
        aria-label="Create session"
        aria-expanded={popover.isOpen}
      >
        <span aria-hidden="true" className="text-xs leading-none">
          +
        </span>
        <span>New</span>
      </button>
      {popover.render(
        <div role="menu" className="min-w-[160px] py-1">
          <div className="px-2.5 pt-0.5 pb-1 text-[10px] font-medium text-cc-muted">New session in</div>
          {listedSpaces(spaces).map((space) => (
            <button
              key={space.id}
              role="menuitem"
              type="button"
              onClick={() => {
                popover.close();
                onCreateSession(space.id);
              }}
              className={`w-full px-2.5 py-1.5 block truncate text-left text-[11px] text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer ${TOUCH_MENU_ITEM_CLASS}`}
            >
              {space.name}
            </button>
          ))}
        </div>,
      )}
    </>
  );
}

/**
 * A panel below a trigger, right-aligned to it, closed by Escape or a press
 * outside both (the trigger counts as inside so its own toggle wins).
 */
export function useAnchoredPopover() {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; right: number } | null>(null);
  const close = () => setPosition(null);
  const open = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) setPosition({ top: rect.bottom + 4, right: Math.max(8, window.innerWidth - rect.right) });
  };
  useOutsidePress([panelRef, anchorRef], close, !!position);
  useEffect(() => {
    if (!position) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPosition(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [position]);

  return {
    anchorRef,
    isOpen: !!position,
    open,
    close,
    toggle: () => (position ? close() : open()),
    render: (content: ReactNode) =>
      position &&
      createPortal(
        <div
          ref={panelRef}
          className={`fixed z-50 bg-cc-card border border-cc-border rounded-lg shadow-lg ${TOUCH_MENU_CONTAINER_CLASS}`}
          style={{ top: position.top, right: position.right }}
        >
          {content}
        </div>,
        document.body,
      ),
  };
}

/** Spaces the user can see and create in; the transient "Locating..." bucket is not one. */
export function listedSpaces(spaces: TreeViewGroupData[]): TreeViewGroupData[] {
  return spaces.filter((space) => space.id !== PENDING_TREE_GROUP_ID);
}

function hasAnyStatus(counts: { running: number; permission: number; unread: number }): boolean {
  return counts.running > 0 || counts.permission > 0 || counts.unread > 0;
}

function spaceStatus(space: TreeViewGroupData) {
  return { running: space.runningCount, permission: space.permCount, unread: space.unreadCount };
}

function countSpaceSessions(space: TreeViewGroupData): number {
  return space.nodes.reduce((sum, node) => sum + 1 + node.workers.length, 0);
}
