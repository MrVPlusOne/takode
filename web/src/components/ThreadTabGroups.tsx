/**
 * Phone thread tabs as status groups: the bar names only the current tab and shows one
 * chip per kind of tab the user scans for (prompts waiting, unread results, quests in
 * progress, finished), with a Topics group after Main when the leader has topics on. A chip
 * lists its tabs. Finding a tab or a message is Search everything's Tabs and Messages modes.
 */
import type { TopicSummary } from "../../shared/library-topics.js";
import { NewThreadIcon, TopicIcon } from "./library/library-icons.js";
import { ThreadsList, type ThreadsMenu } from "./ThreadsMenu.js";
import { TopicTabList } from "./TopicTabList.js";
import { isKeyOfTopic, isTopicViewKey, topicViewKey } from "../../shared/topic-thread-key.js";
import { matchesSearch, NoTopicMatches, searchTopics, TopicSearchBox } from "./library/topic-search.js";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { threadStatusKey, type LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import type { ThreadMonitoringProjectionValue } from "../../shared/thread-monitoring.js";
import { LONG_PRESS_TARGET_CLASS, useLongPress, type OpenContextMenu } from "../hooks/useLongPress.js";
import { ALL_THREADS_KEY, MAIN_THREAD_KEY, normalizeThreadKey } from "../utils/thread-projection.js";
import { timeAgo } from "../utils/quest-helpers.js";
import { BellIcon } from "./AttentionKind.js";
import { NotifyMeIcon } from "./NotifyMe.js";
import { SessionRoleIcon } from "./SessionRoleLabel.js";
import type { PrimaryThreadChip } from "./WorkBoardThreadTabs.js";
import { useGroupMoveAnimation } from "./thread-tab-group-move.js";
import { SideQuestIcon } from "./SideQuestCue.js";
import { ClockIcon, formatSnoozeUntil } from "./RemindLaterChoices.js";
import type { SessionNotification } from "../types.js";
import { createPortal } from "react-dom";
import { WorkBoardDotsIcon, WorkBoardIcon } from "./leader-workboard-controls.js";
import type { BoardPhaseDot } from "./leader-board-summary.js";

export type ThreadTabGroupId = "needs-input" | "new-results" | "in-progress" | "done";

/** Left to right as stages of the work: waiting on the user, ongoing, finished but unread, done. */
/** Wide screens (the desktop shell) label each group and anchor its list under its tab. */
const WIDE_LAYOUT_QUERY = "(min-width: 768px)";
const WIDE_LIST_WIDTH_PX = 448;

export const THREAD_TAB_GROUP_ORDER: readonly ThreadTabGroupId[] = [
  "needs-input",
  "in-progress",
  "new-results",
  "done",
];

const GROUP_LABEL: Record<ThreadTabGroupId, string> = {
  "needs-input": "Needs you",
  "new-results": "New results",
  "in-progress": "In progress",
  done: "Done",
};

/**
 * Splits quest tabs by what the user looks for. A prompt outranks an unread result; without
 * either, a tab is in progress until its quest is finished. Main is never a member: it is
 * always its own tab with its own bell, so counting it again in a group duplicated it.
 * Within a group, the tab that entered it or was chatted in most recently (the server's
 * `groupChangedAt`) comes first, and ties keep the leader's tab order.
 */
export function groupThreadTabs(tabs: readonly PrimaryThreadChip[]): Record<ThreadTabGroupId, PrimaryThreadChip[]> {
  const groups: Record<ThreadTabGroupId, PrimaryThreadChip[]> = {
    "needs-input": [],
    "new-results": [],
    "in-progress": [],
    done: [],
  };
  for (const tab of tabs) {
    if (tab.needsInput) groups["needs-input"].push(tab);
    else if (tab.blueNudge) groups["new-results"].push(tab);
    else if (tab.completed) groups.done.push(tab);
    else groups["in-progress"].push(tab);
  }
  for (const group of Object.values(groups)) {
    group.sort((left, right) => (right.groupChangedAt ?? 0) - (left.groupChangedAt ?? 0));
  }
  return groups;
}

/**
 * The tab on screen shows its result as read. The browser marks a result in the open tab
 * read as soon as it arrives, but the server confirms that a round trip later; filing the
 * tab under New results meanwhile flashed it through that group, for example on its way
 * from In progress to Done when its quest finishes while the user watches.
 */
function readOnScreen(tab: PrimaryThreadChip, currentKey: string): PrimaryThreadChip {
  return tab.blueNudge && normalizeThreadKey(tab.threadKey) === currentKey ? { ...tab, blueNudge: false } : tab;
}

/**
 * The tab to open after closing `threadKey`: the next tab in the same status group as the
 * bar lists it (the one below, or above when it was last), so closing a finished tab in Done
 * moves on to the next finished one instead of jumping into other work. When the group
 * empties, Main, which also holds the board. Uses the bar's grouping and order exactly.
 */
export function threadKeyToSelectAfterClosing(
  threadKey: string,
  tabs: readonly PrimaryThreadChip[],
  currentThreadKey: string,
  /** The topic-first bar's order of quest tabs (`topicFirstTabOrder`), for leaders with topics on. */
  topicFirstOrder?: readonly string[] | null,
): string {
  const closing = normalizeThreadKey(threadKey);
  if (topicFirstOrder) {
    const order = topicFirstOrder.filter((key) => tabs.some((tab) => normalizeThreadKey(tab.threadKey) === key));
    const index = order.indexOf(closing);
    if (index < 0) return MAIN_THREAD_KEY;
    return order[index + 1] ?? order[index - 1] ?? MAIN_THREAD_KEY;
  }
  const currentKey = normalizeThreadKey(currentThreadKey);
  const groups = groupThreadTabs(tabs.map((tab) => readOnScreen(tab, currentKey)));
  for (const group of Object.values(groups)) {
    const index = group.findIndex((tab) => normalizeThreadKey(tab.threadKey) === closing);
    if (index < 0) continue;
    const next = group[index + 1] ?? group[index - 1];
    return next ? normalizeThreadKey(next.threadKey) : MAIN_THREAD_KEY;
  }
  return MAIN_THREAD_KEY;
}

function isMain(tab: PrimaryThreadChip): boolean {
  return normalizeThreadKey(tab.threadKey) === MAIN_THREAD_KEY;
}

function tabDotColor(tab: PrimaryThreadChip): string {
  if (isMain(tab)) return "var(--color-cc-fg)";
  return tab.accentColor ?? tab.titleColor ?? "var(--color-cc-muted)";
}

interface RowContext {
  currentThreadKey: string;
  activeOutputThreadKey: string | null;
  monitors?: ThreadMonitoringProjectionValue["threads"];
  threadStatuses?: Readonly<Record<string, LeaderThreadStatus>>;
  onSelect: (threadKey: string) => void;
  onClose?: (threadKey: string) => void;
  onOpenMenu?: (tab: PrimaryThreadChip) => OpenContextMenu | undefined;
}

export interface ThreadTabGroupBarProps extends RowContext {
  main?: PrimaryThreadChip;
  tabs: readonly PrimaryThreadChip[];
  /** Where the bar sits; group lists open away from the screen edge. */
  placement?: "top" | "bottom";
  /**
   * For a leader with Library topics on: the Topics group, right after Main, listing its topics by
   * recent activity. It is selected while a topic conversation is on screen.
   */
  topicsGroup?: {
    topics: TopicSummary[];
    currentTopicId: string | null;
    onOpen: (topic: TopicSummary) => void;
    /** The topic of each quest tab, by quest ID; a quest with none is listed as not in a topic yet. */
    topicOfQuest: Readonly<Record<string, string>>;
    /**
     * The unread results in these threads (a topic's own thread and its quests), counted as the
     * attention list counts them, when the leader's notifications are known.
     */
    unreadOf?: (threadKeys: readonly string[]) => UnreadResultCount;
  };
  /** Shown in the row right after the tabs, outside the tab list (the desktop Next chip). */
  trailing?: ReactNode;
  /**
   * Topic-first leaders: the Threads menu (New thread, then active and recent threads), next to
   * Topics. Threads are not quests: Working on keeps only the quests in motion.
   */
  threadsMenu?: ThreadsMenu;
  /**
   * Desktop leaders with topics on: the bar lives in the top bar instead of a tab row. Main | All,
   * Topics, Threads and the Next chip (`trailing`) sit where the bar is drawn; the Working on menu,
   * which holds the work board, goes to `inTopBar.helpers`. Topics, Threads and Working on carry no
   * attention bell: the Next chip and the attention count carry questions and unread results, and
   * their lists mark each one.
   */
  inTopBar?: {
    helpers: HTMLElement | null;
    board: { open: boolean; dots: readonly BoardPhaseDot[]; onToggle: () => void };
  };
}

/**
 * The phone tab bar: Main, one item per non-empty group, and search. The quest strip
 * below already names the current quest, so the bar only marks which group holds it.
 */
export function ThreadTabGroupBar({
  main,
  tabs,
  placement = "top",
  topicsGroup,
  trailing,
  inTopBar,
  threadsMenu,
  ...rows
}: ThreadTabGroupBarProps) {
  const [openGroup, setOpenGroup] = useState<ThreadTabGroupId | "topics" | "working-on" | "threads" | null>(null);
  // The input of the latest press on the bar: a click on an open group differs by mouse and finger.
  const lastPressRef = useRef<string>("mouse");
  const mainTab = main ?? {
    threadKey: MAIN_THREAD_KEY,
    title: "Main Thread",
    needsInput: false,
    mutedNeedsInput: false,
    blueNudge: false,
    canClose: false,
    updatedAt: 0,
  };
  const currentKey = normalizeThreadKey(rows.currentThreadKey);
  const groups = groupThreadTabs(tabs.map((tab) => readOnScreen(tab, currentKey)));
  // The All view sits under the Main strip too, so Main is the selected tab there.
  const onMain = currentKey === MAIN_THREAD_KEY || currentKey === ALL_THREADS_KEY;
  // With topics on, the bar is topic-first: Main, Working on and Topics, which holds every quest tab.
  const topicFirst = topicsGroup;
  // Tabs made earlier for a question asked in a topic conversation or user thread stay out: those
  // live in the Topics and Threads menus.
  const questTabs = tabs
    .map((tab) => readOnScreen(tab, currentKey))
    .filter((tab) => !isMain(tab) && !isTopicViewKey(tab.threadKey));
  const workingOn = topicFirst ? workingOnTabs(questTabs) : [];
  const inWorkingOn = workingOn.some((tab) => normalizeThreadKey(tab.threadKey) === currentKey);
  // A thread (New thread) on screen, or the New thread page: the Threads tab is the selected one.
  const onThreads =
    !!threadsMenu && (threadsMenu.starting || threadsMenu.threads.some((thread) => thread.key === currentKey));
  // Topic-first: every quest tab lives under Topics (or Working on while it is listed there).
  const onTopic = !onMain && !onThreads && (!!topicsGroup?.currentTopicId || (!!topicFirst && !inWorkingOn));
  // Which bar tab spins: only one, and none for writing already on screen (the feed's "Active
  // here" chip shows it). The writing is on screen in its own thread, in the All view, and in a
  // topic conversation holding its quest.
  const writingKey = rows.activeOutputThreadKey ? normalizeThreadKey(rows.activeOutputThreadKey) : null;
  const writingOnScreen =
    !!writingKey &&
    (writingKey === currentKey ||
      currentKey === ALL_THREADS_KEY ||
      (!!topicsGroup?.currentTopicId &&
        (topicsGroup.topicOfQuest[writingKey] === topicsGroup.currentTopicId ||
          isKeyOfTopic(writingKey, topicsGroup.currentTopicId))));
  const spinningTab: "main" | "working-on" | "topics" | "threads" | ThreadTabGroupId | null =
    !writingKey || writingOnScreen
      ? null
      : writingKey === MAIN_THREAD_KEY
        ? "main"
        : topicFirst
          ? workingOn.some((tab) => normalizeThreadKey(tab.threadKey) === writingKey)
            ? "working-on"
            : threadsMenu?.threads.some((thread) => thread.key === writingKey)
              ? "threads"
              : "topics"
          : (THREAD_TAB_GROUP_ORDER.find((id) =>
              groups[id].some((tab) => normalizeThreadKey(tab.threadKey) === writingKey),
            ) ?? null);
  const currentGroup =
    onMain || onTopic || topicFirst
      ? null
      : (THREAD_TAB_GROUP_ORDER.find((id) =>
          groups[id].some((tab) => normalizeThreadKey(tab.threadKey) === currentKey),
        ) ?? null);
  const barRef = useRef<HTMLDivElement | null>(null);
  useGroupMoveAnimation(barRef, currentKey, currentGroup, groups);
  const select = (threadKey: string) => {
    setOpenGroup(null);
    rows.onSelect(threadKey);
  };
  const rowContext = { ...rows, onSelect: select };
  const threadsList = threadsMenu && (
    <ThreadsList
      menu={{
        ...threadsMenu,
        onStart: () => {
          setOpenGroup(null);
          threadsMenu.onStart();
        },
        onOpen: select,
      }}
      currentKey={currentKey}
      writingKey={writingKey}
    />
  );
  const topicsList = (group: NonNullable<ThreadTabGroupBarProps["topicsGroup"]>) => (
    <TopicsGroupList
      topicsGroup={group}
      topicFirst={!!topicFirst}
      currentTopicId={onTopic ? group.currentTopicId : null}
      questTabs={questTabs}
      rowContext={rowContext}
      onLeave={() => setOpenGroup(null)}
    />
  );
  const [listLeft, setListLeft] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listMaxHeight = useHeightAboveKeyboard(listRef, !!openGroup && placement === "top");

  // On wide screens a group's list opens under its own tab instead of spanning the bar.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!openGroup || !bar || !window.matchMedia(WIDE_LAYOUT_QUERY).matches) {
      setListLeft(null);
      return;
    }
    const tab = bar.querySelector<HTMLElement>(`[role="tab"][data-group="${openGroup}"]`);
    setListLeft(Math.max(0, Math.min(tab?.offsetLeft ?? 0, bar.clientWidth - WIDE_LIST_WIDTH_PX)));
  }, [openGroup]);

  useEffect(() => {
    if (!openGroup) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenGroup(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [openGroup]);

  // The selected tab takes the color of the strip it labels: Main's strip is a card,
  // a quest's strip sits on the page background.
  const selectedSurface = onMain ? "bg-cc-card" : "bg-cc-bg";
  const item = (key: string, props: Omit<BarItemProps, "placement" | "selectedSurface">) => (
    <BarItem key={key} placement={placement} selectedSurface={selectedSurface} {...props} />
  );
  // The Topics group, right after Main.
  const topicsItem = () =>
    topicsGroup &&
    item("topics", {
      label: "Topics",
      selected: onTopic,
      open: openGroup === "topics",
      group: "topics",
      count: topicsGroup.topics.length,
      activeOutput: spinningTab === "topics",
      testId: "thread-tab-group-topics",
      onClick: () => setOpenGroup((open) => (open === "topics" ? null : "topics")),
      children: (
        <>
          <TopicIcon className="h-3.5 w-3.5 shrink-0" />
          {/* With two or three tabs in the bar, phones have room to name it too. */}
          <span className={topicFirst ? "" : "hidden md:inline"}>Topics</span>
        </>
      ),
    });
  const workingOnItem = () =>
    item("working-on", {
      label: `Working on: ${workingOn.length}`,
      selected: !onMain && inWorkingOn && !topicsGroup?.currentTopicId && !onThreads,
      open: openGroup === "working-on",
      group: "working-on",
      count: workingOn.length,
      activeOutput: spinningTab === "working-on",
      testId: "thread-tab-group-working-on",
      onClick: () => setOpenGroup((open) => (open === "working-on" ? null : "working-on")),
      children: (
        <>
          <PhaseDots tabs={workingOn} />
          <span>Working on {workingOn.length}</span>
        </>
      ),
    });
  if (inTopBar) {
    const workingOnList = (
      <>
        <ListHeading label="Working on" count={workingOn.length}>
          <button
            type="button"
            onClick={() => {
              setOpenGroup(null);
              inTopBar.board.onToggle();
            }}
            className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md border border-cc-border bg-cc-hover/40 px-2 text-[12px] normal-case tracking-normal text-cc-fg hover:bg-cc-hover"
            data-testid="thread-top-bar-board-button"
          >
            <WorkBoardIcon className="h-3.5 w-3.5 text-cc-info" />
            {inTopBar.board.open ? "Close board" : "Full board"}
          </button>
        </ListHeading>
        {workingOn.length === 0 && <div className="px-4 py-3 text-[12px] text-cc-muted">Nothing in progress</div>}
        {workingOn.map((tab) => (
          <ThreadTabListRow key={tab.threadKey} tab={tab} context={rowContext} />
        ))}
      </>
    );
    const list = (side: "left" | "right", body: ReactNode) => (
      <>
        <div
          className="fixed inset-0 z-40"
          onClick={() => setOpenGroup(null)}
          data-testid="thread-tab-group-backdrop"
        />
        <div
          className={`absolute top-full z-50 mt-2 max-h-[60dvh] overflow-y-auto rounded-xl border border-cc-border bg-cc-card py-1 shadow-xl ${side === "left" ? "left-0" : "right-0"}`}
          style={{ width: WIDE_LIST_WIDTH_PX }}
          role="menu"
          data-testid="thread-tab-group-list"
          data-group={openGroup ?? ""}
        >
          {body}
        </div>
      </>
    );
    const toggleList = (group: "topics" | "working-on" | "threads") =>
      setOpenGroup((open) => (open === group ? null : group));
    const onAll = currentKey === ALL_THREADS_KEY;
    return (
      <>
        <div ref={barRef} className="relative flex shrink-0 items-center gap-1.5" data-testid="thread-tab-group-bar">
          <div
            className="inline-flex h-7 shrink-0 items-center rounded-lg border border-cc-border bg-cc-hover/40 p-0.5"
            role="group"
            aria-label="Main thread"
          >
            <TopBarSegment
              selected={onMain && !onAll && !onThreads}
              onClick={() => select(MAIN_THREAD_KEY)}
              label="Main Thread"
              testId="thread-tab-group-main"
            >
              {spinningTab === "main" && <ActiveOutputSpinner />}
              Main
              <AttentionBell tab={mainTab} />
            </TopBarSegment>
            <TopBarSegment
              selected={onAll && !onThreads}
              onClick={() => select(ALL_THREADS_KEY)}
              label="All threads"
              testId="thread-tab-group-all"
            >
              All
            </TopBarSegment>
          </div>
          {topicsGroup && (
            <TopBarButton
              label="Topics"
              open={openGroup === "topics"}
              onClick={() => toggleList("topics")}
              testId="thread-tab-group-topics"
              group="topics"
            >
              {spinningTab === "topics" && <ActiveOutputSpinner />}
              <TopicIcon className="h-3.5 w-3.5 shrink-0" />
              Topics
              <ListChevron />
            </TopBarButton>
          )}
          {openGroup === "topics" && topicsGroup && list("left", topicsList(topicsGroup))}
          {threadsMenu && (
            <TopBarButton
              label="Threads"
              open={openGroup === "threads"}
              pressed={onThreads}
              onClick={() => toggleList("threads")}
              testId="thread-tab-group-threads"
              group="threads"
            >
              {spinningTab === "threads" && <ActiveOutputSpinner />}
              <NewThreadIcon className="h-3.5 w-3.5 shrink-0" />
              Threads
              <ListChevron />
            </TopBarButton>
          )}
          {openGroup === "threads" && threadsList && list("left", threadsList)}
          {/* This conversation's Next chip, right after Topics and Threads: where to go next, beside where things are. */}
          {trailing}
        </div>
        {inTopBar.helpers &&
          createPortal(
            <div className="relative flex items-center gap-2" data-testid="thread-top-bar-helpers">
              <TopBarButton
                label={`Working on: ${workingOn.length}`}
                open={openGroup === "working-on"}
                pressed={inTopBar.board.open}
                onClick={() => toggleList("working-on")}
                testId="thread-tab-group-working-on"
                group="working-on"
              >
                {spinningTab === "working-on" && <ActiveOutputSpinner />}
                <WorkBoardDotsIcon dots={inTopBar.board.dots} large={false} />
                <span className="tabular-nums">Working on {workingOn.length}</span>
                <ListChevron />
              </TopBarButton>
              {openGroup === "working-on" && list("right", workingOnList)}
            </div>,
            inTopBar.helpers,
          )}
      </>
    );
  }
  return (
    <div
      ref={barRef}
      className="relative"
      data-testid="thread-tab-group-bar"
      data-placement={placement}
      onPointerDownCapture={(event) => {
        lastPressRef.current = event.pointerType;
      }}
      onKeyDownCapture={() => {
        lastPressRef.current = "keyboard";
      }}
    >
      <div className={trailing ? "flex items-center gap-2" : "contents"}>
        <div
          className={`flex gap-1 ${placement === "bottom" ? "items-start pb-0.5" : "items-end pt-0.5"} ${trailing ? "self-end" : ""}`}
          role="tablist"
        >
          {item("main", {
            label: "Main Thread",
            selected: onMain && !onThreads,
            activeOutput: spinningTab === "main",
            testId: "thread-tab-group-main",
            onClick: () => select(MAIN_THREAD_KEY),
            children: (
              <>
                <span>Main</span>
                <AttentionBell tab={mainTab} />
              </>
            ),
          })}
          {topicFirst && workingOn.length > 0 && workingOnItem()}
          {topicsGroup && (topicsGroup.topics.length > 0 || topicFirst) && topicsItem()}
          {threadsMenu &&
            item("threads", {
              label: "Threads",
              selected: onThreads,
              open: openGroup === "threads",
              group: "threads",
              compact: true,
              activeOutput: spinningTab === "threads",
              testId: "thread-tab-group-threads",
              onClick: () => setOpenGroup((open) => (open === "threads" ? null : "threads")),
              children: <NewThreadIcon className="h-4 w-4 shrink-0" />,
            })}
          {!topicFirst &&
            THREAD_TAB_GROUP_ORDER.map((id) =>
              groups[id].length > 0
                ? item(id, {
                    label: `${GROUP_LABEL[id]}: ${groups[id].length}`,
                    selected: currentGroup === id,
                    open: openGroup === id,
                    group: id,
                    count: groups[id].length,
                    activeOutput: spinningTab === id,
                    testId: "thread-tab-group-chip",
                    // A group of one opens its tab on a tap; its list (with the tab's latest
                    // result and menu) stays a long-press or right-click away. A larger group
                    // opens its list and leaves the tab on screen alone: stepping through items
                    // that need attention is the feed's Next chip's job. Clicking the group again
                    // with a mouse opens the list's first tab, saving the trip down to it; a second
                    // tap of a finger closes the list, undoing the first tap.
                    onClick: () => {
                      if (groups[id].length === 1 || (openGroup === id && !isTouchPress(lastPressRef.current))) {
                        select(groups[id][0]!.threadKey);
                        return;
                      }
                      setOpenGroup((open) => (open === id ? null : id));
                    },
                    onOpenList: () => setOpenGroup(id),
                    single: groups[id].length === 1,
                    children: <GroupContent id={id} tabs={groups[id]} />,
                  })
                : null,
            )}
        </div>
        {trailing}
      </div>
      {openGroup && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpenGroup(null)}
            data-testid="thread-tab-group-backdrop"
          />
          <div
            className={`absolute inset-x-0 z-50 max-h-[60dvh] overflow-y-auto rounded-xl border border-cc-border bg-cc-card py-1 shadow-xl ${
              placement === "bottom" ? "bottom-full mb-1" : "top-full mt-1"
            }`}
            ref={listRef}
            style={{
              ...(listLeft === null ? {} : { left: listLeft, right: "auto", width: WIDE_LIST_WIDTH_PX }),
              ...(listMaxHeight === null ? {} : { maxHeight: `min(60dvh, ${listMaxHeight}px)` }),
            }}
            role="menu"
            data-testid="thread-tab-group-list"
            data-group={openGroup}
          >
            {openGroup === "threads" ? (
              threadsList
            ) : openGroup === "working-on" ? (
              <>
                <ListHeading label="Working on" count={workingOn.length} />
                {workingOn.map((tab) => (
                  <ThreadTabListRow key={tab.threadKey} tab={tab} context={rowContext} />
                ))}
              </>
            ) : openGroup === "topics" ? (
              topicsGroup && topicsList(topicsGroup)
            ) : (
              <>
                <GroupHeading
                  id={openGroup as ThreadTabGroupId}
                  count={groups[openGroup as ThreadTabGroupId].length}
                  action={
                    openGroup === "done" && rows.onClose ? (
                      <CloseAllButton tabs={groups.done.filter((tab) => tab.canClose)} onClose={rows.onClose} />
                    ) : undefined
                  }
                />
                {groups[openGroup as ThreadTabGroupId].map((tab) => (
                  <ThreadTabListRow key={tab.threadKey} tab={tab} context={rowContext} />
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function isActiveOutput(tab: PrimaryThreadChip, activeOutputThreadKey: string | null): boolean {
  return !!activeOutputThreadKey && normalizeThreadKey(tab.threadKey) === normalizeThreadKey(activeOutputThreadKey);
}

/** The bell as today's tabs draw it: an outline in the attention color, nothing when quiet. */
function AttentionBell({ tab, size = "sm" }: { tab: PrimaryThreadChip; size?: "sm" | "md" }) {
  const tone = tab.needsInput
    ? "text-cc-attention"
    : tab.blueNudge
      ? "text-cc-info"
      : tab.mutedNeedsInput
        ? "text-cc-muted"
        : null;
  if (!tone) return null;
  return (
    <span
      className={`inline-flex shrink-0 ${tone}`}
      data-testid="thread-tab-bell"
      data-kind={tab.needsInput ? "needs-input" : tab.blueNudge ? "review" : "muted"}
    >
      <BellIcon className={size === "md" ? "h-3.5 w-3.5" : "h-3 w-3"} />
    </span>
  );
}

/**
 * Marks where the leader is writing right now: a small spinner, so it reads as activity
 * rather than as one more phase-color dot. It holds still when motion is reduced.
 */
function ActiveOutputSpinner() {
  return (
    <span
      role="img"
      aria-label="Leader working here"
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-cc-info/30 border-t-cc-info motion-safe:animate-spin"
      data-testid="thread-tab-active-output-spinner"
    />
  );
}

interface BarItemProps {
  placement: "top" | "bottom";
  selectedSurface: string;
  label: string;
  selected: boolean;
  open?: boolean;
  compact?: boolean;
  group?: ThreadTabGroupId | "topics" | "working-on" | "threads";
  /** How many tabs the group holds. */
  count?: number;
  activeOutput?: boolean;
  testId: string;
  onClick: () => void;
  /** Long-press or right-click on a group item opens its list. */
  onOpenList?: () => void;
  /** A group of one switches on tap instead of opening a list. */
  single?: boolean;
  children: ReactNode;
}

/**
 * One item of the bar, drawn as one of today's tabs. The selected item joins the quest
 * strip: tabs hang down from it at the top and up from it at the bottom.
 */
function BarItem({
  placement,
  selectedSurface,
  label,
  selected,
  open = false,
  compact = false,
  group,
  count,
  activeOutput,
  testId,
  onClick,
  onOpenList,
  single = false,
  children,
}: BarItemProps) {
  const longPress = useLongPress(onOpenList ? () => onOpenList() : undefined);
  // Phones share the width evenly; wide screens size each tab to its label.
  const size = compact ? "w-10 shrink-0 md:w-auto md:px-3" : "min-w-0 flex-1 md:min-w-[7.5rem] md:flex-none md:px-3";
  const edge = placement === "bottom" ? "rounded-b-md border-t-0" : "rounded-t-md border-b-0";
  const tone = selected
    ? `${placement === "bottom" ? "-mt-px" : "-mb-px"} border-cc-primary/45 ${selectedSurface} text-cc-fg`
    : open
      ? "border-cc-border bg-cc-hover/70 text-cc-fg"
      : "border-cc-border/70 bg-cc-hover/30 text-cc-muted";
  // An open group sits above its list's backdrop, so a second click reaches the tab itself.
  const layer = open ? "z-50" : selected ? "z-10" : "";
  return (
    <button
      type="button"
      role="tab"
      onClick={onClick}
      {...longPress.handlers}
      style={longPress.pressStyle}
      className={`relative ${layer} inline-flex items-center justify-center gap-1.5 px-1.5 text-[12px] font-normal tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-cc-primary/70 h-8 border ${size} ${edge} ${tone} ${onOpenList ? LONG_PRESS_TARGET_CLASS : ""}`}
      aria-label={label}
      aria-selected={selected}
      aria-expanded={group && !single ? open : undefined}
      aria-haspopup={group && !single ? "menu" : compact ? "dialog" : undefined}
      data-testid={testId}
      data-group={group}
      data-count={count}
      data-selected={selected ? "true" : "false"}
      data-active-output={activeOutput ? "true" : "false"}
    >
      {activeOutput && <ActiveOutputSpinner />}
      {children}
    </button>
  );
}

/** A top-bar button opening one of the bar's lists, shaped like the top bar's other buttons. */
function TopBarButton({
  label,
  open,
  pressed = false,
  onClick,
  testId,
  group,
  children,
}: {
  label: string;
  open: boolean;
  /** Shown pressed while what it opens is on screen (the work board for Working on). */
  pressed?: boolean;
  onClick: () => void;
  testId: string;
  group: "topics" | "working-on" | "threads";
  children: ReactNode;
}) {
  const tone =
    open || pressed
      ? "border-cc-primary/50 bg-cc-primary/12 text-cc-fg"
      : "border-cc-border bg-cc-hover/40 text-cc-fg hover:bg-cc-hover";
  return (
    <button
      type="button"
      onClick={onClick}
      // Above the open list's backdrop, so a second click closes the list.
      className={`relative ${open ? "z-50" : ""} inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-cc-primary/70 ${tone}`}
      aria-label={label}
      aria-expanded={open}
      aria-haspopup="menu"
      data-testid={testId}
      data-group={group}
    >
      {children}
    </button>
  );
}

/** Main or All in the top bar's Main | All switch. */
function TopBarSegment({
  selected,
  onClick,
  label,
  testId,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  testId: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-full items-center gap-1.5 rounded-md px-2 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-cc-primary/70 ${
        selected ? "bg-cc-primary/12 text-cc-fg" : "text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
      }`}
      aria-label={label}
      aria-pressed={selected}
      data-testid={testId}
      data-selected={selected ? "true" : "false"}
    >
      {children}
    </button>
  );
}

function ListChevron() {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 text-cc-muted" fill="none" aria-hidden="true">
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function isTouchPress(pointerType: string): boolean {
  return pointerType === "touch" || pointerType === "pen";
}

/** The group's name, shown before its count where the bar has room. */
function WideLabel({ id }: { id: ThreadTabGroupId }) {
  return <span className="hidden md:inline">{GROUP_LABEL[id]} </span>;
}

function GroupContent({ id, tabs }: { id: ThreadTabGroupId; tabs: readonly PrimaryThreadChip[] }) {
  if (id === "needs-input" || id === "new-results") {
    return (
      <>
        <BellIcon className={`h-3 w-3 shrink-0 ${id === "needs-input" ? "text-cc-attention" : "text-cc-info"}`} />
        <span className={id === "needs-input" ? "text-cc-attention" : "text-cc-info"}>
          <WideLabel id={id} />
          {tabs.length}
        </span>
      </>
    );
  }
  if (id === "done") {
    return (
      <>
        <svg
          viewBox="0 0 16 16"
          className="h-3 w-3 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
        >
          <path d="M3.5 8.5l3 3 6-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>
          <WideLabel id={id} />
          {tabs.length}
        </span>
      </>
    );
  }
  return (
    <>
      <PhaseDots tabs={tabs} />
      <span>
        <WideLabel id={id} />
        {tabs.length}
      </span>
    </>
  );
}

function GroupHeading({ id, count, action }: { id: ThreadTabGroupId; count: number; action?: ReactNode }) {
  const tone = id === "needs-input" ? "text-cc-attention" : id === "new-results" ? "text-cc-info" : "text-cc-muted";
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 bg-cc-card/95 px-4 pb-1 pt-2.5 backdrop-blur">
      <span className={`text-[11px] uppercase tracking-wide ${tone}`}>{GROUP_LABEL[id]}</span>
      <span className="text-[11px] tabular-nums text-cc-muted">{count}</span>
      {action}
    </div>
  );
}

/**
 * One tab in a group list or the switcher: its color, title, quest number and state, bell
 * and close. A closed tab reads muted, has no close or menu, and reopens when chosen.
 */
function ThreadTabListRow({
  tab,
  context,
  query = "",
  closed = false,
}: {
  tab: PrimaryThreadChip;
  context: RowContext;
  query?: string;
  closed?: boolean;
}) {
  const threadKey = normalizeThreadKey(tab.threadKey);
  const main = isMain(tab);
  const selected = threadKey === normalizeThreadKey(context.currentThreadKey);
  const openMenu = main || closed ? undefined : context.onOpenMenu?.(tab);
  const longPress = useLongPress(openMenu);
  const monitor = context.monitors?.[threadKey];
  const status = context.threadStatuses?.[threadStatusKey(threadKey)];
  const summary = status?.kind === "ready" ? status.summary : undefined;
  const activeAt = lastActivityAt(tab);
  const meta = main
    ? "Main thread"
    : [
        tab.questId ?? threadKey,
        tab.remindAt !== undefined ? `Remind ${formatSnoozeUntil(tab.remindAt)}` : null,
        tab.stateLabel ?? tab.detail,
        closed ? "Closed" : null,
        activeAt ? timeAgo(activeAt) : null,
      ]
        .filter(Boolean)
        .join(" · ");
  const quiet = closed || (tab.completed && !tab.needsInput && !tab.blueNudge);
  const style: CSSProperties = { ...longPress.pressStyle };
  return (
    <div
      className={`flex min-h-[3.25rem] items-center gap-3 px-4 py-1.5 ${selected ? "bg-cc-active" : "hover:bg-cc-hover/40"} ${openMenu ? LONG_PRESS_TARGET_CLASS : ""}`}
      style={style}
      {...longPress.handlers}
      data-testid="thread-tab-list-row"
      data-thread-key={threadKey}
      data-selected={selected ? "true" : "false"}
      data-title-color={main ? "" : (tab.titleColor ?? "")}
      data-ownership-note={tab.ownershipNote ?? ""}
      data-closable={tab.canClose ? "true" : "false"}
      data-closed={closed ? "true" : "false"}
      data-needs-input={tab.needsInput ? "true" : "false"}
      data-muted-needs-input={tab.mutedNeedsInput ? "true" : "false"}
      data-blue-notification={tab.blueNudge ? "true" : "false"}
      data-active-output={isActiveOutput(tab, context.activeOutputThreadKey) ? "true" : "false"}
      data-side-quest-of={tab.sideQuestOf ?? ""}
      data-remind-at={tab.remindAt ?? ""}
    >
      <button
        type="button"
        onClick={() => context.onSelect(threadKey)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        data-testid="thread-tab-list-row-select"
      >
        <span
          className="h-8 w-1 shrink-0 rounded-full"
          style={{ backgroundColor: tabDotColor(tab), opacity: quiet ? 0.4 : 1 }}
        />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className={`flex min-w-0 items-center gap-1.5 text-[14px] ${quiet ? "text-cc-muted" : "text-cc-fg"}`}>
            {isActiveOutput(tab, context.activeOutputThreadKey) && <ActiveOutputSpinner />}
            {tab.ledElsewhere && (
              // Another leader runs this quest now; the meta line names it ("Led by #N").
              <span className="inline-flex shrink-0 text-cc-muted" data-testid="thread-tab-led-elsewhere-icon">
                <SessionRoleIcon role="Leader" />
              </span>
            )}
            {tab.remindAt !== undefined && (
              // Snoozed with "Remind me later": read for now, back when the meta line says.
              <span className="inline-flex shrink-0 text-cc-muted" data-testid="thread-tab-reminder-icon">
                <ClockIcon />
              </span>
            )}
            {tab.sideQuestOf && (
              // A side quest's answer is given where it was asked, so its tab can usually be skipped.
              <span className="inline-flex shrink-0 text-cc-muted">
                <SideQuestIcon sideQuestOf={tab.sideQuestOf} />
              </span>
            )}
            <span className="truncate">
              <Highlight text={tab.title} query={query} />
            </span>
          </span>
          <span className="mt-0.5 truncate text-[11.5px]">
            <span
              style={{ color: main ? "var(--color-cc-muted)" : tab.titleColor }}
              data-testid="thread-tab-list-row-meta"
              data-title-color={main ? "" : (tab.titleColor ?? "")}
            >
              <Highlight text={meta} query={query} />
            </span>
            {summary && <span className="text-cc-muted"> — {summary}</span>}
          </span>
        </span>
      </button>
      {monitor && <NotifyMeIcon pending={Boolean(monitor.pendingResultId)} className="h-4 w-4" />}
      <AttentionBell tab={tab} size="md" />
      {context.onClose && tab.canClose && !closed ? (
        <button
          type="button"
          aria-label={`Close ${tab.questId ?? tab.title}`}
          onClick={() => context.onClose?.(threadKey)}
          className="-mr-1.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
          data-testid="thread-tab-list-row-close"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M3 3l6 6M9 3L3 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      ) : (
        <span className="-mr-1.5 w-8 shrink-0" />
      )}
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLowerCase();
  const at = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark className="rounded-sm bg-cc-primary/25 text-inherit">{text.slice(at, at + needle.length)}</mark>
      {text.slice(at + needle.length)}
    </>
  );
}

/** When a tab last saw activity: a chat, a prompt or result, or a board change. */
function lastActivityAt(tab: PrimaryThreadChip): number {
  return Math.max(tab.updatedAt, tab.groupChangedAt ?? 0);
}

/** Asks once, then closes every finished tab that can close. */
function CloseAllButton({
  tabs,
  onClose,
}: {
  tabs: readonly PrimaryThreadChip[];
  onClose: (threadKey: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (tabs.length === 0) return null;
  return (
    <button
      type="button"
      onClick={() => {
        if (!confirming) {
          setConfirming(true);
          return;
        }
        for (const tab of tabs) onClose(normalizeThreadKey(tab.threadKey));
        setConfirming(false);
      }}
      className="ml-auto text-[12px] text-cc-primary"
      data-testid="thread-tab-close-all"
    >
      {confirming ? `Close ${tabs.length} tabs?` : "Close all"}
    </button>
  );
}

/**
 * The topic-first bar's quest tabs in the order it lists them: Working on, then each topic's
 * other tabs in the order Topics lists the topics (newest change first within a topic), then the
 * tabs under no topic. Closing a tab opens the next one in this order.
 */
export function topicFirstTabOrder(
  tabs: readonly PrimaryThreadChip[],
  topics: readonly TopicSummary[],
  topicOfQuest: Readonly<Record<string, string>>,
  currentThreadKey: string,
): string[] {
  const currentKey = normalizeThreadKey(currentThreadKey);
  // Tabs made earlier for a question asked in a topic conversation or user thread stay out: those
  // live in the Topics and Threads menus.
  const questTabs = tabs
    .map((tab) => readOnScreen(tab, currentKey))
    .filter((tab) => !isMain(tab) && !isTopicViewKey(tab.threadKey));
  const working = workingOnTabs(questTabs);
  const listed = new Set(working.map((tab) => normalizeThreadKey(tab.threadKey)));
  const rest = [...questTabs]
    .filter((tab) => !listed.has(normalizeThreadKey(tab.threadKey)))
    .sort((left, right) => lastActivityAt(right) - lastActivityAt(left));
  const topicRank = new Map(topics.map((topic, index) => [topic.id, index]));
  const rankOf = (tab: PrimaryThreadChip) => {
    const topicId = tab.questId ? topicOfQuest[tab.questId] : undefined;
    return topicId !== undefined ? (topicRank.get(topicId) ?? topics.length) : topics.length + 1;
  };
  const byTopic = rest
    .map((tab, index) => ({ tab, index }))
    .sort((a, b) => rankOf(a.tab) - rankOf(b.tab) || a.index - b.index);
  return [...working, ...byTopic.map(({ tab }) => tab)].map((tab) => normalizeThreadKey(tab.threadKey));
}

/**
 * The quest tabs of the topic-first bar's Working on group: every unfinished quest, newest change
 * first, for switching quickly between the few in active use.
 */
function workingOnTabs(tabs: readonly PrimaryThreadChip[]): PrimaryThreadChip[] {
  return tabs
    .filter((tab) => !tab.completed || tab.needsInput)
    .sort((left, right) => lastActivityAt(right) - lastActivityAt(left));
}

/** A place's unread results: new answers and reports, and finished quests. */
export interface UnreadResultCount {
  /** New answers and reports; answers to one request of the user's count as one. */
  answers: number;
  /** Finished quests whose completion is unread. */
  finished: number;
}

/**
 * Counts unread result notifications the way the attention list does ("2 new answers, 1 finished"):
 * a finished quest's completion separately, answers to one request once.
 */
export function countUnreadResults(
  notifications: ReadonlyArray<Pick<SessionNotification, "id" | "answerTo" | "unreadReason">>,
): UnreadResultCount {
  const finished = notifications.filter((notification) => notification.unreadReason === "quest-complete");
  const answers = new Set(
    notifications
      .filter((notification) => notification.unreadReason !== "quest-complete")
      .map((notification) =>
        notification.answerTo?.length ? `request:${[...notification.answerTo].sort().join(",")}` : notification.id,
      ),
  );
  return { answers: answers.size, finished: finished.length };
}

/** A topic's unread results: from the notifications when known, until then from its tabs' marks. */
function topicUnread(
  topic: TopicSummary,
  own: readonly PrimaryThreadChip[],
  unreadOf: ((threadKeys: readonly string[]) => UnreadResultCount) | undefined,
): UnreadResultCount {
  return unreadOf
    ? unreadOf([topicViewKey(topic.id), ...topic.questIds])
    : { answers: own.filter((tab) => tab.blueNudge).length, finished: 0 };
}

function topicTabs(topic: TopicSummary, tabs: readonly PrimaryThreadChip[]): PrimaryThreadChip[] {
  const members = new Set(topic.questIds.map(normalizeThreadKey));
  return tabs.filter((tab) => members.has(normalizeThreadKey(tab.questId ?? tab.threadKey)));
}

/** Quest tabs under no topic, which the Topics list shows below its topics. */
function tabsInNoTopic(
  tabs: readonly PrimaryThreadChip[],
  topicOfQuest: Readonly<Record<string, string>>,
): PrimaryThreadChip[] {
  return tabs.filter((tab) => !tab.questId || !topicOfQuest[tab.questId]);
}

/** What a topic's open quest tabs say about it, for its row in the topic-first bar's list. */
export interface TopicTabStatus {
  /** Unfinished quests with tabs, newest change first. */
  inProgress: PrimaryThreadChip[];
  /** New answers and reports (answers to one request count once). */
  unread: number;
  /** Finished quests whose completion is unread. */
  finished: number;
  /** The leader is writing in one of its quests now. */
  active: boolean;
  /** Notify Me is on for one of its quests. */
  watching: boolean;
}

function topicStatus(
  topic: TopicSummary,
  tabs: readonly PrimaryThreadChip[],
  activeOutputThreadKey: string | null,
  monitors: ThreadMonitoringProjectionValue["threads"] | undefined,
  unreadOf: ((threadKeys: readonly string[]) => UnreadResultCount) | undefined,
): TopicTabStatus {
  const own = topicTabs(topic, tabs);
  const { answers, finished } = topicUnread(topic, own, unreadOf);
  return {
    inProgress: workingOnTabs(own.filter((tab) => !tab.completed)),
    unread: answers,
    finished,
    // Writing in one of its quests, or in the topic's own thread.
    active:
      own.some((tab) => isActiveOutput(tab, activeOutputThreadKey)) ||
      (!!activeOutputThreadKey && isKeyOfTopic(activeOutputThreadKey, topic.id)),
    watching: topic.questIds.some((questId) => !!monitors?.[normalizeThreadKey(questId)]),
  };
}

/** The phase colors of the first few quests: the color the user scans for. */
export function PhaseDots({ tabs }: { tabs: readonly PrimaryThreadChip[] }) {
  if (tabs.length === 0) return null;
  return (
    <span className="flex shrink-0 gap-0.5" aria-hidden="true">
      {tabs.slice(0, 4).map((tab) => (
        <span
          key={tab.threadKey}
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: tabDotColor(tab) }}
          data-testid="thread-tab-group-dot"
        />
      ))}
    </span>
  );
}

function ListHeading({ label, count, children }: { label: string; count: number; children?: ReactNode }) {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 bg-cc-card/95 px-4 pb-1 pt-2.5 backdrop-blur">
      <span className="shrink-0 text-[11px] uppercase tracking-wide text-cc-muted">{label}</span>
      <span className="shrink-0 text-[11px] tabular-nums text-cc-muted">{count}</span>
      {children}
    </div>
  );
}

/**
 * The Topics group's list: its topics with a search box in the heading, then (topic-first) the
 * quest tabs under no topic, which the search narrows by title and quest number too.
 */
function TopicsGroupList({
  topicsGroup,
  topicFirst,
  currentTopicId,
  questTabs,
  rowContext,
  onLeave,
}: {
  topicsGroup: NonNullable<ThreadTabGroupBarProps["topicsGroup"]>;
  topicFirst: boolean;
  currentTopicId: string | null;
  questTabs: readonly PrimaryThreadChip[];
  rowContext: RowContext;
  onLeave: () => void;
}) {
  const [query, setQuery] = useState("");
  const topics = searchTopics(topicsGroup.topics, query);
  const unsorted = topicFirst
    ? tabsInNoTopic(questTabs, topicsGroup.topicOfQuest).filter((tab) =>
        matchesSearch(`${tab.title} ${tab.questId ?? ""}`, query),
      )
    : [];
  return (
    <>
      <ListHeading label="Topics" count={topicsGroup.topics.length}>
        <TopicSearchBox query={query} onChange={setQuery} />
      </ListHeading>
      {query.trim() && topics.length === 0 && unsorted.length === 0 && <NoTopicMatches query={query} />}
      <TopicTabList
        topics={topics}
        currentTopicId={currentTopicId}
        onOpen={topicsGroup.onOpen}
        onLeave={onLeave}
        statusOf={
          topicFirst
            ? (topic) =>
                topicStatus(
                  topic,
                  questTabs,
                  rowContext.activeOutputThreadKey,
                  rowContext.monitors,
                  topicsGroup.unreadOf,
                )
            : undefined
        }
      />
      {topicFirst && <UnsortedTabs tabs={unsorted} context={rowContext} query={query} />}
    </>
  );
}

/**
 * The most a list opened downward from the top can be tall and still end above the phone's
 * keyboard (the visual viewport's bottom), while `active`; null when it need not be limited.
 */
function useHeightAboveKeyboard(ref: RefObject<HTMLElement | null>, active: boolean): number | null {
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    if (!active || !viewport) {
      setHeight(null);
      return;
    }
    const update = () => {
      const top = ref.current?.getBoundingClientRect().top;
      if (top === undefined) return;
      setHeight(Math.max(120, Math.floor(viewport.offsetTop + viewport.height - top - 8)));
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, [ref, active]);
  return height;
}

/** Below the topics: quest tabs not filed under a topic yet, as ordinary tab rows. */
function UnsortedTabs({
  tabs,
  context,
  query,
}: {
  tabs: readonly PrimaryThreadChip[];
  context: RowContext;
  query: string;
}) {
  if (tabs.length === 0) return null;
  const sorted = [...tabs].sort((left, right) => lastActivityAt(right) - lastActivityAt(left));
  return (
    <div className="border-t border-cc-border/60" data-testid="topic-tab-unsorted">
      <ListHeading label="Not in a topic" count={sorted.length} />
      {sorted.map((tab) => (
        <ThreadTabListRow key={tab.threadKey} tab={tab} context={context} query={query} />
      ))}
    </div>
  );
}
