import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ThreadSummary, TopicSummary } from "../../../shared/library-topics.js";
import { topicViewKey } from "../../../shared/topic-thread-key.js";
import { topicApi } from "../../api/topics.js";
import { LONG_PRESS_TARGET_CLASS, useLongPress } from "../../hooks/useLongPress.js";
import { useStore } from "../../store.js";
import type { RecentSessionNode } from "../../utils/recent-sessions.js";
import { sessionInteractionAt } from "../../utils/recent-sessions.js";
import { navigateToSessionThread, threadRouteFromHash } from "../../utils/routing.js";
import { openInSide } from "../../utils/side-column.js";
import { normalizeThreadKey } from "../../utils/thread-projection.js";
import { withoutQuestThreads } from "../../utils/leader-topics.js";
import type { TreeViewGroupData } from "../../utils/tree-grouping.js";
import { TOUCH_MENU_ITEM_CLASS } from "../ContextMenu.js";
import { LeaderProfilePortraitImage } from "../LeaderProfilePortraitButton.js";
import { NewThreadIcon, TopicIcon } from "../library/library-icons.js";
import { topicRowLine } from "../library/topic-search.js";
import { listedSpaces, useAnchoredPopover } from "../RecentSessionList.js";
import { StatusCountDots } from "../SessionItem.js";
import { StackedPanes } from "../StackedPanes.js";
import { countsOf, PinIcon, TopicPlaceCard, usePlaceWork } from "./TopicPlaceCard.js";

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

type Counts = ReturnType<typeof countsOf>;

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

/**
 * Pinned topics first, in the order they were pinned, then the rest as they were (newest
 * interaction first). Jiayi: pin the topics that matter most so they stay at the top.
 */
export function withPinnedFirst(rows: readonly TopicPlace[], pinnedIds: readonly string[]): TopicPlace[] {
  const rank = (place: TopicPlace) => (place.topic ? pinnedIds.indexOf(place.topic.id) : -1);
  const pinned = rows.filter((place) => rank(place) >= 0).sort((a, b) => rank(a) - rank(b));
  return [...pinned, ...rows.filter((place) => rank(place) < 0)];
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
            setLoaded((previous) => ({
              ...previous,
              [leaderId]: { topics: list.topics, threads: withoutQuestThreads(threads.threads) },
            }));
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

export function SidebarTopicsMode({
  data: { places, others },
  currentSessionId,
  onOpen,
  onOpened,
  otherSessions,
}: {
  data: TopicsModeData;
  currentSessionId: string | null;
  /** Opens a place of a leader (closing the panel on phones, as opening a session does). */
  onOpen: (leaderId: string, threadKey: string) => void;
  /** Called after a topic's card opened a question or result itself (closes the panel on phones). */
  onOpened: () => void;
  /** Today's cards for the sessions that are not leaders with topics (and the archive). */
  otherSessions: (nodes: RecentSessionNode[]) => ReactNode;
}) {
  const pinnedIds = useStore((state) => state.sidebarPinnedTopics);
  const setTopicPinned = useStore((state) => state.setTopicPinned);
  const rows = useMemo(() => withPinnedFirst(topicPlaces(places), pinnedIds), [places, pinnedIds]);
  const routeThread = useRouteThread();
  const work = usePlaceWork();
  const card = usePlaceCard();
  const cardPlace = card.state ? rows.find((place) => place.key === card.state!.key) : undefined;
  // A quest of a topic is in that topic's place, as the breadcrumb shows it.
  const isCurrent = (place: TopicPlace) =>
    place.leader.leader.id === currentSessionId &&
    (routeThread === place.threadKey || !!place.topic?.questIds.includes(routeThread));
  return (
    <>
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
                    pinned={!!place.topic && pinnedIds.includes(place.topic.id)}
                    counts={countsOf(work.ofPlace(place))}
                    onOpen={() => {
                      card.close();
                      onOpen(place.leader.leader.id, place.threadKey);
                    }}
                    onShowCard={(rect, held) => card.show(place.key, rect, held)}
                    onHideCard={card.leave}
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
                    counts={countsOf(work.ofLeader(node.leader.id))}
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
      {card.state && cardPlace && (
        <TopicPlaceCard
          place={cardPlace}
          work={work.ofPlace(cardPlace)}
          anchorRect={card.state.rect}
          held={card.state.held}
          topicPinned={!!cardPlace.topic && pinnedIds.includes(cardPlace.topic.id)}
          onTogglePin={
            cardPlace.topic
              ? () => setTopicPinned(cardPlace.topic!.id, !pinnedIds.includes(cardPlace.topic!.id))
              : undefined
          }
          onOpenItem={(item) => {
            card.close();
            work.open(item);
            onOpened();
          }}
          onOpenQuest={(questId) => {
            card.close();
            onOpen(cardPlace.leader.leader.id, questId);
          }}
          onClose={card.close}
          onMouseEnter={card.keep}
          onMouseLeave={card.leave}
        />
      )}
    </>
  );
}

/**
 * Which topic row's card is open, and where. A mouse hovering a row opens it, and it stays while the
 * mouse moves onto it; a long-press or right-click pins it until a press outside.
 */
function usePlaceCard() {
  const [state, setState] = useState<{ key: string; rect: DOMRect; held: boolean } | null>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const keep = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  };
  useEffect(() => keep, []);
  return {
    state,
    show: (key: string, rect: DOMRect, held: boolean) => {
      keep();
      // A held card is not replaced by hovering another row on the way to it.
      setState((current) => (current?.held && !held ? current : { key, rect, held }));
    },
    keep,
    leave: () => {
      keep();
      leaveTimer.current = setTimeout(() => setState((current) => (current?.held ? current : null)), 100);
    },
    close: () => {
      keep();
      setState(null);
    },
  };
}

function PlaceRow({
  place,
  current,
  pinned,
  counts,
  onOpen,
  onShowCard,
  onHideCard,
}: {
  place: TopicPlace;
  current: boolean;
  /** Pinned to the top of the list: a small pin before the counts says so. */
  pinned: boolean;
  counts: Counts;
  onOpen: () => void;
  /** Shows the row's card: on hover with a mouse, held open after a long-press or right-click. */
  onShowCard: (rect: DOMRect, held: boolean) => void;
  onHideCard: () => void;
}) {
  const leader = place.leader.leader;
  const rowRef = useRef<HTMLButtonElement>(null);
  const showCard = (held: boolean) => {
    if (rowRef.current) onShowCard(rowRef.current.getBoundingClientRect(), held);
  };
  const longPress = useLongPress(() => showCard(true));
  return (
    <button
      ref={rowRef}
      type="button"
      onClick={onOpen}
      {...longPress.handlers}
      // Only a real mouse hovers: a tap's emulated hover must not open the card over the topic it opens.
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse" && !longPress.isSuppressingMouse()) showCard(false);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse") onHideCard();
      }}
      style={longPress.pressStyle}
      className={`w-full rounded-lg px-2 py-1.5 text-left transition-colors cursor-pointer ${LONG_PRESS_TARGET_CLASS} ${
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
        {pinned && (
          <span title="Pinned" className="flex shrink-0 text-cc-muted" data-testid="topics-mode-pinned">
            <PinIcon className="h-3 w-3" />
          </span>
        )}
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
