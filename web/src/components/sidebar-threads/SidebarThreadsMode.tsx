import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import type { ThreadSummary } from "../../../shared/library-topics.js";
import type { LeaderThreadTabsProjectionTab } from "../../../shared/leader-thread-tabs-projection.js";
import { isTopicViewKey } from "../../../shared/topic-thread-key.js";
import { useNextAttention } from "../../hooks/useNextAttention.js";
import { useStore } from "../../store.js";
import { useLeadersThreads } from "../../utils/leader-topics.js";
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
import { TOUCH_MENU_ITEM_CLASS } from "../ContextMenu.js";
import { LeaderProfilePortraitImage } from "../LeaderProfilePortraitButton.js";
import { NewThreadIcon } from "../library/library-icons.js";
import { questOf } from "../library/topic-questions.js";
import { listedSpaces, useAnchoredPopover } from "../RecentSessionList.js";
import { StatusCountDots } from "../SessionItem.js";
import { StackedPanes } from "../StackedPanes.js";
import { THREAD_GROUP_DOT, THREAD_GROUP_ORDER, type ThreadGroupId } from "../ThreadTabGroups.js";

/**
 * The sessions panel's Threads view: every leader's threads (quest threads and its other threads, as
 * its status row holds them) in one list, in the status row's groups (Needs you, Unread, In progress,
 * Idle), so on desktop the panel is also a place to see what needs attention across all
 * leaders. Idle threads come newest interaction first. Then the leaders themselves and every other session, as groups that
 * fold and share the panel's height (VS Code's side bar).
 */

/** What waits in a thread or a leader, as the panel's amber/blue/green counts. */
export interface ThreadCounts {
  permission: number;
  unread: number;
  running: number;
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
   * leader log; none for a quest, whose number and status dot already say what it is.
   */
  label?: string;
  counts: ThreadCounts;
  group: ThreadGroupId;
  /** When the user and it last dealt with each other: the order within a group. */
  at: number;
}

const GROUP_RANK = Object.fromEntries(THREAD_GROUP_ORDER.map((id, index) => [id, index])) as Record<
  ThreadGroupId,
  number
>;
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
}

/**
 * Every leader's threads as rows, in the status row's groups (Needs you, Unread, In progress,
 * Idle), each newest interaction first. A thread is In progress only while work goes on in it. A thread's counts come from the attention list (questions
 * amber, unread results blue, a running quest or the thread the leader is answering in green); a
 * question a leader's worker asks about one
 * of its quests counts in that quest. Main's questions and results are read in the leader log, which
 * is a row while they wait, as in the status row.
 */
