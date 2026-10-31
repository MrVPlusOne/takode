/**
 * The lists a leader's breadcrumb navigation shows (`LeaderBreadcrumbNav`): its topics, each saying
 * what its quests are doing, the quests under no topic, and the rows, bells and spinners they share.
 * Finding a tab or a message is Search everything's Tabs and Messages modes.
 */
import type { TopicSummary } from "../../shared/library-topics.js";
import { TopicTabList } from "./TopicTabList.js";
import { isKeyOfTopic, topicViewKey } from "../../shared/topic-thread-key.js";
import { matchesSearch, NoTopicMatches, searchTopics, TopicSearchBox } from "./library/topic-search.js";
import { useState, type CSSProperties, type ReactNode } from "react";
import { threadStatusKey, type LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import type { ThreadMonitoringProjectionValue } from "../../shared/thread-monitoring.js";
import { LONG_PRESS_TARGET_CLASS, useLongPress, type OpenContextMenu } from "../hooks/useLongPress.js";
import { MAIN_THREAD_KEY, normalizeThreadKey } from "../utils/thread-projection.js";
import { timeAgo } from "../utils/quest-helpers.js";
import { BellIcon } from "./AttentionKind.js";
import { NotifyMeIcon } from "./NotifyMe.js";
import { SessionRoleIcon } from "./SessionRoleLabel.js";
import type { PrimaryThreadChip } from "./WorkBoardThreadTabs.js";
import { SideQuestIcon } from "./SideQuestCue.js";
import { ClockIcon, formatSnoozeUntil } from "./RemindLaterChoices.js";
import type { SessionNotification } from "../types.js";
import { isOpenInSideClick, type OpenInSideEvent } from "../utils/side-column.js";

/**
 * The tab on screen shows its result as read. The browser marks a result in the open tab
 * read as soon as it arrives, but the server confirms that a round trip later; filing the
 * tab under New results meanwhile flashed it through that group, for example on its way
 * from In progress to Done when its quest finishes while the user watches.
 */
export function readOnScreen(tab: PrimaryThreadChip, currentKey: string): PrimaryThreadChip {
  return tab.blueNudge && normalizeThreadKey(tab.threadKey) === currentKey ? { ...tab, blueNudge: false } : tab;
}

function isMain(tab: PrimaryThreadChip): boolean {
  return normalizeThreadKey(tab.threadKey) === MAIN_THREAD_KEY;
}

function tabDotColor(tab: PrimaryThreadChip): string {
  if (isMain(tab)) return "var(--color-cc-fg)";
  return tab.accentColor ?? tab.titleColor ?? "var(--color-cc-muted)";
}

export interface RowContext {
  currentThreadKey: string;
  activeOutputThreadKey: string | null;
  monitors?: ThreadMonitoringProjectionValue["threads"];
  threadStatuses?: Readonly<Record<string, LeaderThreadStatus>>;
  onSelect: (threadKey: string) => void;
  /** A list row's open-in-side click: the thread goes in the side column instead of the main view. */
  onOpenInSide?: (threadKey: string) => void;
  onOpenMenu?: (tab: PrimaryThreadChip) => OpenContextMenu | undefined;
}

/** A leader's topics for the place picker: by recent activity, each quest's topic, and opening one. */
export interface TopicsGroup {
  topics: TopicSummary[];
  currentTopicId: string | null;
  /** With the click, so a modifier-click can open the topic in the side column instead. */
  onOpen: (topic: TopicSummary, event?: OpenInSideEvent) => void;
  /** The topic of each quest tab, by quest ID; a quest with none is listed as not in a topic yet. */
  topicOfQuest: Readonly<Record<string, string>>;
  /**
   * The unread results in these threads (a topic's own thread and its quests), counted as the
   * attention list counts them, when the leader's notifications are known.
   */
  unreadOf?: (threadKeys: readonly string[]) => UnreadResultCount;
}

function isActiveOutput(tab: PrimaryThreadChip, activeOutputThreadKey: string | null): boolean {
  return !!activeOutputThreadKey && normalizeThreadKey(tab.threadKey) === normalizeThreadKey(activeOutputThreadKey);
}

/** The bell as today's tabs draw it: an outline in the attention color, nothing when quiet. */
export function AttentionBell({ tab, size = "sm" }: { tab: PrimaryThreadChip; size?: "sm" | "md" }) {
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
export function ActiveOutputSpinner() {
  return (
    <span
      role="img"
      aria-label="Leader working here"
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-cc-info/30 border-t-cc-info motion-safe:animate-spin"
      data-testid="thread-tab-active-output-spinner"
    />
  );
}

/**
 * One tab in a group list or the switcher: its color, title, quest number and state, bell
 * and close. A closed tab reads muted, has no close or menu, and reopens when chosen.
 */
export function ThreadTabListRow({
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
        onClick={(event) =>
          context.onOpenInSide && isOpenInSideClick(event)
            ? context.onOpenInSide(threadKey)
            : context.onSelect(threadKey)
        }
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
      <span className="-mr-1.5 w-8 shrink-0" />
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

/**
 * The quest tabs of the topic-first bar's Working on group: every unfinished quest, newest change
 * first, for switching quickly between the few in active use.
 */
export function workingOnTabs(tabs: readonly PrimaryThreadChip[]): PrimaryThreadChip[] {
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
/** Finished quests under no topic that the place picker lists before a search; older ones are searched for. */
export const RECENT_FINISHED_NOT_IN_TOPIC = 20;

/**
 * The leader's quests filed under no topic: its quest tabs, then `moreQuests` (its board's quests,
 * active and finished) that have no tab, so a quest stays reachable after its tab is gone. A quest
 * is in a topic when its topic is known or a topic lists it.
 */
export function questsInNoTopic(
  tabs: readonly PrimaryThreadChip[],
  moreQuests: readonly PrimaryThreadChip[],
  topics: readonly TopicSummary[],
  topicOfQuest: Readonly<Record<string, string>>,
): PrimaryThreadChip[] {
  const filed = new Set(topics.flatMap((topic) => topic.questIds.map(normalizeThreadKey)));
  const inNoTopic = (tab: PrimaryThreadChip) =>
    !tab.questId || (!topicOfQuest[tab.questId] && !filed.has(normalizeThreadKey(tab.questId)));
  const listed = new Set(tabs.map((tab) => normalizeThreadKey(tab.threadKey)));
  return [...tabs, ...moreQuests.filter((quest) => !listed.has(normalizeThreadKey(quest.threadKey)))].filter(inNoTopic);
}

/**
 * What the list shows of them without a search: every unfinished one and the most recently
 * finished (`RECENT_FINISHED_NOT_IN_TOPIC`), newest change first, and how many older ones a
 * search reaches.
 */
export function recentNotInTopic(quests: readonly PrimaryThreadChip[]): {
  shown: PrimaryThreadChip[];
  older: number;
} {
  const sorted = [...quests].sort((left, right) => lastActivityAt(right) - lastActivityAt(left));
  const finished = sorted.filter((quest) => quest.completed);
  const kept = new Set(finished.slice(0, RECENT_FINISHED_NOT_IN_TOPIC));
  return {
    shown: sorted.filter((quest) => !quest.completed || kept.has(quest)),
    older: finished.length - kept.size,
  };
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

export function ListHeading({ label, count, children }: { label: string; count: number; children?: ReactNode }) {
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
export function TopicsGroupList({
  topicsGroup,
  topicFirst,
  currentTopicId,
  questTabs,
  moreQuests = [],
  rowContext,
  onLeave,
}: {
  topicsGroup: TopicsGroup;
  topicFirst: boolean;
  currentTopicId: string | null;
  questTabs: readonly PrimaryThreadChip[];
  /** The leader's other quests (its board's), listed under no topic too when they have no tab. */
  moreQuests?: readonly PrimaryThreadChip[];
  rowContext: RowContext;
  onLeave: () => void;
}) {
  const [query, setQuery] = useState("");
  const topics = searchTopics(topicsGroup.topics, query);
  const unsorted = topicFirst
    ? questsInNoTopic(questTabs, moreQuests, topicsGroup.topics, topicsGroup.topicOfQuest).filter((tab) =>
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
 * Below the topics: quests not filed under a topic, as ordinary tab rows. Without a search it lists
 * the unfinished ones and the recently finished; a search reaches every one.
 */
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
  const { shown, older } = query.trim()
    ? { shown: [...tabs].sort((left, right) => lastActivityAt(right) - lastActivityAt(left)), older: 0 }
    : recentNotInTopic(tabs);
  return (
    <div className="border-t border-cc-border/60" data-testid="topic-tab-unsorted">
      <ListHeading label="Not in a topic" count={tabs.length} />
      {shown.map((tab) => (
        <ThreadTabListRow key={tab.threadKey} tab={tab} context={context} query={query} />
      ))}
      {older > 0 && (
        <p className="px-4 py-2 text-[12px] text-cc-muted" data-testid="topic-tab-unsorted-older">
          {older} older finished {older === 1 ? "quest" : "quests"}: search to find {older === 1 ? "it" : "them"}
        </p>
      )}
    </div>
  );
}
