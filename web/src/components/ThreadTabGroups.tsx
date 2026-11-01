/**
 * A leader's threads, grouped by what the user looks for: Needs you and Unread for what needs them,
 * In progress and Idle for whether work goes on, so a thread can be in two groups. Every thread is a
 * member: a quest's, and the leader's other threads alike. The status row
 * under the top bar (`ThreadGroupBar`) is the leader's navigation; its Home lists the same groups
 * at full width (`ThreadGroupSections`). Topics are tags on a thread, not places.
 */
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import type { ThreadSummary } from "../../shared/library-topics.js";
import { isTopicViewKey } from "../../shared/topic-thread-key.js";
import { threadStatusKey, type LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import type { ThreadMonitoringProjectionValue } from "../../shared/thread-monitoring.js";
import { LONG_PRESS_TARGET_CLASS, useLongPress, type OpenContextMenu } from "../hooks/useLongPress.js";
import type { SessionNotification } from "../types.js";
import { resolveNotificationOwnerThreadKey } from "../utils/notification-thread.js";
import { timeAgo } from "../utils/quest-helpers.js";
import { isOpenInSideClick } from "../utils/side-column.js";
import { ALL_THREADS_KEY, MAIN_THREAD_KEY, normalizeThreadKey } from "../utils/thread-projection.js";
import { BellIcon } from "./AttentionKind.js";
import { NewThreadIcon } from "./library/library-icons.js";
import { NotifyMeIcon } from "./NotifyMe.js";
import { ClockIcon, formatSnoozeUntil } from "./RemindLaterChoices.js";
import { SessionRoleIcon } from "./SessionRoleLabel.js";
import { SideQuestIcon } from "./SideQuestCue.js";
import { useGroupMoveAnimation } from "./thread-tab-group-move.js";
import type { PrimaryThreadChip } from "./WorkBoardThreadTabs.js";

export type ThreadGroupId = "needs-input" | "new-results" | "idle" | "in-progress";

/**
 * The groups by urgency: what needs the user (questions, then unread results), then work going on
 * now, then the large, quiet Idle group (nothing running; finished quests included). A thread in two
 * groups belongs to the first here, and Home lists its sections in this order, top down.
 */
export const THREAD_GROUP_ORDER: readonly ThreadGroupId[] = ["needs-input", "new-results", "in-progress", "idle"];

/**
 * The status row's tabs, left to right after Home: the urgent groups on the right, nearest the
 * thumb and the bell (Jiayi, Nov 1).
 */
export const THREAD_GROUP_BAR_ORDER: readonly ThreadGroupId[] = [...THREAD_GROUP_ORDER].reverse();

const GROUP_LABEL: Record<ThreadGroupId, string> = {
  "needs-input": "Needs you",
  "new-results": "Unread",
  idle: "Idle",
  "in-progress": "In progress",
};

/**
 * A bar this wide labels each group and anchors its list under its tab; a narrower one (a phone, or
 * the main view beside the side column) shares its width evenly with counts only. The bar's own
 * width decides, not the screen's: the side column takes room from it (`@2xl` = 42rem).
 */
const WIDE_BAR_PX = 672;
const WIDE_LIST_WIDTH_PX = 448;

/**
 * Splits threads by two questions (Jiayi, Oct 31): does it need the user (Needs you for a question,
 * else Unread for an unread result), and is work going on in it (In progress while `isRunning`,
 * else Idle). Every thread is in exactly one of In progress and Idle, so In progress always shows
 * everything running; a thread that needs the user is in its attention group as well, so an unread
 * running quest is under Unread and In progress. A member that is not a thread with work of its
 * own (`attentionOnly`: the leader log, a question about a quest without a tab) is in its attention
 * group only. Within a group, the thread that entered it or was
 * chatted in most recently comes first. The groups come in `THREAD_GROUP_ORDER`.
 */
export function groupThreads(threads: readonly PrimaryThreadChip[]): Record<ThreadGroupId, PrimaryThreadChip[]> {
  const groups = Object.fromEntries(THREAD_GROUP_ORDER.map((id) => [id, [] as PrimaryThreadChip[]])) as Record<
    ThreadGroupId,
    PrimaryThreadChip[]
  >;
  for (const thread of threads) {
    const attention = threadGroupOf(thread);
    if (attention === "needs-input" || attention === "new-results") groups[attention].push(thread);
    if (!thread.attentionOnly) groups[activityGroupOf(thread)].push(thread);
  }
  for (const group of Object.values(groups)) {
    group.sort((left, right) => lastActivityAt(right) - lastActivityAt(left));
  }
  return groups;
}

/**
 * A thread's status, the colour of its dot wherever it is listed: a question outranks an unread
 * result, then work going on, else Idle. In In progress and Idle a thread that needs the user keeps
 * its amber or blue dot.
 */
export function threadGroupOf(thread: PrimaryThreadChip): ThreadGroupId {
  if (thread.needsInput) return "needs-input";
  if (thread.blueNudge) return "new-results";
  return activityGroupOf(thread);
}

/** Whether work goes on in a thread: In progress or Idle. */
export function activityGroupOf(thread: PrimaryThreadChip): "in-progress" | "idle" {
  return isRunning(thread) ? "in-progress" : "idle";
}

/**
 * The one set of status dot colors, one per group and the same as the group's tab: amber needs you,
 * blue unread, green in progress, grey idle. Every status dot of a thread (the status row, Home, the side column, the sessions
 * panel's Threads view) uses it. Jiayi (Oct 31): a finished quest's row showed Questmaster's purple
 * "done" color, which means nothing here; a quest's phase is named in words, not by its dot.
 */
export const THREAD_GROUP_DOT: Record<ThreadGroupId, string> = {
  "needs-input": "bg-cc-attention",
  "new-results": "bg-cc-info",
  "in-progress": "bg-cc-success",
  idle: "bg-cc-muted/60",
};

/** Work goes on in a thread now: as its member says, else (no word) an unfinished quest. */
export function isRunning(thread: PrimaryThreadChip): boolean {
  return thread.running ?? !thread.completed;
}

/**
 * The thread on screen shows its result as read. The browser marks a result in the open thread read
 * as soon as it arrives, but the server confirms that a round trip later; filing the thread under
 * Unread meanwhile flashed it through that group, for example on its way from In progress to Idle
 * when its quest finishes while the user watches.
 */
export function readOnScreen(tab: PrimaryThreadChip, currentKey: string): PrimaryThreadChip {
  return tab.blueNudge && normalizeThreadKey(tab.threadKey) === currentKey ? { ...tab, blueNudge: false } : tab;
}

/**
 * A thread that is not a quest's (the user started it, or the leader opened it), as a group member:
 * an open question puts it under Needs you, an unread answer under Unread; it is In progress
 * only while the leader is writing in it (`writing`), else Idle.
 */
export function plainThreadChip(
  thread: ThreadSummary,
  notifications: readonly SessionNotification[] | undefined,
  writing = false,
): PrimaryThreadChip {
  const key = normalizeThreadKey(thread.key);
  const open = (notifications ?? []).filter(
    (notification) => !notification.done && resolveNotificationOwnerThreadKey(notification) === key,
  );
  const questions = open.some((notification) => notification.category === "needs-input");
  const unread = open.some((notification) => notification.category === "review");
  return {
    threadKey: thread.key,
    title: thread.name,
    needsInput: questions,
    mutedNeedsInput: false,
    blueNudge: unread,
    completed: !!thread.settledAt && !questions && !unread,
    running: writing,
    stateLabel: thread.topic ? `Thread · ${thread.topic.name}` : "Thread",
    groupChangedAt: thread.interactionAt ?? thread.activityAt,
    canClose: false,
    updatedAt: thread.activityAt,
  };
}

function isHome(tab: PrimaryThreadChip): boolean {
  return normalizeThreadKey(tab.threadKey) === MAIN_THREAD_KEY;
}

/** When a thread last saw activity: a chat, a question or result, or a board change. */
function lastActivityAt(tab: PrimaryThreadChip): number {
  return Math.max(tab.updatedAt, tab.groupChangedAt ?? 0);
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
  /** A line of news under a row (Home's wide rows): what is newest in the thread. */
  lineOf?: (threadKey: string) => string | undefined;
}

export interface ThreadGroupBarProps extends RowContext {
  /** Home's tab: its bell for anything still waiting in Main from before Home. */
  home?: PrimaryThreadChip;
  threads: readonly PrimaryThreadChip[];
}

/**
 * The leader's status row: Home, then one tab per non-empty group. A group of one opens its thread
 * on a tap; a larger group opens its list under the row (a second mouse click opens the list's
 * first thread; a second tap closes it). The thread strip below names the thread on screen, so the
 * row only marks which group holds it.
 */
export function ThreadGroupBar({ home, threads, ...rows }: ThreadGroupBarProps) {
  const [openGroup, setOpenGroup] = useState<ThreadGroupId | null>(null);
  // The input of the latest press on the bar: a click on an open group differs by mouse and finger.
  const lastPressRef = useRef<string>("mouse");
  const homeTab = home ?? quietHome;
  const currentKey = normalizeThreadKey(rows.currentThreadKey);
  const groups = groupThreads(threads.map((tab) => readOnScreen(tab, currentKey)));
  // The leader log is reached from Home, so Home is the selected tab there too.
  const onHome = currentKey === MAIN_THREAD_KEY || currentKey === ALL_THREADS_KEY;
  // A thread can be in two groups; the first in order (its attention group) holds it here.
  const groupOf = (threadKey: string, among: readonly ThreadGroupId[] = THREAD_GROUP_ORDER) =>
    among.find((id) => groups[id].some((tab) => normalizeThreadKey(tab.threadKey) === threadKey)) ?? null;
  // Which tab spins: only one, and none for writing already on screen (the feed's "Active here"
  // shows it). The writing is on screen in its own thread and in the leader log.
  const writingKey = rows.activeOutputThreadKey ? normalizeThreadKey(rows.activeOutputThreadKey) : null;
  const writingOnScreen = !!writingKey && (writingKey === currentKey || currentKey === ALL_THREADS_KEY);
  const spinningTab: "home" | ThreadGroupId | null =
    !writingKey || writingOnScreen
      ? null
      : writingKey === MAIN_THREAD_KEY
        ? "home"
        : groupOf(writingKey, ["in-progress", "idle"]);
  const currentGroup = onHome ? null : groupOf(currentKey);
  const barRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLSpanElement | null>(null);
  const move = useGroupMoveAnimation(barRef, ghostRef, currentKey, currentGroup, groups);
  // While the tab on screen glides to its new group, its old group stays on screen even if the
  // move emptied it, and neither group is selected: the floating tab is.
  const moving = move ? threads.find((tab) => normalizeThreadKey(tab.threadKey) === currentKey) : undefined;
  const movingLabel = moving?.questId ?? moving?.title ?? "";
  const tabsOf = (id: ThreadGroupId) => (move?.from === id && groups[id].length === 0 ? move.fromTabs : groups[id]);
  const select = (threadKey: string) => {
    setOpenGroup(null);
    rows.onSelect(threadKey);
  };
  const rowContext = {
    ...rows,
    onSelect: select,
    ...(rows.onOpenInSide
      ? {
          onOpenInSide: (threadKey: string) => {
            setOpenGroup(null);
            rows.onOpenInSide!(threadKey);
          },
        }
      : {}),
  };
  const [listLeft, setListLeft] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listMaxHeight = useHeightAboveKeyboard(listRef, !!openGroup);

  // On wide screens a group's list opens under its own tab instead of spanning the bar.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!openGroup || !bar || bar.clientWidth < WIDE_BAR_PX) {
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

  // The selected tab takes the color of the strip it labels: Home's strip is a card, a thread's
  // strip sits on the page background.
  const selectedSurface = onHome ? "bg-cc-card" : "bg-cc-bg";
  return (
    <div
      ref={barRef}
      className="@container relative min-w-0"
      data-testid="thread-group-bar"
      onPointerDownCapture={(event) => {
        lastPressRef.current = event.pointerType;
      }}
      onKeyDownCapture={() => {
        lastPressRef.current = "keyboard";
      }}
    >
      <div className="flex items-end gap-1 pt-0.5" role="tablist">
        <BarItem
          label="Home"
          selected={onHome}
          selectedSurface={selectedSurface}
          activeOutput={spinningTab === "home"}
          testId="thread-group-home"
          onClick={() => select(MAIN_THREAD_KEY)}
        >
          <span>Home</span>
          <AttentionBell tab={homeTab} />
        </BarItem>
        {THREAD_GROUP_BAR_ORDER.map((id) =>
          tabsOf(id).length > 0 ? (
            <BarItem
              key={id}
              label={`${GROUP_LABEL[id]}: ${tabsOf(id).length}`}
              selected={currentGroup === id && !move}
              selectedSurface={selectedSurface}
              open={openGroup === id}
              group={id}
              count={tabsOf(id).length}
              activeOutput={spinningTab === id}
              testId="thread-tab-group-chip"
              onClick={() => {
                const first = tabsOf(id)[0]!;
                if (tabsOf(id).length === 1 || (openGroup === id && !isTouchPress(lastPressRef.current))) {
                  setOpenGroup(null);
                  if (first.onOpen) first.onOpen();
                  else select(first.threadKey);
                  return;
                }
                setOpenGroup((open) => (open === id ? null : id));
              }}
              onOpenList={() => setOpenGroup(id)}
              single={tabsOf(id).length === 1}
            >
              <GroupContent id={id} tabs={tabsOf(id)} />
            </BarItem>
          ) : null,
        )}
      </div>
      {move && (
        <span
          ref={ghostRef}
          aria-hidden="true"
          className={`pointer-events-none absolute -bottom-px z-20 inline-flex h-8 items-center justify-center gap-1.5 rounded-t-md border border-b-0 border-cc-primary/45 px-1.5 text-[12px] tabular-nums text-cc-fg @2xl:px-3 ${selectedSurface}`}
          data-testid="thread-tab-group-glide"
          data-group={move.to}
        >
          {/* The thread on screen, not its group: the groups stay where they are. */}
          <span className="truncate">{movingLabel}</span>
        </span>
      )}
      {openGroup && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpenGroup(null)}
            data-testid="thread-tab-group-backdrop"
          />
          <div
            className="absolute inset-x-0 top-full z-50 mt-1 max-h-[60dvh] overflow-y-auto rounded-xl border border-cc-border bg-cc-card py-1 shadow-xl"
            ref={listRef}
            style={{
              ...(listLeft === null ? {} : { left: listLeft, right: "auto", width: WIDE_LIST_WIDTH_PX }),
              ...(listMaxHeight === null ? {} : { maxHeight: `min(60dvh, ${listMaxHeight}px)` }),
            }}
            role="menu"
            data-testid="thread-tab-group-list"
            data-group={openGroup}
          >
            <GroupHeading id={openGroup} count={groups[openGroup].length} />
            {groups[openGroup].map((tab) => (
              <ThreadTabListRow key={tab.threadKey} tab={tab} context={rowContext} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const quietHome: PrimaryThreadChip = {
  threadKey: MAIN_THREAD_KEY,
  title: "Home",
  needsInput: false,
  mutedNeedsInput: false,
  blueNudge: false,
  canClose: false,
  updatedAt: 0,
};

/**
 * The groups as sections of one list, for the leader's Home. Idle shows its newest few, the rest
 * behind "N older".
 */
export function ThreadGroupSections({
  threads,
  context,
  idleLimit = 8,
  only = THREAD_GROUP_ORDER,
  idleExtra,
  renderIdle,
}: {
  threads: readonly PrimaryThreadChip[];
  context: RowContext;
  idleLimit?: number;
  /** The groups to list, in order (all of them by default). */
  only?: readonly ThreadGroupId[];
  /** Beside Idle's heading: a control for how Idle is listed. */
  idleExtra?: ReactNode;
  /** Lists Idle's threads another way (by topic) instead of newest first. */
  renderIdle?: (tabs: readonly PrimaryThreadChip[]) => ReactNode;
}) {
  const groups = groupThreads(threads);
  const [allIdle, setAllIdle] = useState(false);
  return (
    <>
      {only.map((id) => {
        if (groups[id].length === 0) return null;
        if (id === "idle" && renderIdle) {
          return (
            <section
              key={id}
              className="border-t border-cc-border/60 first:border-t-0"
              data-testid="thread-group-section"
              data-group={id}
            >
              <GroupHeading id={id} count={groups[id].length} extra={idleExtra} />
              {renderIdle(groups.idle)}
            </section>
          );
        }
        const shown = id === "idle" && !allIdle ? groups.idle.slice(0, idleLimit) : groups[id];
        return (
          <section
            key={id}
            className="border-t border-cc-border/60 first:border-t-0"
            data-testid="thread-group-section"
            data-group={id}
          >
            <GroupHeading id={id} count={groups[id].length} extra={id === "idle" ? idleExtra : undefined} />
            {shown.map((tab) => (
              <ThreadTabListRow key={tab.threadKey} tab={tab} context={context} />
            ))}
            {shown.length < groups[id].length && (
              <button
                type="button"
                onClick={() => setAllIdle(true)}
                className="w-full px-4 py-2 text-left text-[12.5px] text-cc-muted hover:bg-cc-hover/40"
                data-testid="thread-group-more"
              >
                {groups[id].length - shown.length} older
              </button>
            )}
          </section>
        );
      })}
    </>
  );
}

/** The bell as the groups draw it: an outline in the attention color, nothing when quiet. */
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
 * Marks where the leader is writing right now: a small spinner, so it reads as activity rather than
 * as one more phase-color dot. It holds still when motion is reduced.
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

/** One thread in a group's list: its color, title, quest number and state, Notify Me and bell. */
export function ThreadTabListRow({ tab, context }: { tab: PrimaryThreadChip; context: RowContext }) {
  const threadKey = normalizeThreadKey(tab.threadKey);
  const selected = threadKey === normalizeThreadKey(context.currentThreadKey);
  const openMenu = isHome(tab) ? undefined : context.onOpenMenu?.(tab);
  const longPress = useLongPress(openMenu);
  const monitor = context.monitors?.[threadKey];
  const status = context.threadStatuses?.[threadStatusKey(threadKey)];
  const summary = status?.kind === "ready" ? status.summary : undefined;
  const activeAt = lastActivityAt(tab);
  const line = context.lineOf?.(threadKey);
  // A thread that is not a quest's is named by its title and state; its key means nothing.
  const plainThread = isTopicViewKey(threadKey) && !tab.questId;
  const meta = [
    tab.questId ?? (plainThread ? null : threadKey),
    tab.remindAt !== undefined ? `Remind ${formatSnoozeUntil(tab.remindAt)}` : null,
    tab.stateLabel ?? tab.detail,
    activeAt ? timeAgo(activeAt) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const quiet = tab.completed && !tab.needsInput && !tab.blueNudge;
  const style: CSSProperties = { ...longPress.pressStyle };
  // Home's rows (those with news lines) are two lines, as in the sessions panel's Threads view
  // (Jiayi, Nov 1): the quest number, title and time, then the news line. Their phase line went:
  // the group says where a thread stands, and the news line usually said it again.
  const newsRow = context.lineOf !== undefined;
  const questLabel = tab.questId ?? (plainThread ? null : threadKey);
  const when =
    tab.remindAt !== undefined ? `Remind ${formatSnoozeUntil(tab.remindAt)}` : activeAt ? timeAgo(activeAt) : null;
  return (
    <div
      className={`flex min-h-[3.25rem] items-center gap-3 px-4 py-1.5 ${selected ? "bg-cc-active" : "hover:bg-cc-hover/40"} ${openMenu ? LONG_PRESS_TARGET_CLASS : ""}`}
      style={style}
      {...longPress.handlers}
      data-testid="thread-tab-list-row"
      data-thread-key={threadKey}
      data-selected={selected ? "true" : "false"}
      data-title-color={tab.titleColor ?? ""}
      data-ownership-note={tab.ownershipNote ?? ""}
      data-needs-input={tab.needsInput ? "true" : "false"}
      data-muted-needs-input={tab.mutedNeedsInput ? "true" : "false"}
      data-blue-notification={tab.blueNudge ? "true" : "false"}
      data-active-output={isActiveOutput(tab, context.activeOutputThreadKey) ? "true" : "false"}
      data-side-quest-of={tab.sideQuestOf ?? ""}
      data-remind-at={tab.remindAt ?? ""}
    >
      <button
        type="button"
        onClick={(event) => {
          if (tab.onOpen) tab.onOpen();
          else if (context.onOpenInSide && isOpenInSideClick(event)) context.onOpenInSide(threadKey);
          else context.onSelect(threadKey);
        }}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
        data-testid="thread-tab-list-row-select"
      >
        <span
          className={`h-8 w-1 shrink-0 rounded-full ${THREAD_GROUP_DOT[threadGroupOf(tab)]}`}
          data-testid="thread-tab-list-row-status"
          data-group={threadGroupOf(tab)}
        />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className={`flex min-w-0 items-center gap-1.5 text-[14px] ${quiet ? "text-cc-muted" : "text-cc-fg"}`}>
            {isActiveOutput(tab, context.activeOutputThreadKey) && <ActiveOutputSpinner />}
            {plainThread && <NewThreadIcon className="h-3.5 w-3.5 shrink-0 text-cc-muted" />}
            {tab.ledElsewhere && (
              // Another leader runs this quest now; a list row's meta line names it ("Led by #N").
              <span className="inline-flex shrink-0 text-cc-muted" data-testid="thread-tab-led-elsewhere-icon">
                <SessionRoleIcon role="Leader" />
              </span>
            )}
            {tab.remindAt !== undefined && (
              // Snoozed with "Remind me later": read for now, back when the row says.
              <span className="inline-flex shrink-0 text-cc-muted" data-testid="thread-tab-reminder-icon">
                <ClockIcon />
              </span>
            )}
            {tab.sideQuestOf && (
              // A side quest's answer is given where it was asked, so its thread can usually be skipped.
              <span className="inline-flex shrink-0 text-cc-muted">
                <SideQuestIcon sideQuestOf={tab.sideQuestOf} />
              </span>
            )}
            {newsRow && questLabel && (
              <span
                className="shrink-0 font-mono-code text-[12px] text-cc-muted"
                data-testid="thread-tab-list-row-quest"
              >
                {questLabel}
              </span>
            )}
            <span className="truncate">{tab.title}</span>
            {newsRow && when && (
              <span
                className="ml-auto shrink-0 pl-2 text-[11.5px] tabular-nums text-cc-muted"
                data-testid="thread-tab-list-row-time"
              >
                {when}
              </span>
            )}
          </span>
          {newsRow && (
            <span className="mt-0.5 truncate text-[12.5px] text-cc-fg/75" data-testid="thread-tab-list-row-line">
              {line ?? summary ?? tab.stateLabel ?? tab.detail}
            </span>
          )}
          {!newsRow && (
            <span className="mt-0.5 truncate text-[11.5px]">
              <span
                style={{ color: tab.titleColor }}
                data-testid="thread-tab-list-row-meta"
                data-title-color={tab.titleColor ?? ""}
              >
                {meta}
              </span>
              {summary && <span className="text-cc-muted"> — {summary}</span>}
            </span>
          )}
        </span>
      </button>
      {monitor && <NotifyMeIcon pending={Boolean(monitor.pendingResultId)} className="h-4 w-4" />}
      {newsRow ? (
        // A fixed slot, so the times on the right line up whether or not a row has a bell.
        <span className="flex w-4 shrink-0 justify-center">
          <AttentionBell tab={tab} size="md" />
        </span>
      ) : (
        <AttentionBell tab={tab} size="md" />
      )}
      <span className="-mr-1.5 w-8 shrink-0" />
    </div>
  );
}

function isActiveOutput(tab: PrimaryThreadChip, activeOutputThreadKey: string | null): boolean {
  return !!activeOutputThreadKey && normalizeThreadKey(tab.threadKey) === normalizeThreadKey(activeOutputThreadKey);
}

/** The In progress group's dot: its status color, like every other thread status dot. */
function InProgressDot() {
  return (
    <span
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${THREAD_GROUP_DOT["in-progress"]}`}
      aria-hidden="true"
      data-testid="thread-tab-group-dot"
    />
  );
}

interface BarItemProps {
  label: string;
  selected: boolean;
  selectedSurface: string;
  open?: boolean;
  group?: ThreadGroupId;
  /** How many threads the group holds. */
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

/** One item of the row, drawn as a tab hanging down onto the strip below; the selected one joins it. */
function BarItem({
  label,
  selected,
  selectedSurface,
  open = false,
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
  const tone = selected
    ? `-mb-px border-cc-primary/45 ${selectedSurface} text-cc-fg`
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
      // A narrow bar shares its width evenly; a wide one (`@2xl`, see WIDE_BAR_PX) sizes each tab to its label.
      className={`relative ${layer} inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-t-md border border-b-0 px-1.5 text-[12px] font-normal tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-cc-primary/70 @2xl:min-w-[7.5rem] @2xl:flex-none @2xl:px-3 ${tone} ${onOpenList ? LONG_PRESS_TARGET_CLASS : ""}`}
      aria-label={label}
      aria-selected={selected}
      aria-expanded={group && !single ? open : undefined}
      aria-haspopup={group && !single ? "menu" : undefined}
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

function isTouchPress(pointerType: string): boolean {
  return pointerType === "touch" || pointerType === "pen";
}

/** The group's name, shown before its count where the row has room. */
function WideLabel({ id }: { id: ThreadGroupId }) {
  return <span className="hidden @2xl:inline">{GROUP_LABEL[id]} </span>;
}

function GroupContent({ id, tabs }: { id: ThreadGroupId; tabs: readonly PrimaryThreadChip[] }) {
  if (id === "needs-input" || id === "new-results") {
    const tone = id === "needs-input" ? "text-cc-attention" : "text-cc-info";
    return (
      <>
        <BellIcon className={`h-3 w-3 shrink-0 ${tone}`} />
        <span className={tone}>
          <WideLabel id={id} />
          {tabs.length}
        </span>
      </>
    );
  }
  if (id === "idle") {
    return (
      <>
        {/* A pause: nothing runs here and nothing is unread. */}
        <svg
          viewBox="0 0 16 16"
          className="h-3 w-3 shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          aria-hidden="true"
        >
          <path d="M6 4.5v7M10 4.5v7" strokeLinecap="round" />
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
      {tabs.length > 0 && <InProgressDot />}
      <span>
        <WideLabel id={id} />
        {tabs.length}
      </span>
    </>
  );
}

function GroupHeading({ id, count, extra }: { id: ThreadGroupId; count: number; extra?: ReactNode }) {
  const tone = id === "needs-input" ? "text-cc-attention" : id === "new-results" ? "text-cc-info" : "text-cc-muted";
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 bg-cc-card/95 px-4 pb-1 pt-2.5 backdrop-blur">
      <span className={`text-[11px] uppercase tracking-wide ${tone}`}>{GROUP_LABEL[id]}</span>
      <span className="text-[11px] tabular-nums text-cc-muted">{count}</span>
      {extra && <span className="ml-auto">{extra}</span>}
    </div>
  );
}

/**
 * The most a list opened downward can be tall and still end above the phone's keyboard (the
 * visual viewport's bottom), while `active`; null when it need not be limited.
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
