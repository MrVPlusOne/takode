import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { ThreadSummary, TopicSummary } from "../../../shared/library-topics.js";
import { isKeyOfTopic, isTopicViewKey } from "../../../shared/topic-thread-key.js";
import { useDesktopShellLayout } from "../../hooks/useDesktopShellLayout.js";
import type { OpenInSideEvent } from "../../utils/side-column.js";
import { ALL_THREADS_KEY, MAIN_THREAD_KEY, normalizeThreadKey } from "../../utils/thread-projection.js";
import type { BoardPhaseDot } from "../leader-board-summary.js";
import { WorkBoardDotsIcon, WorkBoardIcon } from "../leader-workboard-controls.js";
import {
  ActiveOutputSpinner,
  AttentionBell,
  ListHeading,
  readOnScreen,
  ThreadTabListRow,
  TopicsGroupList,
  workingOnTabs,
  type RowContext,
  type UnreadResultCount,
} from "../ThreadTabGroups.js";
import type { PrimaryThreadChip } from "../WorkBoardThreadTabs.js";
import { AllThreadsIcon, MainIcon, PlaceCrumb, PlaceRow } from "./PlaceCrumb.js";

export interface LeaderBreadcrumbNavProps extends RowContext {
  main?: PrimaryThreadChip;
  tabs: readonly PrimaryThreadChip[];
  /** The leader's topics by recent activity, the topic of each quest tab, and opening one. */
  topics: {
    list: TopicSummary[];
    /** The topic whose conversation is on screen. */
    currentTopicId: string | null;
    topicOfQuest: Readonly<Record<string, string>>;
    /** With the click, so a modifier-click can open the topic in the side column instead. */
    onOpen: (topic: TopicSummary, event?: OpenInSideEvent) => void;
    unreadOf?: (threadKeys: readonly string[]) => UnreadResultCount;
  };
  /** The leader's threads (side chats), to name the topic a thread on screen is filed under. */
  threads: readonly ThreadSummary[];
  /** The top bar's helpers place, where the Working on picker goes. */
  helpers: HTMLElement | null;
  board: { open: boolean; dots: readonly BoardPhaseDot[]; onToggle: () => void };
  /** The start of the strip on screen, where the place picker goes (null until a strip draws it). */
  crumbSlot: HTMLElement | null;
}

/**
 * A topic-first leader's navigation, on desktop and phones alike: no tab row. Where the conversation
 * lives is the breadcrumb's first part (Main, All threads or a topic, drawn at the start of the strip
 * under the top bar), and the quests in motion are the Working on picker in the top bar, which also
 * holds the full work board. Draws nothing in place; both parts go to their places by portal.
 */
