import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ThreadSummary, TopicSummary } from "../../../shared/library-topics.js";
import { isKeyOfTopic, topicViewKey } from "../../../shared/topic-thread-key.js";
import { topicApi } from "../../api/topics.js";
import { useNextAttention } from "../../hooks/useNextAttention.js";
import { useStore } from "../../store.js";
import type { NextAttentionItem } from "../../utils/next-attention.js";
import type { RecentSessionNode } from "../../utils/recent-sessions.js";
import { sessionInteractionAt } from "../../utils/recent-sessions.js";
import { resolveLeaderThreadTabsProjection } from "../../utils/leader-thread-tabs-resolver.js";
import { navigateToSessionThread, threadRouteFromHash } from "../../utils/routing.js";
import { openInSide } from "../../utils/side-column.js";
import { normalizeThreadKey } from "../../utils/thread-projection.js";
import type { TreeViewGroupData } from "../../utils/tree-grouping.js";
import { TOUCH_MENU_ITEM_CLASS } from "../ContextMenu.js";
import { LeaderProfilePortraitImage } from "../LeaderProfilePortraitButton.js";
import { NewThreadIcon, TopicIcon } from "../library/library-icons.js";
import { questOf } from "../library/topic-questions.js";
import { topicRowLine } from "../library/topic-search.js";
import { listedSpaces, useAnchoredPopover } from "../RecentSessionList.js";
import { StatusCountDots } from "../SessionItem.js";
import { StackedPanes } from "../StackedPanes.js";

/**
 * The sessions panel's Topics mode: for someone who works with one or two leaders and moves between
 * topics more than between sessions (Jiayi, Oct 30), the topics and side chats of every leader with
 * topics in one list, the leaders themselves, and every other session as today's cards. The groups
 * fold and share the panel's height, with a divider to drag between them, as in VS Code's side bar.
 */

/** A topic or side chat of one leader, as a row of the list. */
export interface TopicPlace {
  key: string;
  leader: RecentSessionNode;
  kind: "topic" | "thread";
  threadKey: string;
  name: string;
  line?: string;
  /** When the user and the place last dealt with each other: the order of the list. */
  at: number;
  topic?: TopicSummary;
}

interface LeaderPlaces {
  node: RecentSessionNode;
  topics: TopicSummary[];
  threads: ThreadSummary[];
}

type Counts = { running: number; permission: number; unread: number };

/**
 * The rows of the Topics list, newest interaction first. A topic holding quests of several leaders
 * is listed once, in the leader where the user dealt with it last. Side chats filed under a topic show
 * in its conversation, so only unfiled ones are rows of their own.
 */
export function topicPlaces(leaders: readonly LeaderPlaces[]): TopicPlace[] {
  const byTopic = new Map<string, TopicPlace>();
  const rows: TopicPlace[] = [];
  for (const { node, topics, threads } of leaders) {
    for (const topic of topics) {
      const place: TopicPlace = {
        key: `${node.leader.id}:${topic.id}`,
        leader: node,
        kind: "topic",
        threadKey: topicViewKey(topic.id),
        name: topic.name,
        line: topicRowLine(topic),
        at: topic.interactionAt ?? topic.activityAt,
        topic,
      };
      const known = byTopic.get(topic.id);
      if (!known || place.at > known.at) byTopic.set(topic.id, place);
    }
    for (const thread of threads) {
      if (thread.empty || thread.topic) continue;
      rows.push({
        key: `${node.leader.id}:${thread.id}`,
        leader: node,
        kind: "thread",
        threadKey: thread.key,
        name: thread.name,
        line: "Side chat",
        at: thread.activityAt,
      });
    }
  }
  return [...byTopic.values(), ...rows].sort((a, b) => b.at - a.at);
}

export interface TopicsModeData {
  /** The leaders with topics (or side chats), in the panel's Recent order, with them. */
  places: LeaderPlaces[];
  /** Every other card. */
  others: RecentSessionNode[];
}

/**
 * The leaders with topics among the panel's cards, with their topics and side chats, kept fresh:
 * a leader's are read again when the user and it deal with each other, and every minute. Nothing
 * is read while `active` is false (another mode is shown).
 */
