import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { UpdateMarker } from "../ThreadUpdate.js";
import { useShallow } from "zustand/react/shallow";
import type { ThreadSummary } from "../../../shared/library-topics.js";
import type { LeaderThreadTabsProjectionTab } from "../../../shared/leader-thread-tabs-projection.js";
import { isTopicViewKey } from "../../../shared/topic-thread-key.js";
import { useNextAttention } from "../../hooks/useNextAttention.js";
import { useStore } from "../../store.js";
import { sideComposerDraftKey } from "../../draft-sync-bridge.js";
import { useLeadersThreads } from "../../utils/leader-topics.js";
import { useCancelledQuestIds } from "../../utils/cancelled-quests.js";
import { timeAgo } from "../../utils/quest-helpers.js";
import { useLeadersHomeLines } from "../home/HomeExtras.js";
import { resolveLeaderThreadTabsProjection } from "../../utils/leader-thread-tabs-resolver.js";
import type { NextAttentionItem } from "../../utils/next-attention.js";
import type { RecentSessionNode } from "../../utils/recent-sessions.js";
import { sessionInteractionAt } from "../../utils/recent-sessions.js";
import { navigateToSessionThread, threadRouteFromHash } from "../../utils/routing.js";
import { handleOpenInSideClick, openInSideOnScreen } from "../../utils/side-column.js";
import { ALL_THREADS_KEY, MAIN_THREAD_KEY, normalizeThreadKey } from "../../utils/thread-projection.js";
import type { TreeViewGroupData } from "../../utils/tree-grouping.js";
import { useLongPress } from "../../hooks/useLongPress.js";
import { latestReadThreadResult, markThreadRead, threadMenuItems } from "../../utils/attention-item-menu.js";
import type { CommonSessionItemProps } from "../ArchivedSessionSection.js";
import { ContextMenu, TOUCH_MENU_ITEM_CLASS, type ContextMenuItem } from "../ContextMenu.js";
import { SessionArchiveConfirmation } from "../SessionArchiveConfirmation.js";
import { LeaderProfilePortraitImage } from "../LeaderProfilePortraitButton.js";
import { NewThreadIcon } from "../library/library-icons.js";
import { questOf } from "../library/topic-questions.js";
import { listedSpaces, useAnchoredPopover } from "../RecentSessionList.js";
import { StatusCountDots } from "../SessionItem.js";
import { StackedPanes } from "../StackedPanes.js";
import type { ThreadGroupId } from "../ThreadTabGroups.js";

/**
 * The sessions panel's Threads view: every leader's threads (quest threads and its other threads, as
 * its status row holds them) in one list, the one the user last dealt with first, like a chat app
 * (Jiayi, Nov 1: finding the thread just used matters most here; the bell and each leader's Home
 * are for going over what needs attention). Threads with a question for the user stay on top. Then
 * the leaders themselves and every other session, as groups that fold and share the panel's height
 * (VS Code's side bar).
 */

/** What waits in a thread or a leader, as the panel's amber/blue/green counts. */
export interface ThreadCounts {
  permission: number;
  unread: number;
  running: number;
  /** When the newest question and unread result came, for the cue a new one plays. */
  permissionAt?: number;
  unreadAt?: number;
}

/** One of a leader's threads, as a row of the list. */
export interface ThreadRow {
  key: string;
  leader: RecentSessionNode;
  threadKey: string;
  questId: string | null;
  title: string;
  /**
   * What the second line says when there is no news line yet: a short label for a thread or the
   * leader log; none for a quest, whose status dot already says what it is.
   */
  label?: string;
  counts: ThreadCounts;
  /** Its status: the dot's color, and questions (`needs-input`) stay on top. */
  group: ThreadGroupId;
  /**
   * When the user last dealt with it (the projection's `userInteractionAt`; a thread the user
   * started, from its start): the list's order. 0 when they never did.
   */
  at: number;
  /** Its own latest activity, for its "Updated" label and between rows the user never dealt with. */
  activityAt: number;
}

/** The Idle rows shown before "N older". */
const IDLE_SHOWN = 30;

/** A leader's threads and attention, as `threadRows` reads them. */
export interface LeaderThreadsInput {
  node: RecentSessionNode;
  tabs: readonly LeaderThreadTabsProjectionTab[];
  runningQuestIds: readonly string[];
  threads: readonly ThreadSummary[];
  /** The thread the leader is writing in now, if any: it counts as running there. */
  writingThreadKey?: string | null;
  /** When the user last dealt with each of its threads, by thread key (the tab projection's). */
  userInteractionAt?: Readonly<Record<string, number>>;
}