export function threadRows(leaders: readonly LeaderThreadsInput[], queue: readonly NextAttentionItem[]): ThreadRow[] {
  const rows: ThreadRow[] = [];
  for (const { node, tabs, runningQuestIds, threads, writingThreadKey } of leaders) {
    const leaderId = node.leader.id;
    const attention = attentionByThread(leaderId, queue, new Set(tabs.map((tab) => normalizeThreadKey(tab.threadKey))));
    const writing = writingThreadKey ? normalizeThreadKey(writingThreadKey) : null;
    const counts = (threadKey: string, running = false): ThreadCounts => ({
      permission: attention.get(threadKey)?.permission ?? 0,
      unread: attention.get(threadKey)?.unread ?? 0,
      running: running || threadKey === writing ? 1 : 0,
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
          at: tab.groupChangedAt || tab.updatedAt,
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
          at: thread.interactionAt ?? thread.activityAt,
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
          at: sessionInteractionAt(node.leader),
        }),
      );
    }
  }
  return withoutRepeatedQuests(rows, leaders).sort((a, b) => GROUP_RANK[a.group] - GROUP_RANK[b.group] || b.at - a.at);
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
): Map<string, { permission: number; unread: number }> {
  const byThread = new Map<string, { permission: number; unread: number }>();
  const add = (threadKey: string, kind: "permission" | "unread") => {
    const entry = byThread.get(threadKey) ?? { permission: 0, unread: 0 };
    entry[kind]++;
    byThread.set(threadKey, entry);
  };
  for (const item of queue) {
    if (item.kind === "needs-input") {
      const quest = questOf(item.entry);
      if (item.sessionId === leaderId)
        add(normalizeThreadKey(quest ?? item.threadKey ?? MAIN_THREAD_KEY), "permission");
      else if (quest && ownThreads.has(normalizeThreadKey(quest))) add(normalizeThreadKey(quest), "permission");
      continue;
    }
    if (item.sessionId === leaderId) add(normalizeThreadKey(item.threadKey ?? MAIN_THREAD_KEY), "unread");
  }
  return byThread;
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
  return useMemo(() => {
    const leaders = leaderNodes.map((node, index) => {
      const value = resolveLeaderThreadTabsProjection(
        { syncedProjectionValues: projections, syncedProjectionKeys: projectionKeys },
        node.leader.id,
      ).value;
      return {
        node,
        tabs: value?.tabs ?? [],
        runningQuestIds: (value?.runningQuestIds ?? []).map(normalizeThreadKey),
        threads: threads[node.leader.id] ?? [],
        writingThreadKey: writing[index] ?? null,
      };
    });
    const listed = new Set(leaderNodes.map((node) => node.leader.id));
    return { leaders, others: nodes.filter((node) => !listed.has(node.leader.id)) };
  }, [nodes, leaderNodes, threads, projections, projectionKeys, writing]);
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
}: {
  data: ThreadsModeData;
  currentSessionId: string | null;
  /** Called after a row opened something (closes the panel on phones, as opening a session does). */
  onOpened: () => void;
  /** Today's cards for the sessions that are not leaders (and the archive). */
  otherSessions: (nodes: RecentSessionNode[]) => ReactNode;
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
    const plain = () => navigateToSessionThread(leaderId, threadKey);
    handleOpenInSideClick(event, () => openInSideOnScreen({ kind: "conversation", threadKey, leaderId }), plain) ||
      plain();
    onOpened();
  };
  return (
    <StackedPanes
      stackId="sidebar-threads"
      panes={[
        {
          id: "threads",
          title: "Threads",
          defaultWeight: 3,
          children: (
            <div className="space-y-0.5" data-testid="threads-mode-threads">
              {shown.map((row) => (
                <ThreadRowButton
                  key={row.key}
                  row={row}
                  line={lineOf(row.leader.leader.id, row.threadKey)}
                  current={row.leader.leader.id === currentSessionId && routeThread === row.threadKey}
                  onOpen={(event) => open(row.leader.leader.id, row.threadKey, event)}
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
  );
}

/**
 * One thread: its status dot, quest number and name, counts, then its leader and its news line
 * (Jiayi, Oct 31: the most informative recent update, not its phase or topic; the dot's color
 * already says where it stands).
 */
function ThreadRowButton({
  row,
  line,
  current,
  onOpen,
}: {
  row: ThreadRow;
  /** The thread's news line, as on its leader's Home, when there is one. */
  line?: string;
  current: boolean;
  onOpen: (event: MouseEvent) => void;
}) {
  const leader = row.leader.leader;
  const quiet = row.group === "idle";
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full rounded-lg px-2 py-1.5 text-left transition-colors cursor-pointer ${
        current ? "bg-cc-active" : "hover:bg-cc-hover"
      }`}
      aria-current={current ? "page" : undefined}
      data-testid="threads-mode-row"
      data-thread-key={row.threadKey}
      data-group={row.group}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {row.questId ? (
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
            <span
              className={`h-2 w-2 rounded-full ${THREAD_GROUP_DOT[row.group]}`}
              data-testid="threads-mode-row-dot"
            />
          </span>
        ) : (
          <NewThreadIcon className="h-3.5 w-3.5 shrink-0 text-cc-primary" />
        )}
        <span className={`min-w-0 flex-1 truncate text-[13px] ${quiet ? "text-cc-muted" : "text-cc-fg"}`}>
          {row.questId && (
            <span className="font-mono-code text-[12px] text-cc-muted" data-testid="threads-mode-quest">
              {row.questId}{" "}
            </span>
          )}
          {row.title}
        </span>
        <StatusCountDots counts={row.counts} />
      </div>
      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 pl-5 text-[11px] text-cc-muted">
        {/* The leader as its picture, named on hover. */}
        {leader.leaderProfilePortrait && (
          <span title={leader.name ?? "Leader"} className="flex shrink-0">
            <LeaderProfilePortraitImage portrait={leader.leaderProfilePortrait} size="sm" />
          </span>
        )}
        <span className="min-w-0 truncate" data-testid="threads-mode-line">
          {line ?? row.label ?? (row.at ? `Updated ${timeAgo(row.at)}` : "")}
        </span>
      </div>
    </button>
  );
}

function LeaderRow({
  node,
  current,
  counts,
  onOpen,
}: {
  node: RecentSessionNode;
  current: boolean;
  counts: ThreadCounts;
  onOpen: (event: MouseEvent) => void;
}) {
  const leader = node.leader;
  return (
    <button
      type="button"
      onClick={onOpen}
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
}

/** In the Threads view, New starts a thread with a leader (at its Home), or a session as before. */
export function ThreadsModeNewButton({
  leaders,
  spaces,
  onCreateSession,
}: {
  leaders: RecentSessionNode[];
  spaces: TreeViewGroupData[];
  onCreateSession: (spaceId: string) => void;
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
                // The leader's Home, whose message box starts a new thread.
                navigateToSessionThread(node.leader.id, MAIN_THREAD_KEY);
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