export function useTopicsModeData(nodes: readonly RecentSessionNode[], active: boolean): TopicsModeData {
  const [loaded, setLoaded] = useState<Record<string, { topics: TopicSummary[]; threads: ThreadSummary[] }>>({});
  const [enabled, setEnabled] = useState<string[] | null>(null);
  const leaderIds = nodes.filter((node) => node.leader.isOrchestrator).map((node) => node.leader.id);
  // A leader's list is read again when the user or the leader deal with each other there.
  const versions = nodes
    .filter((node) => enabled?.includes(node.leader.id))
    .map((node) => `${node.leader.id}@${sessionInteractionAt(node.leader)}`)
    .join(",");
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick((value) => value + 1), 60_000);
    return () => clearInterval(timer);
  }, [active]);
  const leadersKey = active ? leaderIds.join(",") : "";
  useEffect(() => {
    if (!leadersKey) return;
    let cancelled = false;
    topicApi
      .list("all")
      .then((all) => {
        if (cancelled) return;
        const on = all.leaders.filter((leader) => leader.enabled).map((leader) => leader.sessionId);
        setEnabled(leadersKey.split(",").filter((id) => on.includes(id)));
      })
      .catch((error: Error) => console.warn("[topics-mode] Could not load the leaders' topics:", error.message));
    return () => {
      cancelled = true;
    };
  }, [leadersKey, tick]);
  useEffect(() => {
    if (!versions || !active) return;
    let cancelled = false;
    for (const entry of versions.split(",")) {
      const leaderId = entry.split("@")[0]!;
      Promise.all([topicApi.list("", leaderId), topicApi.threads(leaderId)])
        .then(([list, threads]) => {
          if (!cancelled)
            setLoaded((previous) => ({ ...previous, [leaderId]: { topics: list.topics, threads: threads.threads } }));
        })
        .catch((error: Error) => console.warn("[topics-mode] Could not load a leader's topics:", error.message));
    }
    return () => {
      cancelled = true;
    };
  }, [versions, tick, active]);
  return useMemo(() => {
    const places = nodes.flatMap((node) => {
      const own = loaded[node.leader.id];
      // A leader with nothing to list keeps its card among the other sessions.
      if (!enabled?.includes(node.leader.id) || !own || (own.topics.length === 0 && own.threads.length === 0))
        return [];
      return [{ node, ...own }];
    });
    const listed = new Set(places.map((place) => place.node.leader.id));
    return { places, others: nodes.filter((node) => !listed.has(node.leader.id)) };
  }, [nodes, loaded, enabled]);
}

/** The thread on screen, as the route says. */
function useRouteThread(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return normalizeThreadKey(threadRouteFromHash(hash).threadKey ?? "main");
}

function threadOfItem(item: NextAttentionItem): string {
  return normalizeThreadKey((item.kind === "needs-input" ? questOf(item.entry) : null) ?? item.threadKey ?? "");
}

/**
 * Counts in the panel's usual dots: questions waiting on the user (amber), new answers and finished
 * quests (blue), quests running (green). They come from the top bar's attention list and from the
 * running quests each leader's synced tab state carries, so every leader has them, not only the one open.
 */
function useCounts(): { ofPlace: (place: TopicPlace) => Counts; ofLeader: (leaderId: string) => Counts } {
  const { queue } = useNextAttention();
  const projections = useStore((state) => state.syncedProjectionValues);
  const projectionKeys = useStore((state) => state.syncedProjectionKeys);
  const runningOf = (leaderId: string) =>
    resolveLeaderThreadTabsProjection(
      { syncedProjectionValues: projections, syncedProjectionKeys: projectionKeys },
      leaderId,
    ).value?.runningQuestIds ?? [];
  const count = (leaderId: string, inPlace: (threadKey: string) => boolean, anyAsker: boolean): Counts => {
    let permission = 0;
    let unread = 0;
    for (const item of queue) {
      if (!inPlace(threadOfItem(item))) continue;
      // A quest's question can come from its worker; everything else is the leader's own.
      if (item.kind === "needs-input" && (anyAsker || item.sessionId === leaderId)) permission += 1;
      else if (item.kind !== "needs-input" && item.sessionId === leaderId) unread += 1;
    }
    return { running: runningOf(leaderId).filter(inPlace).length, permission, unread };
  };
  return {
    ofPlace: (place) =>
      count(
        place.leader.leader.id,
        (key) =>
          place.topic
            ? place.topic.questIds.includes(key) || isKeyOfTopic(key, place.topic.id)
            : key === place.threadKey,
        true,
      ),
    ofLeader: (leaderId) => count(leaderId, () => true, false),
  };
}