export function LeaderBreadcrumbNav({
  main,
  tabs,
  topics,
  threads,
  helpers,
  board,
  crumbSlot,
  ...rows
}: LeaderBreadcrumbNavProps) {
  const [workingOnOpen, setWorkingOnOpen] = useState(false);
  const desktop = useDesktopShellLayout();
  const currentKey = normalizeThreadKey(rows.currentThreadKey);
  // Topic conversations and threads are not tabs here; they are reached by the place picker.
  const questTabs = tabs
    .map((tab) => readOnScreen(tab, currentKey))
    .filter((tab) => normalizeThreadKey(tab.threadKey) !== MAIN_THREAD_KEY && !isTopicViewKey(tab.threadKey));
  const workingOn = workingOnTabs(questTabs);
  const mainTab = main ?? quietMain;
  // The leader writing somewhere not on screen: Working on spins for a quest it lists, the place
  // picker's Main row for Main (the feed's "Active here" covers writing on screen).
  const writingKey = rows.activeOutputThreadKey ? normalizeThreadKey(rows.activeOutputThreadKey) : null;
  const writingOnScreen =
    !!writingKey &&
    (writingKey === currentKey ||
      currentKey === ALL_THREADS_KEY ||
      (!!topics.currentTopicId &&
        (topics.topicOfQuest[writingKey] === topics.currentTopicId ||
          isKeyOfTopic(writingKey, topics.currentTopicId))));
  const writingElsewhere = writingKey && !writingOnScreen ? writingKey : null;
  const select = (threadKey: string) => {
    setWorkingOnOpen(false);
    rows.onSelect(threadKey);
  };
  const rowContext = {
    ...rows,
    onSelect: select,
    ...(rows.onOpenInSide
      ? {
          onOpenInSide: (threadKey: string) => {
            setWorkingOnOpen(false);
            rows.onOpenInSide!(threadKey);
          },
        }
      : {}),
  };

  useEffect(() => {
    if (!workingOnOpen) return;
    const onKeyDown = (event: KeyboardEvent) => event.key === "Escape" && setWorkingOnOpen(false);
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [workingOnOpen]);

  // Where the conversation on screen lives: a topic (a quest's, a thread's, or the topic's own
  // conversation), else Main or All.
  const placeTopicId =
    topics.currentTopicId ??
    topics.topicOfQuest[currentKey] ??
    threads.find((thread) => thread.key === currentKey)?.topic?.id ??
    null;
  const placeTopic = placeTopicId ? topics.list.find((topic) => topic.id === placeTopicId) : undefined;
  const place = placeTopic
    ? ({ kind: "topic", name: placeTopic.name } as const)
    : ({ kind: currentKey === ALL_THREADS_KEY ? "all" : "main" } as const);
  const placeList = (close: () => void) => {
    const go = (threadKey: string) => {
      close();
      select(threadKey);
    };
    return (
      <>
        <PlaceRow
          label={
            <>
              Main
              <AttentionBell tab={mainTab} />
              {writingElsewhere === MAIN_THREAD_KEY && <ActiveOutputSpinner />}
            </>
          }
          detail="Requests and work not in a topic"
          selected={place.kind === "main"}
          onClick={() => go(MAIN_THREAD_KEY)}
          icon={<MainIcon className="h-4 w-4" />}
          testId="place-row-main"
        />
        <PlaceRow
          label="All threads"
          detail="Every message, in order"
          selected={place.kind === "all"}
          onClick={() => go(ALL_THREADS_KEY)}
          icon={<AllThreadsIcon className="h-4 w-4" />}
          testId="place-row-all"
        />
        <div className="border-t border-cc-border/60">
          <TopicsGroupList
            topicsGroup={{
              topics: topics.list,
              currentTopicId: placeTopicId,
              topicOfQuest: topics.topicOfQuest,
              unreadOf: topics.unreadOf,
              onOpen: (topic, event) => {
                close();
                topics.onOpen(topic, event);
              },
            }}
            topicFirst
            currentTopicId={placeTopicId}
            questTabs={questTabs}
            rowContext={{
              ...rowContext,
              onSelect: go,
              ...(rowContext.onOpenInSide
                ? {
                    onOpenInSide: (threadKey: string) => {
                      close();
                      rowContext.onOpenInSide!(threadKey);
                    },
                  }
                : {}),
            }}
            onLeave={close}
          />
        </div>
      </>
    );
  };

  const workingOnSpins =
    !!writingElsewhere && workingOn.some((tab) => normalizeThreadKey(tab.threadKey) === writingElsewhere);
  const workingOnPicker = (
    // On a phone the list spans the top bar (the nearest positioned box), not just this button's width.
    <div className="relative flex items-center max-sm:static" data-testid="thread-top-bar-helpers">
      <button
        type="button"
        onClick={() => setWorkingOnOpen((open) => !open)}
        // Above the open list's backdrop, so a second click closes the list.
        className={`relative ${workingOnOpen ? "z-50" : ""} inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2 text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-cc-primary/70 ${
          desktop ? "h-7" : "h-9"
        } ${
          workingOnOpen || board.open
            ? "border-cc-primary/50 bg-cc-primary/12 text-cc-fg"
            : "border-cc-border bg-cc-hover/40 text-cc-fg hover:bg-cc-hover"
        }`}
        aria-label={`Working on: ${workingOn.length}`}
        aria-expanded={workingOnOpen}
        aria-haspopup="menu"
        title="Quests in progress"
        data-testid="thread-tab-group-working-on"
        data-group="working-on"
      >
        {workingOnSpins && <ActiveOutputSpinner />}
        <WorkBoardDotsIcon dots={board.dots} large={false} />
        {/* A phone's top bar has room for the count only; the list is headed "Working on". */}
        <span className="tabular-nums">{desktop ? `Working on ${workingOn.length}` : workingOn.length}</span>
        <Chevron />
      </button>
      {workingOnOpen && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setWorkingOnOpen(false)}
            data-testid="thread-tab-group-backdrop"
          />
          <div
            className="absolute right-0 top-full z-50 mt-2 max-h-[70dvh] w-[28rem] overflow-y-auto rounded-xl border border-cc-border bg-cc-card py-1 shadow-xl max-sm:left-2 max-sm:right-2 max-sm:w-auto"
            role="menu"
            data-testid="thread-tab-group-list"
            data-group="working-on"
          >
            <ListHeading label="Working on" count={workingOn.length}>
              <button
                type="button"
                onClick={() => {
                  setWorkingOnOpen(false);
                  board.onToggle();
                }}
                className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md border border-cc-border bg-cc-hover/40 px-2 text-[12px] normal-case tracking-normal text-cc-fg hover:bg-cc-hover"
                data-testid="thread-top-bar-board-button"
              >
                <WorkBoardIcon className="h-3.5 w-3.5 text-cc-info" />
                {board.open ? "Close board" : "Full board"}
              </button>
            </ListHeading>
            {workingOn.length === 0 && <div className="px-4 py-3 text-[12px] text-cc-muted">Nothing in progress</div>}
            {workingOn.map((tab) => (
              <ThreadTabListRow key={tab.threadKey} tab={tab} context={rowContext} />
            ))}
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      {crumbSlot && createPortal(<PlaceCrumb place={place} list={placeList} />, crumbSlot)}
      {helpers && createPortal(workingOnPicker, helpers)}
    </>
  );
}

const quietMain: PrimaryThreadChip = {
  threadKey: MAIN_THREAD_KEY,
  title: "Main Thread",
  needsInput: false,
  mutedNeedsInput: false,
  blueNudge: false,
  canClose: false,
  updatedAt: 0,
};

function Chevron(): ReactNode {
  return (
    <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 text-cc-muted" fill="none" aria-hidden="true">
      <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
