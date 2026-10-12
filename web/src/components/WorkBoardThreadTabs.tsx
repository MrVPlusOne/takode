/**
 * Leader thread tabs: the tab data shared with WorkBoardBar and the rail that shows the
 * tabs as status groups (ThreadTabGroups) on every screen size, with the tab menu
 * (close, Notify Me) behind a long-press or right-click on a listed tab.
 */
import { useState } from "react";
import { useStore } from "../store.js";
import type { QuestmasterTask } from "../types.js";
import { threadStatusKey, type LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import { isCompletedJourneyPresentationStatus } from "./QuestJourneyTimeline.js";
import { ALL_THREADS_KEY, MAIN_THREAD_KEY, normalizeThreadKey } from "../utils/thread-projection.js";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu.js";
import { updateThreadMonitoring } from "../api/thread-monitoring.js";
import { THREAD_MONITORING_PROJECTION } from "../../shared/thread-monitoring.js";
import { getSyncedProjectionValue } from "../store-synced-projections.js";
import { ThreadTabGroupBar } from "./ThreadTabGroups.js";

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
  /** True once the quest is finished; the phone tab groups file it under Done. */
  completed?: boolean;
  /** Phase accent for dots and bars, where the title color is tuned for text. */
  accentColor?: string;
  /** The tab's phase or state ("Work", "Done", "Led by #12"), even while it needs input. */
  stateLabel?: string;
  /** Server time the tab last changed status group; the phone groups list the newest first. */
  groupChangedAt?: number;
}

/** The tab to show after closing `threadKey`: the next one in tab order, else Main. */
export function threadKeyToSelectAfterClosing(threadKey: string, tabs: ReadonlyArray<{ threadKey: string }>): string {
  const normalized = normalizeThreadKey(threadKey);
  const closingIndex = tabs.findIndex((tab) => normalizeThreadKey(tab.threadKey) === normalized);
  if (closingIndex < 0) return MAIN_THREAD_KEY;
  return normalizeThreadKey(tabs[closingIndex + 1]?.threadKey ?? MAIN_THREAD_KEY);
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
 * The leader's thread tabs as status groups. Tab titles take the done color once a
 * hydrated Questmaster record says the quest finished, unless a Thread Waiting status
 * says work continues there.
 */
export function ThreadTabRail({
  mainState,
  tabs,
  sessionId,
  currentThreadKey,
  onSelectThread,
  onCloseThreadTab,
  threadStatuses,
}: {
  mainState?: PrimaryThreadChip;
  tabs: PrimaryThreadChip[];
  sessionId: string;
  currentThreadKey: string;
  onSelectThread?: (threadKey: string) => void;
  onCloseThreadTab?: (threadKey: string) => void;
  threadStatuses?: Readonly<Record<string, LeaderThreadStatus>>;
}) {
  const openThread = (threadKey: string) => {
    const target = normalizeThreadKey(threadKey || MAIN_THREAD_KEY);
    const selected = normalizeThreadKey(currentThreadKey || MAIN_THREAD_KEY);
    if (onSelectThread && (selected === ALL_THREADS_KEY || selected !== target)) onSelectThread(target);
  };
  const sessionStatus = useStore((state) => state.sessionStatus.get(sessionId));
  const monitors = useStore(
    (state) => getSyncedProjectionValue(state, THREAD_MONITORING_PROJECTION, sessionId)?.threads,
  );
  const activeTurnRoute = useStore((state) => state.activeTurnRoutes.get(sessionId));
  const runningRoute = sessionStatus === "running" ? activeTurnRoute : null;
  const [tabMenu, setTabMenu] = useState<{ threadKey: string; x: number; y: number } | null>(null);
  const displayedTabs = tabs.map((tab) => {
    const titleColor = displayThreadTabTitleColor(tab, cachedQuestForId(tab.questId), threadStatuses);
    return titleColor === tab.titleColor ? tab : { ...tab, titleColor };
  });

  // Only actions that apply to a tab are offered; a tab with none gets no menu.
  const tabMenuItems = (tab: PrimaryThreadChip): ContextMenuItem[] => {
    const threadKey = normalizeThreadKey(tab.threadKey);
    const items: ContextMenuItem[] = [];
    if (onCloseThreadTab && tab.canClose) {
      items.push({
        label: "Close tab",
        onClick: () => onCloseThreadTab(threadKey),
      });
    }
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
    return items;
  };
  const menuTab = tabMenu ? tabs.find((tab) => normalizeThreadKey(tab.threadKey) === tabMenu.threadKey) : undefined;
  const menuItems = menuTab ? tabMenuItems(menuTab) : [];

  return (
    <div
      className="border-b border-cc-border bg-cc-card px-3 sm:px-4"
      data-testid="thread-tab-rail"
      data-open-tab-count={tabs.length + 1}
    >
      <ThreadTabGroupBar
        main={mainState}
        tabs={displayedTabs}
        currentThreadKey={currentThreadKey}
        activeOutputThreadKey={runningRoute?.threadKey ?? null}
        monitors={monitors}
        threadStatuses={threadStatuses}
        onSelect={openThread}
        onClose={onCloseThreadTab}
        onOpenMenu={(tab) =>
          tabMenuItems(tab).length > 0
            ? (x, y) => setTabMenu({ threadKey: normalizeThreadKey(tab.threadKey), x, y })
            : undefined
        }
      />
      {tabMenu && menuItems.length > 0 && (
        <ContextMenu x={tabMenu.x} y={tabMenu.y} items={menuItems} onClose={() => setTabMenu(null)} />
      )}
    </div>
  );
}