export function SidebarTopicsMode({
  data: { places, others },
  currentSessionId,
  onOpen,
  otherSessions,
}: {
  data: TopicsModeData;
  currentSessionId: string | null;
  /** Opens a place of a leader (closing the panel on phones, as opening a session does). */
  onOpen: (leaderId: string, threadKey: string) => void;
  /** Today's cards for the sessions that are not leaders with topics (and the archive). */
  otherSessions: (nodes: RecentSessionNode[]) => ReactNode;
}) {
  const rows = useMemo(() => topicPlaces(places), [places]);
  const routeThread = useRouteThread();
  const counts = useCounts();
  // A quest of a topic is in that topic's place, as the breadcrumb shows it.
  const isCurrent = (place: TopicPlace) =>
    place.leader.leader.id === currentSessionId &&
    (routeThread === place.threadKey || !!place.topic?.questIds.includes(routeThread));
  return (
    <StackedPanes
      stackId="sidebar-topics"
      panes={[
        {
          id: "topics",
          title: "Topics",
          defaultWeight: 3,
          children: (
            <div className="space-y-0.5" data-testid="topics-mode-topics">
              {rows.map((place) => (
                <PlaceRow
                  key={place.key}
                  place={place}
                  current={isCurrent(place)}
                  counts={counts.ofPlace(place)}
                  onOpen={() => onOpen(place.leader.leader.id, place.threadKey)}
                />
              ))}
            </div>
          ),
        },
        {
          id: "leaders",
          title: "Leaders",
          defaultWeight: 1,
          children: (
            <div className="space-y-0.5" data-testid="topics-mode-leaders">
              {places.map(({ node }) => (
                <LeaderRow
                  key={node.leader.id}
                  node={node}
                  current={node.leader.id === currentSessionId && routeThread === "main"}
                  counts={counts.ofLeader(node.leader.id)}
                  onOpen={() => onOpen(node.leader.id, "main")}
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

function PlaceRow({
  place,
  current,
  counts,
  onOpen,
}: {
  place: TopicPlace;
  current: boolean;
  counts: Counts;
  onOpen: () => void;
}) {
  const leader = place.leader.leader;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full rounded-lg px-2 py-1.5 text-left transition-colors cursor-pointer ${
        current ? "bg-cc-active" : "hover:bg-cc-hover"
      }`}
      aria-current={current ? "page" : undefined}
      data-testid="topics-mode-row"
    >
      <div className="flex min-w-0 items-center gap-1.5">
        {place.kind === "thread" ? (
          <NewThreadIcon className="h-3.5 w-3.5 shrink-0 text-cc-primary" />
        ) : (
          <TopicIcon className="h-3.5 w-3.5 shrink-0 text-cc-primary" />
        )}
        <span className="min-w-0 flex-1 truncate text-[13px] text-cc-fg">{place.name}</span>
        <StatusCountDots counts={counts} />
      </div>
      <div className="mt-0.5 flex min-w-0 items-center gap-1.5 pl-5 text-[11px] text-cc-muted">
        {/* The leader as its picture, named on hover; the top bar names it once the place is open. */}
        {leader.leaderProfilePortrait && (
          <span title={leader.name ?? "Leader"} className="flex shrink-0">
            <LeaderProfilePortraitImage portrait={leader.leaderProfilePortrait} size="sm" />
          </span>
        )}
        {place.line && <span className="min-w-0 truncate">{place.line}</span>}
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
  counts: Counts;
  onOpen: () => void;
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
      title={`${leader.name ?? "Leader"}: Main`}
      data-testid="topics-mode-leader"
    >
      {leader.leaderProfilePortrait && <LeaderProfilePortraitImage portrait={leader.leaderProfilePortrait} size="lg" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-cc-fg">{leader.name ?? "Leader"}</span>
        <span className="block truncate text-[11px] text-cc-muted">
          Main · {node.spaceName}
          {leader.sessionNum != null ? ` · #${leader.sessionNum}` : ""}
        </span>
      </span>
      <StatusCountDots counts={counts} />
    </button>
  );
}

/** In Topics mode, New starts a side chat with a leader that has topics, or a session as before. */
export function TopicsModeNewButton({
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
        aria-label="New side chat or session"
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
            <div className="px-2.5 pt-0.5 pb-1 text-[10px] font-medium text-cc-muted">New side chat with</div>
          )}
          {leaders.map((node) => (
            <button
              key={node.leader.id}
              role="menuitem"
              type="button"
              className={item}
              onClick={() => {
                popover.close();
                navigateToSessionThread(node.leader.id, "main");
                openInSide(node.leader.id, { kind: "new-chat", startedFrom: null });
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