/**
 * Every leader's threads as rows, the one the user last dealt with first; threads with a question
 * for the user stay on top, in the same order among themselves. Nothing else moves a row: an unread
 * result or running work shows only in its dot and counts. A thread's counts come from the attention
 * list (questions amber, unread results blue, a running quest or the thread the leader is answering
 * in green); a question a leader's worker asks about one of its quests counts in that quest. Main's
 * questions and results are read in the leader log, which is a row while they wait, as in the
 * status row.
 */
export function threadRows(leaders: readonly LeaderThreadsInput[], queue: readonly NextAttentionItem[]): ThreadRow[] {
  const rows: ThreadRow[] = [];
  for (const { node, tabs, runningQuestIds, threads, writingThreadKey, userInteractionAt = {} } of leaders) {
    const leaderId = node.leader.id;
    const attention = attentionByThread(leaderId, queue, new Set(tabs.map((tab) => normalizeThreadKey(tab.threadKey))));
    const writing = writingThreadKey ? normalizeThreadKey(writingThreadKey) : null;
    const counts = (threadKey: string, running = false): ThreadCounts => ({
      permission: attention.get(threadKey)?.permission ?? 0,
      unread: attention.get(threadKey)?.unread ?? 0,
      running: running || threadKey === writing ? 1 : 0,
      permissionAt: attention.get(threadKey)?.permissionAt ?? 0,
      unreadAt: attention.get(threadKey)?.unreadAt ?? 0,
    });
    const row = (input: Omit<ThreadRow, "key" | "leader" | "group">): ThreadRow => ({
      ...input,
      key: `${leaderId}:${input.threadKey}`,
      leader: node,
      group: groupOf(input.counts),
    });
    for (const tab of tabs) {
      const threadKey = normalizeThreadKey(tab.threadKey);
      const running = !!tab.questId && runningQuestIds.includes(normalizeThreadKey(tab.questId));
      rows.push(
        row({
          threadKey,
          questId: tab.questId,
          title: tab.title ?? tab.questId ?? threadKey,
          counts: counts(threadKey, running),
          at: userInteractionAt[threadKey] ?? 0,
          activityAt: tab.groupChangedAt || tab.updatedAt,
        }),
      );
    }
    for (const thread of threads) {
      if (thread.empty) continue;
      const threadKey = normalizeThreadKey(thread.key);
      rows.push(
        row({
          threadKey,
          questId: null,
          title: thread.name,
          label: "Thread",
          counts: counts(threadKey),
          // Starting a thread is dealing with it: it is on top from the start.
          at: Math.max(userInteractionAt[threadKey] ?? 0, thread.startedBy ? 0 : thread.createdAt),
          activityAt: thread.interactionAt ?? thread.activityAt,
        }),
      );
    }
    const main = counts(MAIN_THREAD_KEY);
    if (main.permission || main.unread) {
      rows.push(
        row({
          threadKey: ALL_THREADS_KEY,
          questId: null,
          title: "Leader log",
          label: "Main's messages",
          counts: main,
          at: userInteractionAt[MAIN_THREAD_KEY] ?? 0,
          activityAt: sessionInteractionAt(node.leader),
        }),
      );
    }
  }
  const asking = (row: ThreadRow) => (row.group === "needs-input" ? 1 : 0);
  return withoutRepeatedQuests(rows, leaders).sort(
    (a, b) => asking(b) - asking(a) || b.at - a.at || b.activityAt - a.activityAt,
  );
}

/**
 * A quest in the tabs of two leaders (handed from one to the other) is one row: the leader whose
 * board holds it, else the first listed.
 */
function withoutRepeatedQuests(rows: ThreadRow[], leaders: readonly LeaderThreadsInput[]): ThreadRow[] {
  const owner = new Map<string, string>();
  for (const { node, tabs } of leaders) {
    for (const tab of tabs) {
      if (tab.questId && tab.ownership === "own") owner.set(normalizeThreadKey(tab.questId), node.leader.id);
    }
  }
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (!row.questId) return true;
    const questId = normalizeThreadKey(row.questId);
    const keeper = owner.get(questId);
    if (keeper ? keeper !== row.leader.leader.id : seen.has(questId)) return false;
    seen.add(questId);
    return true;
  });
}

