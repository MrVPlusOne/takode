/**
 * A leader's threads: the thread data shared with WorkBoardBar and the rail that turns it into the
 * status row (every thread of the leader by what it needs), with the Board button in the top bar and
 * the row menu (Notify Me) behind a long-press or right-click on a listed thread.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { isTopicViewKey } from "../../shared/topic-thread-key.js";
import { useStore } from "../store.js";
import { resolveLeaderThreadTabsProjection } from "../utils/leader-thread-tabs-resolver.js";
import type { QuestmasterTask } from "../types.js";
import {
  canonicalThreadStatusKey,
  threadStatusKey,
  type LeaderThreadStatus,
} from "../../shared/thread-status-marker.js";
import { isCompletedJourneyPresentationStatus } from "./QuestJourneyTimeline.js";
import { ALL_THREADS_KEY, MAIN_THREAD_KEY, normalizeThreadKey } from "../utils/thread-projection.js";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu.js";
import { updateThreadMonitoring } from "../api/thread-monitoring.js";
import { THREAD_MONITORING_PROJECTION } from "../../shared/thread-monitoring.js";
import { getSyncedProjectionValue } from "../store-synced-projections.js";
import { useCancelledQuestIds } from "../utils/cancelled-quests.js";
import { plainThreadChip, ThreadGroupBar } from "./ThreadTabGroups.js";
import { useLeaderThreads } from "../utils/leader-topics.js";
import { openInSide } from "../utils/side-column.js";
import { resolveNotificationOwnerThreadKey } from "../utils/notification-thread.js";
import { useDesktopShellLayout } from "../hooks/useDesktopShellLayout.js";
import { useGlobalNeedsInputEntries } from "../hooks/useGlobalNeedsInputEntries.js";
import { openAttentionItem } from "../hooks/useNextAttention.js";
import type { GlobalNeedsInputEntry } from "../utils/global-needs-input.js";
import { questOf } from "./library/topic-questions.js";
import type { BoardPhaseDot } from "./leader-board-summary.js";
import { LeaderBoardButton } from "./leader-workboard-controls.js";
import { threadMenuItems } from "../utils/attention-item-menu.js";

/** Find's Messages mode lists this many of the user's latest messages. */

export const DONE_THREAD_TITLE_COLOR = "var(--color-cc-muted)";
const NORMAL_THREAD_TITLE_COLOR = "var(--color-cc-fg)";
export const QUEUED_THREAD_TITLE_COLOR = "var(--color-cc-fg)";

export function isSelectedThread(currentThreadKey: string, targetThreadKey: string): boolean {
  return normalizeThreadKey(currentThreadKey) === normalizeThreadKey(targetThreadKey);
}