/** A leader's counts as a whole: its own questions and results, and its running quests. */
export function leaderCounts(input: LeaderThreadsInput, queue: readonly NextAttentionItem[]): ThreadCounts {
  const leaderId = input.node.leader.id;
  let permission = 0;
  let unread = 0;
  for (const item of queue) {
    if (item.sessionId !== leaderId) continue;
    if (item.kind === "needs-input") permission++;
    else unread++;
  }
  return { permission, unread, running: input.runningQuestIds.length };
}

function groupOf(counts: ThreadCounts): ThreadGroupId {
  if (counts.permission > 0) return "needs-input";
  if (counts.unread > 0) return "new-results";
  return counts.running > 0 ? "in-progress" : "idle";
}

/**
 * Questions and unread results of one leader, by thread. A question asked by another session (its
 * worker) about one of the leader's quests counts in that quest; everything else is the leader's own.
 */
function attentionByThread(
  leaderId: string,
  queue: readonly NextAttentionItem[],
  ownThreads: ReadonlySet<string>,
): Map<string, ThreadAttention> {
  const byThread = new Map<string, ThreadAttention>();
  const add = (threadKey: string, kind: "permission" | "unread", at: number) => {
    const entry = byThread.get(threadKey) ?? { permission: 0, unread: 0, permissionAt: 0, unreadAt: 0 };
    entry[kind]++;
    entry[`${kind}At`] = Math.max(entry[`${kind}At`], at);
    byThread.set(threadKey, entry);
  };
  for (const item of queue) {
    if (item.kind === "needs-input") {
      const quest = questOf(item.entry);
      if (item.sessionId === leaderId)
        add(normalizeThreadKey(quest ?? item.threadKey ?? MAIN_THREAD_KEY), "permission", item.timestamp);
      else if (quest && ownThreads.has(normalizeThreadKey(quest)))
        add(normalizeThreadKey(quest), "permission", item.timestamp);
      continue;
    }
    if (item.sessionId === leaderId)
      add(normalizeThreadKey(item.threadKey ?? MAIN_THREAD_KEY), "unread", item.timestamp);
  }
  return byThread;
}

interface ThreadAttention {
  permission: number;
  unread: number;
  permissionAt: number;
  unreadAt: number;
}

export interface ThreadsModeData {
  /** The leaders, in the panel's Recent order, with their threads. */
  leaders: LeaderThreadsInput[];
  /** Every other card. */
  others: RecentSessionNode[];
}

/**
 * The leaders among the panel's cards with their threads: quest threads from each leader's tab
 * projection (synced for every leader), other threads loaded per leader and again when the user and
 * the leader deal with each other. Nothing loads while `active` is false (another view is shown).
 */
export function useThreadsModeData(nodes: readonly RecentSessionNode[], active: boolean): ThreadsModeData {
  const leaderNodes = useMemo(() => nodes.filter((node) => node.leader.isOrchestrator), [nodes]);
  const interactions = leaderNodes.map((node) => sessionInteractionAt(node.leader)).join(",");
  const threads = useLeadersThreads(
    leaderNodes.map((node) => node.leader.id),
    active,
    interactions,
  );
  const writing = useStore(
    useShallow((state) =>
      leaderNodes.map((node) =>
        state.sessionStatus.get(node.leader.id) === "running"
          ? (state.activeTurnRoutes.get(node.leader.id)?.threadKey ?? null)
          : null,
      ),
    ),
  );
  const projections = useStore((state) => state.syncedProjectionValues);
  const projectionKeys = useStore((state) => state.syncedProjectionKeys);
  const values = useMemo(
    () =>
      leaderNodes.map(
        (node) =>
          resolveLeaderThreadTabsProjection(
            { syncedProjectionValues: projections, syncedProjectionKeys: projectionKeys },
            node.leader.id,
          ).value,
      ),
    [leaderNodes, projections, projectionKeys],
  );
  // Cancelled quests are left out, as in each leader's status row and Home.
  const tabQuestIds = values.flatMap((value) => (value?.tabs ?? []).map((tab) => tab.questId));
  const cancelled = useCancelledQuestIds(tabQuestIds);
  // Their title previews (cancelled marks, a reopened quest's round title) load here for every
  // leader; a leader's own view loads only its own.
  const unloaded = useStore(
    useShallow((state) =>
      tabQuestIds.flatMap((questId) => {
        const key = questId ? normalizeThreadKey(questId) : null;
        return key && !state.questTitlePreviews.has(key) ? [key] : [];
      }),
    ),
  ).join(",");
  useEffect(() => {
    if (active && unloaded) void useStore.getState().hydrateQuestTitles(unloaded.split(","));
  }, [active, unloaded]);
  return useMemo(() => {
    const leaders = leaderNodes.map((node, index) => {
      const value = values[index];
      return {
        node,
        tabs: (value?.tabs ?? []).filter((tab) => !(tab.questId && cancelled.has(normalizeThreadKey(tab.questId)))),
        runningQuestIds: (value?.runningQuestIds ?? []).map(normalizeThreadKey),
        threads: threads[node.leader.id] ?? [],
        writingThreadKey: writing[index] ?? null,
        ...(value?.userInteractionAt ? { userInteractionAt: value.userInteractionAt } : {}),
      };
    });
    const listed = new Set(leaderNodes.map((node) => node.leader.id));
    return { leaders, others: nodes.filter((node) => !listed.has(node.leader.id)) };
  }, [nodes, leaderNodes, threads, values, cancelled, writing]);
}