export function ThreadNavButton({
  label,
  detail,
  selected,
  onClick,
  testId,
  variant = "card",
  secondary = false,
}: {
  label: string;
  detail?: string;
  selected: boolean;
  onClick: () => void;
  testId: string;
  variant?: "card" | "compact";
  secondary?: boolean;
}) {
  const compact = variant === "compact";
  const tone = selected
    ? "border-cc-primary/45 bg-cc-primary/12 text-cc-fg"
    : secondary
      ? "border-cc-border/45 bg-transparent text-cc-muted hover:bg-cc-hover/45 hover:text-cc-fg"
      : "border-cc-border/70 bg-cc-hover/35 text-cc-muted hover:bg-cc-hover/65 hover:text-cc-fg";
  const detailClass = compact
    ? "hidden shrink-0 text-[10px] text-cc-muted/75 sm:inline"
    : "block truncate text-[10px] text-cc-muted/80";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${compact ? "inline-flex gap-1.5 px-2 py-1" : "flex gap-2 px-2.5 py-1.5"} min-w-0 items-center rounded-md border text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/70 focus-visible:ring-inset ${tone}`}
      data-testid={testId}
      data-variant={variant}
      aria-pressed={selected}
    >
      <span className={compact ? "min-w-0 truncate text-[11px] font-medium" : "min-w-0"}>
        {compact ? label : <span className="block truncate text-[11px] font-medium">{label}</span>}
        {detail && <span className={detailClass}>{detail}</span>}
      </span>
    </button>
  );
}

export interface PrimaryThreadChip {
  threadKey: string;
  questId?: string;
  title: string;
  detail?: string;
  needsInput: boolean;
  mutedNeedsInput: boolean;
  blueNudge: boolean;
  titleColor?: string;
  projectedCurrentState?: boolean;
  /** Set when this leader does not run the quest, such as "Led by #12"; the tab stays muted. */
  ownershipNote?: string;
  /** True when another leader's board now runs the quest. */
  ledElsewhere?: boolean;
  canClose: boolean;
  updatedAt: number;
  /** True once the quest is finished. */
  completed?: boolean;
  /**
   * Work is going on in it now: the quest runs (the board's running rule) or the leader is writing
   * there. Only such threads are In progress; others are Idle. Unset, an unfinished quest counts.
   */
  running?: boolean;
  /** Phase accent for dots and bars, where the title color is tuned for text. */
  accentColor?: string;
  /** The tab's phase or state ("Work", "Done", "Led by #12"), even while it needs input. */
  stateLabel?: string;
  /**
   * Opens what the item is about instead of its thread: a question another session asks about the
   * leader's quest opens that question.
   */
  onOpen?: () => void;
  /**
   * Not a thread whose work goes on (the leader log, a question about a quest without a tab): listed
   * under Needs you or Unread only, never In progress or Idle.
   */
  attentionOnly?: boolean;
  /** Server time the tab last changed status group; the phone groups list the newest first. */
  groupChangedAt?: number;
  /** Set for a side quest: the thread ("main" or a quest ID) where its answer is given. */
  sideQuestOf?: string;
  /** Set while a "Remind me later" is pending: when the thread comes back. */
  remindAt?: number;
  /** A thread the user started: when, which counts as dealing with it (Home's order). */
  userStartedAt?: number;
  /** A thread that is not a quest's: its current status (quest tabs take theirs from the projection). */
  threadStatus?: LeaderThreadStatus;
}

function displayThreadTabTitleColor(
  tab: PrimaryThreadChip,
  hydratedQuest: QuestmasterTask | undefined,
  statuses: Readonly<Record<string, LeaderThreadStatus>> | undefined,
): string | undefined {
  if (tab.ownershipNote) return tab.titleColor;
  const hydratedTitleColor =
    hydratedQuest && isCompletedJourneyPresentationStatus(hydratedQuest.status) ? DONE_THREAD_TITLE_COLOR : undefined;
  const baseTitleColor = tab.projectedCurrentState ? tab.titleColor : (hydratedTitleColor ?? tab.titleColor);
  return baseTitleColor === DONE_THREAD_TITLE_COLOR && statuses?.[threadStatusKey(tab.threadKey)]?.kind === "waiting"
    ? NORMAL_THREAD_TITLE_COLOR
    : baseTitleColor;
}

function cachedQuestForId(questId: string | undefined): QuestmasterTask | undefined {
  if (!questId) return undefined;
  const normalizedQuestId = normalizeThreadKey(questId);
  const state = useStore.getState();
  return (
    state.questDetails?.get(normalizedQuestId) ??
    state.quests.find((quest) => normalizeThreadKey(quest.questId) === normalizedQuestId)
  );
}

/**
 * The leader's threads as its status row and Home list them. Tab titles take the done color once
 * a hydrated Questmaster record says the quest finished, unless a Thread Waiting status says work
 * continues there. Besides its quest threads (`tabs`), they are the leader's other threads, the
 * leader log while something from Main still waits there, and questions other sessions ask about
 * its quests (which open the question).
 */
export function useLeaderThreadChips({
  sessionId,
  tabs,
  mainState,
  currentThreadKey,
  threadStatuses,
}: {
  sessionId: string;
  tabs: readonly PrimaryThreadChip[];
  mainState?: PrimaryThreadChip;
  currentThreadKey: string;
  threadStatuses?: Readonly<Record<string, LeaderThreadStatus>>;
}): PrimaryThreadChip[] {
  const sessionStatus = useStore((state) => state.sessionStatus.get(sessionId));
  const activeTurnRoute = useStore((state) => state.activeTurnRoutes.get(sessionId));
  const runningRoute = sessionStatus === "running" ? activeTurnRoute : null;
  // Cancelled quests leave the row (and Home, which lists the same members).
  const cancelled = useCancelledQuestIds(tabs.map((tab) => tab.questId));
  const displayedTabs = tabs
    .filter((tab) => !(tab.questId && cancelled.has(normalizeThreadKey(tab.questId))))
    .map((tab) => {
      const titleColor = displayThreadTabTitleColor(tab, cachedQuestForId(tab.questId), threadStatuses);
      return titleColor === tab.titleColor ? tab : { ...tab, titleColor };
    });
  const currentKey = normalizeThreadKey(currentThreadKey || MAIN_THREAD_KEY);
  const notifications = useStore((state) => state.sessionNotifications?.get(sessionId));
  // Statuses that changed since the thread list loaded, which take its place.
  const liveStatuses = useStore((state) => state.threadStatuses?.get(sessionId));
  // The leader's other threads. Asked again when an answer in a thread arrives or is read: the
  // leader names a thread with its first answer, and the Scribe may file or join it.
  const threadAnswers = (notifications ?? [])
    .filter((notification) => notification.category === "review" && !notification.done)
    .map((notification) => resolveNotificationOwnerThreadKey(notification))
    .filter(isTopicViewKey)
    .join(",");
  const plainThreads = useLeaderThreads(sessionId, true, `${currentKey}|${threadAnswers}`);
  const boardQuests = useStore(useShallow((state) => leaderQuestIds(state, sessionId)));
  // In progress follows the board's running rule (`runningQuestIds`, absent from older servers).
  const runningKey = useStore(
    (state) =>
      resolveLeaderThreadTabsProjection(state, sessionId).value?.runningQuestIds?.map(normalizeThreadKey).join(",") ??
      null,
  );
  const writingKey = runningRoute?.threadKey ? normalizeThreadKey(runningRoute.threadKey) : null;
  const questions = useOthersQuestions(sessionId, displayedTabs, boardQuests);
  const threads = useMemo(() => {
    const questionOf = new Map(questions.map((question) => [question.questId, question]));
    const running = runningKey === null ? null : new Set(runningKey ? runningKey.split(",") : []);
    const members: PrimaryThreadChip[] = displayedTabs.map((raw) => {
      const key = normalizeThreadKey(raw.questId ?? raw.threadKey);
      const tab = running ? { ...raw, running: running.has(key) || writingKey === key } : raw;
      const question = questionOf.get(key);
      if (!question || tab.needsInput) return tab;
      questionOf.delete(question.questId);
      return { ...tab, needsInput: true, stateLabel: question.label, onOpen: question.open };
    });
    for (const thread of plainThreads) {
      if (thread.empty) continue;
      const key = canonicalThreadStatusKey(thread.key);
      const status = liveStatuses?.has(key) ? (liveStatuses.get(key) ?? undefined) : thread.status;
      members.push(plainThreadChip({ ...thread, status }, notifications, writingKey === thread.key));
    }
    // A question or answer still in Main (from before Home) is read in the leader log.
    if (mainState && (mainState.needsInput || mainState.blueNudge)) {
      members.push({
        ...mainState,
        threadKey: ALL_THREADS_KEY,
        title: "Leader log",
        stateLabel: "Main's messages",
        attentionOnly: true,
      });
    }
    for (const question of questionOf.values()) {
      members.push({
        threadKey: question.questId,
        questId: question.questId,
        title: question.title,
        stateLabel: question.label,
        needsInput: true,
        mutedNeedsInput: false,
        blueNudge: false,
        canClose: false,
        updatedAt: question.timestamp,
        onOpen: question.open,
        attentionOnly: true,
      });
    }
    return members;
  }, [displayedTabs, plainThreads, notifications, liveStatuses, mainState, questions, runningKey, writingKey]);
  return threads;
}

/** The leader's threads as the status row (`useLeaderThreadChips`), which Home lists too. */
export function ThreadTabRail({
  mainState,
  tabs,
  sessionId,
  currentThreadKey,
  onSelectThread,
  threadStatuses,
  board,
}: {
  /** The top bar's Board button: where it goes, its dots, and the board's state. */
  board: { helpers: HTMLElement | null; dots: readonly BoardPhaseDot[]; open: boolean; onToggle: () => void };
  mainState?: PrimaryThreadChip;
  tabs: PrimaryThreadChip[];
  sessionId: string;
  currentThreadKey: string;
  onSelectThread?: (threadKey: string) => void;
  threadStatuses?: Readonly<Record<string, LeaderThreadStatus>>;
}) {
  const openThread = (threadKey: string) => {
    const target = normalizeThreadKey(threadKey || MAIN_THREAD_KEY);
    const selected = normalizeThreadKey(currentThreadKey || MAIN_THREAD_KEY);
    if (onSelectThread && (selected === ALL_THREADS_KEY || selected !== target)) onSelectThread(target);
  };
  const desktop = useDesktopShellLayout();
  const sessionStatus = useStore((state) => state.sessionStatus.get(sessionId));
  const monitors = useStore(
    (state) => getSyncedProjectionValue(state, THREAD_MONITORING_PROJECTION, sessionId)?.threads,
  );
  const activeTurnRoute = useStore((state) => state.activeTurnRoutes.get(sessionId));
  const runningRoute = sessionStatus === "running" ? activeTurnRoute : null;
  const [tabMenu, setTabMenu] = useState<{ threadKey: string; x: number; y: number } | null>(null);

  // Only actions that apply to a thread are offered: Notify Me for a quest, then opening it beside,
  // its worker, a reminder and a link. The leader log and a question from another session (which
  // opens the question) get none.
  const tabMenuItems = (tab: PrimaryThreadChip): ContextMenuItem[] => {
    const threadKey = normalizeThreadKey(tab.threadKey);
    if (tab.onOpen || threadKey === ALL_THREADS_KEY) return [];
    const items: ContextMenuItem[] = [];
    // Notify Me tracks quest threads only, and its current state comes from the server projection.
    if (monitors && /^q-\d+$/.test(threadKey)) {
      const monitor = monitors[threadKey];
      const pendingResultId = monitor?.pendingResultId ?? undefined;
      const action = !monitor ? "track" : pendingResultId ? "acknowledge" : "untrack";
      items.push({
        label: {
          track: "Notify Me",
          untrack: "Turn off Notify Me",
          acknowledge: "Acknowledge result",
        }[action],
        onClick: () => {
          updateThreadMonitoring(sessionId, threadKey, action, pendingResultId).catch((error) =>
            console.error("[thread-tabs] Notify Me update failed:", error),
          );
        },
      });
    }
    const boardRow = useStore
      .getState()
      .sessionBoards.get(sessionId)
      ?.find((row) => row.questId === threadKey);
    items.push(
      ...threadMenuItems({
        leaderId: sessionId,
        threadKey,
        ...(boardRow?.worker ? { workerId: boardRow.worker, workerNum: boardRow.workerNum } : {}),
      }),
    );
    return items;
  };
  const threads = useLeaderThreadChips({ sessionId, tabs, mainState, currentThreadKey, threadStatuses });
  // Home lists the same threads at full width.
  useEffect(() => {
    useLeaderThreadMembers.setState((state) => ({ byLeader: { ...state.byLeader, [sessionId]: threads } }));
  }, [sessionId, threads]);
  const menuTab = tabMenu ? threads.find((tab) => normalizeThreadKey(tab.threadKey) === tabMenu.threadKey) : undefined;
  const menuItems = menuTab ? tabMenuItems(menuTab) : [];

  return (
    <div
      className="contents"
      data-testid="thread-tab-rail"
      data-session-id={sessionId}
      data-open-tab-count={tabs.length + 1}
    >
      <ThreadGroupBar
        // Desktop is short on height, so its row is slimmer (Jiayi, Nov 1); phones keep theirs.
        slim={desktop}
        threads={threads}
        leaderId={sessionId}
        currentThreadKey={currentThreadKey}
        activeOutputThreadKey={runningRoute?.threadKey ?? null}
        monitors={monitors}
        threadStatuses={threadStatuses}
        onSelect={openThread}
        // The open-in-side click on a listed thread puts its conversation in the side column.
        onOpenInSide={(threadKey) => openInSide({ kind: "conversation", threadKey, leaderId: sessionId })}
        onOpenMenu={(tab) =>
          tabMenuItems(tab).length > 0
            ? (x: number, y: number) => setTabMenu({ threadKey: normalizeThreadKey(tab.threadKey), x, y })
            : undefined
        }
      />
      {board.helpers &&
        createPortal(
          <LeaderBoardButton dots={board.dots} open={board.open} onToggle={board.onToggle} desktop={desktop} />,
          board.helpers,
        )}
      {tabMenu && menuItems.length > 0 && (
        <ContextMenu x={tabMenu.x} y={tabMenu.y} items={menuItems} onClose={() => setTabMenu(null)} />
      )}
    </div>
  );
}

/** Each leader's threads as its status row last built them, for its Home. */
export const useLeaderThreadMembers = create<{ byLeader: Record<string, readonly PrimaryThreadChip[]> }>(() => ({
  byLeader: {},
}));

/** The leader's quests on its boards (active and completed), as one string for a stable selector. */
function leaderQuestIds(state: ReturnType<typeof useStore.getState>, sessionId: string): string[] {
  return [...(state.sessionBoards.get(sessionId) ?? []), ...(state.sessionCompletedBoards.get(sessionId) ?? [])].map(
    (row) => normalizeThreadKey(row.questId),
  );
}

interface OthersQuestion {
  questId: string;
  title: string;
  label: string;
  timestamp: number;
  open: () => void;
}

/**
 * Questions other sessions (a worker, a reviewer) ask the user about the leader's quests, newest
 * first, one per quest: they belong under the leader's Needs you even though the leader didn't ask.
 */
function useOthersQuestions(
  sessionId: string,
  tabs: readonly PrimaryThreadChip[],
  boardQuests: readonly string[],
): OthersQuestion[] {
  const { entries } = useGlobalNeedsInputEntries();
  return useMemo(() => {
    const ownQuests = new Set([
      ...boardQuests,
      ...tabs.flatMap((tab) => (tab.questId ? [normalizeThreadKey(tab.questId)] : [])),
    ]);
    const byQuest = new Map<string, OthersQuestion>();
    for (const entry of [...entries].sort((a, b) => b.notification.timestamp - a.notification.timestamp)) {
      if (entry.sessionId === sessionId) continue;
      const questId = questOf(entry);
      if (!questId || !ownQuests.has(questId) || byQuest.has(questId)) continue;
      byQuest.set(questId, othersQuestion(entry, questId, tabs));
    }
    return [...byQuest.values()];
  }, [entries, sessionId, tabs, boardQuests]);
}

function othersQuestion(entry: GlobalNeedsInputEntry, questId: string, tabs: readonly PrimaryThreadChip[]) {
  const tab = tabs.find((candidate) => normalizeThreadKey(candidate.questId ?? candidate.threadKey) === questId);
  const asker = entry.sessionNum !== null ? `#${entry.sessionNum}` : entry.sessionName;
  return {
    questId,
    title: tab?.title ?? entry.notification.summary ?? questId,
    label: `Question from ${asker}`,
    timestamp: entry.notification.timestamp,
    open: () =>
      openAttentionItem(
        {
          kind: "needs-input",
          entry,
          key: `needs-input:${entry.sessionId}:${entry.notification.id}`,
          sessionId: entry.sessionId,
          threadKey: resolveNotificationOwnerThreadKey(entry.notification),
          label: entry.notification.summary || entry.sessionName,
          timestamp: entry.notification.timestamp,
        },
        useStore.getState().sdkSessions,
      ),
  };
}