/** The thread on screen, as the route says. */
function useRouteThread(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return normalizeThreadKey(threadRouteFromHash(hash).threadKey ?? MAIN_THREAD_KEY);
}

export function SidebarThreadsMode({
  data: { leaders, others },
  currentSessionId,
  onOpened,
  otherSessions,
  sessionRowProps,
}: {
  data: ThreadsModeData;
  currentSessionId: string | null;
  /** Called after a row opened something (closes the panel on phones, as opening a session does). */
  onOpened: () => void;
  /** Today's cards for the sessions that are not leaders (and the archive). */
  otherSessions: (nodes: RecentSessionNode[]) => ReactNode;
  /**
   * The session cards' menu, rename and archive confirmation, for the leader rows: right-click or
   * long-press on a leader opens the same session menu as its card in the other views.
   */
  sessionRowProps?: CommonSessionItemProps;
}) {
  const { queue } = useNextAttention();
  const questKeys = useMemo(
    () =>
      leaders.flatMap(({ node, tabs }) =>
        tabs.flatMap((tab) =>
          tab.questId ? [{ leaderId: node.leader.id, questId: normalizeThreadKey(tab.questId) }] : [],
        ),
      ),
    [leaders],
  );
  const linesFor = useMemo(
    () =>
      leaders.map(({ node }) => ({
        leaderId: node.leader.id,
        questIds: questKeys.filter((quest) => quest.leaderId === node.leader.id).map((quest) => quest.questId),
      })),
    [leaders, questKeys],
  );
  const lineOf = useLeadersHomeLines(linesFor);
  const rows = useMemo(() => threadRows(leaders, queue), [leaders, queue]);
  const [allIdle, setAllIdle] = useState(false);
  const idle = rows.filter((row) => row.group === "idle");
  const shown = allIdle ? rows : rows.filter((row) => row.group !== "idle" || idle.indexOf(row) < IDLE_SHOWN);
  const routeThread = useRouteThread();
  const open = (leaderId: string, threadKey: string, event: MouseEvent) => {
    // Main named outright: a bare leader address restores the thread viewed last, not Home.
    const plain = () =>
      navigateToSessionThread(leaderId, threadKey, false, leaderId, { preserveMainThreadRoute: true });
    handleOpenInSideClick(event, () => openInSideOnScreen({ kind: "conversation", threadKey, leaderId }), plain) ||
      plain();
    onOpened();
  };
  // A thread row's menu (right-click, or long-press on touch).
  const [menu, setMenu] = useState<{ row: ThreadRow; x: number; y: number } | null>(null);
  return (
    <>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={threadRowMenuItems(menu.row, () => {
            navigateToSessionThread(menu.row.leader.leader.id, menu.row.threadKey);
            onOpened();
          })}
          onClose={() => setMenu(null)}
        />
      )}
      <StackedPanes
        stackId="sidebar-threads"
        panes={[
          {
            id: "threads",
            title: "Threads",
            defaultWeight: 3,
            children: (
              <div className="space-y-0.5" data-testid="threads-mode-threads">
                {shown.map((row, index) => (
                  <ThreadRowButton
                    key={row.key}
                    // A line under the questions kept on top, where the order by recency starts.
                    lastPinned={
                      row.group === "needs-input" &&
                      shown[index + 1]?.group !== "needs-input" &&
                      index + 1 < shown.length
                    }
                    row={row}
                    line={lineOf(row.leader.leader.id, row.threadKey)}
                    current={row.leader.leader.id === currentSessionId && routeThread === row.threadKey}
                    onOpen={(event) => open(row.leader.leader.id, row.threadKey, event)}
                    onOpenMenu={(x, y) => setMenu({ row, x, y })}
                  />
                ))}
                {shown.length < rows.length && (
                  <button
                    type="button"
                    onClick={() => setAllIdle(true)}
                    className="w-full rounded-lg px-2 py-1.5 text-left text-[11px] text-cc-muted hover:bg-cc-hover"
                    data-testid="threads-mode-more"
                  >
                    {rows.length - shown.length} older idle
                  </button>
                )}
              </div>
            ),
          },
          {
            id: "leaders",
            title: "Leaders",
            defaultWeight: 1,
            children: (
              <div className="space-y-0.5" data-testid="threads-mode-leaders">
                {leaders.map((input) => (
                  <LeaderRow
                    key={input.node.leader.id}
                    node={input.node}
                    current={input.node.leader.id === currentSessionId && routeThread === MAIN_THREAD_KEY}
                    counts={leaderCounts(input, queue)}
                    onOpen={(event) => open(input.node.leader.id, MAIN_THREAD_KEY, event)}
                    sessionRowProps={sessionRowProps}
                  />
                ))}
              </div>
            ),
          },
          {
            id: "sessions",
            title: "Other sessions",
            defaultWeight: 2,
            children: otherSessions(others),
          },
        ]}
      />
    </>
  );
}

/**
 * A thread row's actions: open it (also in the side column), its quest and worker, mark it read
 * or unread, remind me later, copy link. The leader log only opens and marks Main's results read.
 */
function threadRowMenuItems(row: ThreadRow, open: () => void): ContextMenuItem[] {
  const leaderId = row.leader.leader.id;
  const items: ContextMenuItem[] = [{ label: "Open", onClick: open }];
  if (row.threadKey === ALL_THREADS_KEY) {
    if (row.counts.unread > 0) {
      items.push({
        label: "Mark as read",
        onClick: () =>
          void markThreadRead(leaderId, MAIN_THREAD_KEY).catch((error) =>
            console.error("[threads-view] Mark as read failed:", error),
          ),
      });
    }
    return items;
  }
  const state = useStore.getState();
  const boardRow = row.questId
    ? state.sessionBoards.get(leaderId)?.find((candidate) => normalizeThreadKey(candidate.questId) === row.questId)
    : undefined;
  items.push(
    ...threadMenuItems({
      leaderId,
      threadKey: row.threadKey,
      ...(row.questId ? { questId: row.questId } : {}),
      ...(boardRow?.worker ? { workerId: boardRow.worker, workerNum: boardRow.workerNum } : {}),
      read: {
        unread: row.counts.unread > 0,
        canMarkUnread: !!latestReadThreadResult(state.sessionNotifications.get(leaderId), row.threadKey),
      },
    }),
  );
  return items;
}

/**
 * One thread: its leader's portrait, ringed in the thread's status colour as Sessions mode rings a
 * leader's (Jiayi, Nov 3: it took the status dot's place, so the update has the row's width), its
 * name and counts; then its update, the most informative recent news (Jiayi, Oct 31). A quest's
 * number is left out so its title gets the room (Jiayi, Nov 1); hovering shows it with the whole
 * title and update, and the row's menu and the thread itself open the quest.
 */
function ThreadRowButton({
  row,
  lastPinned,
  line,
  current,
  onOpen,
  onOpenMenu,
}: {
  row: ThreadRow;
  lastPinned?: boolean;
  /** The thread's news line, as on its leader's Home, when there is one. */
  line?: string;
  current: boolean;
  onOpen: (event: MouseEvent) => void;
  onOpenMenu: (x: number, y: number) => void;
}) {
  const quiet = row.group === "idle";
  const longPress = useLongPress(onOpenMenu);
  const button = (
    <button
      type="button"
      onClick={onOpen}
      {...longPress.handlers}
      style={longPress.pressStyle}
      className={`w-full rounded-lg px-2 py-1.5 text-left transition-colors cursor-pointer ${
        current ? "bg-cc-active" : "hover:bg-cc-hover"
      }`}
      aria-current={current ? "page" : undefined}
      title={[row.questId ? `${row.questId} ${row.title}` : row.title, line].filter(Boolean).join("\n")}
      data-testid="threads-mode-row"
      data-thread-key={row.threadKey}
      data-group={row.group}
    >
      <div className="flex min-w-0 items-center gap-2">
        <ThreadStatusPortrait row={row} />
        <span className={`min-w-0 flex-1 truncate text-[13px] ${quiet ? "text-cc-muted" : "text-cc-fg"}`}>
          {row.title}
        </span>
        <StatusCountDots counts={row.counts} />
      </div>
      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 pl-7 text-[11px] text-cc-muted">
        {line && <UpdateMarker />}
        <span className="min-w-0 truncate" data-testid="threads-mode-line">
          {line ?? row.label ?? (row.activityAt ? `Updated ${timeAgo(row.activityAt)}` : "")}
        </span>
      </div>
    </button>
  );
  if (!lastPinned) return button;
  return (
    <>
      {button}
      <div className="mx-2 my-1 border-t border-cc-border/60" data-testid="threads-mode-pinned-end" />
    </>
  );
}

/** A thread's ring colours by status group: Sessions mode's for running, needs you, unread and idle. */
const GROUP_RING: Record<ThreadRow["group"], string> = {
  "needs-input": "ring-2 ring-amber-400/80",
  "new-results": "ring-2 ring-blue-500/70",
  "in-progress": "ring-2 ring-emerald-500/80",
  idle: "ring-2 ring-cc-muted/35",
};

/**
 * The thread's leader, ringed in the thread's status colour; a plain thread (no quest) carries the
 * new-thread mark on the portrait's corner. The leader is named on hover through the row.
 */
function ThreadStatusPortrait({ row }: { row: ThreadRow }) {
  const portrait = row.leader.leader.leaderProfilePortrait;
  const badge = !row.questId && (
    <span className="flex translate-x-1 translate-y-1 rounded-full bg-cc-bg p-px">
      <NewThreadIcon className="h-2.5 w-2.5 text-cc-primary" />
    </span>
  );
  if (!portrait) {
    return (
      <span
        className={`relative h-5 w-5 shrink-0 rounded-full bg-cc-hover ${GROUP_RING[row.group]}`}
        data-testid="threads-mode-row-status"
        data-status={row.group}
      >
        {badge && <span className="absolute -bottom-px -right-px flex">{badge}</span>}
      </span>
    );
  }
  return (
    <LeaderProfilePortraitImage
      portrait={portrait}
      size="sm"
      statusRing={{ className: GROUP_RING[row.group], status: row.group }}
      cornerBadge={badge || undefined}
      testId="threads-mode-row-status"
    />
  );
}

function LeaderRow({
  node,
  current,
  counts,
  onOpen,
  sessionRowProps: props,
}: {
  node: RecentSessionNode;
  current: boolean;
  counts: ThreadCounts;
  onOpen: (event: MouseEvent) => void;
  sessionRowProps?: CommonSessionItemProps;
}) {
  const leader = node.leader;
  const editing = props?.editingSessionId === leader.id;
  const onContextMenu = props?.onContextMenu;
  const longPress = useLongPress(
    onContextMenu && !editing
      ? (x, y) =>
          onContextMenu(
            { preventDefault: () => {}, stopPropagation: () => {}, clientX: x, clientY: y } as MouseEvent,
            leader.id,
          )
      : undefined,
  );
  const archiving = props?.archiveConfirmation?.sessionId === leader.id;
  const confirmation = archiving && props?.onConfirmArchive && props.onCancelArchive && (
    <SessionArchiveConfirmation
      archiveConfirmation={props.archiveConfirmation!}
      onConfirmArchive={props.onConfirmArchive}
      onConfirmArchiveHerdMembers={props.onConfirmArchiveHerdMembers}
      onCancelArchive={props.onCancelArchive}
    />
  );
  if (editing && props) {
    // Renaming from the session menu, as a session card does.
    return (
      <div className="flex w-full min-w-0 items-center gap-2 rounded-lg bg-cc-active px-2 py-1.5">
        {leader.leaderProfilePortrait && (
          <LeaderProfilePortraitImage portrait={leader.leaderProfilePortrait} size="lg" />
        )}
        <input
          ref={props.editInputRef}
          value={props.editingName}
          onChange={(event) => props.setEditingName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              props.onConfirmRename();
            } else if (event.key === "Escape") {
              event.preventDefault();
              props.onCancelRename();
            }
            event.stopPropagation();
          }}
          onBlur={props.onConfirmRename}
          className="min-w-0 flex-1 rounded border border-cc-border bg-transparent px-1 py-0 text-[13px] text-cc-fg outline-none focus:border-cc-primary/50"
          data-testid="threads-mode-leader-rename"
        />
      </div>
    );
  }
  const row = (
    <button
      type="button"
      onClick={onOpen}
      {...longPress.handlers}
      style={longPress.pressStyle}
      className={`flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors cursor-pointer ${
        current ? "bg-cc-active" : "hover:bg-cc-hover"
      }`}
      aria-current={current ? "page" : undefined}
      title={`${leader.name ?? "Leader"}: Home`}
      data-testid="threads-mode-leader"
    >
      {leader.leaderProfilePortrait && <LeaderProfilePortraitImage portrait={leader.leaderProfilePortrait} size="lg" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-cc-fg">{leader.name ?? "Leader"}</span>
        <span className="block truncate text-[11px] text-cc-muted">
          Home · {node.spaceName}
          {leader.sessionNum != null ? ` · #${leader.sessionNum}` : ""}
        </span>
      </span>
      <StatusCountDots counts={counts} />
    </button>
  );
  return confirmation ? (
    <div>
      {row}
      {confirmation}
    </div>
  ) : (
    row
  );
}

/**
 * In the Threads view, New starts a thread with a leader, or a session as before. A new thread is
 * written at the leader's Home, whose message box starts one: New opens it in the main view, ready
 * to type (Jiayi, Nov 1: it used to restore the leader's last thread instead).
 */
export function ThreadsModeNewButton({
  leaders,
  spaces,
  onCreateSession,
  onOpened,
}: {
  leaders: RecentSessionNode[];
  spaces: TreeViewGroupData[];
  onCreateSession: (spaceId: string) => void;
  /** Called after it opened a leader's Home (closes the panel on phones, as opening a thread does). */
  onOpened: () => void;
}) {
  const popover = useAnchoredPopover();
  const item = `w-full px-2.5 py-1.5 flex items-center gap-2 truncate text-left text-[11px] text-cc-fg hover:bg-cc-hover transition-colors cursor-pointer ${TOUCH_MENU_ITEM_CLASS}`;
  return (
    <>
      <button
        ref={popover.anchorRef}
        type="button"
        onClick={popover.toggle}
        className="shrink-0 h-6 px-2 inline-flex items-center justify-center gap-1 rounded-md bg-cc-primary hover:bg-cc-primary-hover text-white text-[10px] font-semibold leading-none whitespace-nowrap transition-colors cursor-pointer"
        aria-label="New thread or session"
        aria-expanded={popover.isOpen}
      >
        <span aria-hidden="true" className="text-xs leading-none">
          +
        </span>
        <span>New</span>
      </button>
      {popover.render(
        <div role="menu" className="min-w-[200px] py-1">
          {leaders.length > 0 && (
            <div className="px-2.5 pt-0.5 pb-1 text-[10px] font-medium text-cc-muted">New thread with</div>
          )}
          {leaders.map((node) => (
            <button
              key={node.leader.id}
              role="menuitem"
              type="button"
              className={item}
              onClick={() => {
                popover.close();
                // Main named outright: a bare leader address restores the thread viewed last.
                navigateToSessionThread(node.leader.id, MAIN_THREAD_KEY, false, node.leader.id, {
                  preserveMainThreadRoute: true,
                });
                useStore.getState().focusComposer(sideComposerDraftKey(node.leader.id, "home"), { whenShown: true });
                onOpened();
              }}
            >
              {node.leader.leaderProfilePortrait && (
                <LeaderProfilePortraitImage portrait={node.leader.leaderProfilePortrait} size="sm" />
              )}
              {node.leader.name ?? "Leader"}
            </button>
          ))}
          <div
            className={`px-2.5 pt-1.5 pb-1 text-[10px] font-medium text-cc-muted ${
              leaders.length > 0 ? "mt-1 border-t border-cc-border/60" : ""
            }`}
          >
            New session in
          </div>
          {listedSpaces(spaces).map((space) => (
            <button
              key={space.id}
              role="menuitem"
              type="button"
              className={item}
              onClick={() => {
                popover.close();
                onCreateSession(space.id);
              }}
            >
              {space.name}
            </button>
          ))}
        </div>,
      )}
    </>
  );
}
