/**
 * Phone thread tabs as status groups: the bar names only the current tab and shows one
 * chip per kind of tab the user scans for (prompts waiting, unread results, quests in
 * progress, finished). A chip lists its tabs; the current tab opens a switcher sheet with
 * every tab, search by title or quest number, and closing.
 */
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { threadStatusKey, type LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import type { ThreadMonitoringProjectionValue } from "../../shared/thread-monitoring.js";
import { LONG_PRESS_TARGET_CLASS, useLongPress, type OpenContextMenu } from "../hooks/useLongPress.js";
import { ALL_THREADS_KEY, MAIN_THREAD_KEY, normalizeThreadKey } from "../utils/thread-projection.js";
import { timeAgo } from "../utils/quest-helpers.js";
import { BellIcon } from "./GlobalNeedsInputMenu.js";
import { NotifyMeIcon } from "./NotifyMe.js";
import { SessionRoleIcon } from "./SessionRoleLabel.js";
import type { PrimaryThreadChip } from "./WorkBoardThreadTabs.js";

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
 * Splits tabs by what the user looks for. A prompt outranks an unread result; without
 * either, a tab is in progress until its quest is finished. Main joins a group only when
 * it has a prompt or a result. Within a group, the tab that entered it most recently
 * (the server's `groupChangedAt`) comes first, and ties keep the leader's tab order.
 */
export function groupThreadTabs(
  tabs: readonly PrimaryThreadChip[],
  main?: PrimaryThreadChip,
): Record<ThreadTabGroupId, PrimaryThreadChip[]> {
  const groups: Record<ThreadTabGroupId, PrimaryThreadChip[]> = {
    "needs-input": [],
    "new-results": [],
    "in-progress": [],
    done: [],
  };
  if (main?.needsInput) groups["needs-input"].push(main);
  else if (main?.blueNudge) groups["new-results"].push(main);
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
}

/**
 * The phone tab bar: Main, one item per non-empty group, and search. The quest strip
 * below already names the current quest, so the bar only marks which group holds it.
 */
export function ThreadTabGroupBar({ main, tabs, placement = "top", ...rows }: ThreadTabGroupBarProps) {
  const [openGroup, setOpenGroup] = useState<ThreadTabGroupId | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const mainTab = main ?? {
    threadKey: MAIN_THREAD_KEY,
    title: "Main Thread",
    needsInput: false,
    mutedNeedsInput: false,
    blueNudge: false,
    canClose: false,
    updatedAt: 0,
  };
  const groups = groupThreadTabs(tabs, mainTab);
  const currentKey = normalizeThreadKey(rows.currentThreadKey);
  // The All view sits under the Main strip too, so Main is the selected tab there.
  const onMain = currentKey === MAIN_THREAD_KEY || currentKey === ALL_THREADS_KEY;
  const currentGroup = onMain
    ? null
    : (THREAD_TAB_GROUP_ORDER.find((id) =>
        groups[id].some((tab) => normalizeThreadKey(tab.threadKey) === currentKey),
      ) ?? null);
  const select = (threadKey: string) => {
    setOpenGroup(null);
    setSheetOpen(false);
    rows.onSelect(threadKey);
  };
  const rowContext = { ...rows, onSelect: select };
  const barRef = useRef<HTMLDivElement | null>(null);
  const [listLeft, setListLeft] = useState<number | null>(null);

  // On wide screens a group's list opens under its own tab instead of spanning the bar.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!openGroup || !bar || !window.matchMedia(WIDE_LAYOUT_QUERY).matches) {
      setListLeft(null);
      return;
    }
    const tab = bar.querySelector<HTMLElement>(`[data-testid="thread-tab-group-chip"][data-group="${openGroup}"]`);
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
  return (
    <div ref={barRef} className="relative" data-testid="thread-tab-group-bar" data-placement={placement}>
      <div
        className={`flex gap-1 ${placement === "bottom" ? "items-start pb-0.5" : "items-end pt-0.5"}`}
        role="tablist"
      >
        {item("main", {
          label: "Main Thread",
          selected: onMain,
          activeOutput: isActiveOutput(mainTab, rows.activeOutputThreadKey),
          testId: "thread-tab-group-main",
          onClick: () => select(MAIN_THREAD_KEY),
          children: (
            <>
              <span>Main</span>
              <AttentionBell tab={mainTab} />
            </>
          ),
        })}
        {THREAD_TAB_GROUP_ORDER.map((id) =>
          groups[id].length > 0
            ? item(id, {
                label: `${GROUP_LABEL[id]}: ${groups[id].length}`,
                selected: currentGroup === id,
                open: openGroup === id,
                group: id,
                count: groups[id].length,
                activeOutput: groups[id].some((tab) => isActiveOutput(tab, rows.activeOutputThreadKey)),
                testId: "thread-tab-group-chip",
                // A group of one opens its tab directly; its list (with the tab's latest
                // result and menu) stays a long-press or right-click away.
                onClick: () =>
                  groups[id].length === 1
                    ? select(groups[id][0]!.threadKey)
                    : setOpenGroup((open) => (open === id ? null : id)),
                onOpenList: () => setOpenGroup(id),
                single: groups[id].length === 1,
                children: <GroupContent id={id} tabs={groups[id]} />,
              })
            : null,
        )}
        {item("search", {
          label: "Find a tab",
          selected: false,
          open: sheetOpen,
          compact: true,
          testId: "thread-tab-group-search",
          onClick: () => {
            setOpenGroup(null);
            setSheetOpen(true);
          },
          children: (
            <>
              <SearchGlyph />
              <span className="hidden md:inline">Find</span>
            </>
          ),
        })}
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
            style={listLeft === null ? undefined : { left: listLeft, right: "auto", width: WIDE_LIST_WIDTH_PX }}
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
      {sheetOpen && (
        <ThreadTabSwitcherSheet
          main={mainTab}
          groups={groups}
          context={rowContext}
          onClose={() => setSheetOpen(false)}
        />
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
  group?: ThreadTabGroupId;
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
    ? `relative z-10 ${placement === "bottom" ? "-mt-px" : "-mb-px"} border-cc-primary/45 ${selectedSurface} text-cc-fg`
    : open
      ? "border-cc-border bg-cc-hover/70 text-cc-fg"
      : "border-cc-border/70 bg-cc-hover/30 text-cc-muted";
  return (
    <button
      type="button"
      role="tab"
      onClick={onClick}
      {...longPress.handlers}
      style={longPress.pressStyle}
      className={`relative inline-flex items-center justify-center gap-1.5 px-1.5 text-[12px] font-normal tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-cc-primary/70 h-8 border ${size} ${edge} ${tone} ${onOpenList ? LONG_PRESS_TARGET_CLASS : ""}`}
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

function SearchGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" strokeLinecap="round" />
    </svg>
  );
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
  // The phase colors of the first few quests in progress: the color the user scans for.
  return (
    <>
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

/** One tab in a group list or the switcher: its color, title, quest number and state, bell and close. */
function ThreadTabListRow({
  tab,
  context,
  query = "",
}: {
  tab: PrimaryThreadChip;
  context: RowContext;
  query?: string;
}) {
  const threadKey = normalizeThreadKey(tab.threadKey);
  const main = isMain(tab);
  const selected = threadKey === normalizeThreadKey(context.currentThreadKey);
  const openMenu = main ? undefined : context.onOpenMenu?.(tab);
  const longPress = useLongPress(openMenu);
  const monitor = context.monitors?.[threadKey];
  const status = context.threadStatuses?.[threadStatusKey(threadKey)];
  const summary = status?.kind === "ready" ? status.summary : undefined;
  const meta = main
    ? "Main thread"
    : [tab.questId ?? threadKey, tab.stateLabel ?? tab.detail, tab.updatedAt ? timeAgo(tab.updatedAt) : null]
        .filter(Boolean)
        .join(" · ");
  const quiet = tab.completed && !tab.needsInput && !tab.blueNudge;
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
      data-needs-input={tab.needsInput ? "true" : "false"}
      data-muted-needs-input={tab.mutedNeedsInput ? "true" : "false"}
      data-blue-notification={tab.blueNudge ? "true" : "false"}
      data-active-output={isActiveOutput(tab, context.activeOutputThreadKey) ? "true" : "false"}
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
      {context.onClose && tab.canClose ? (
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

function matchesQuery(tab: PrimaryThreadChip, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const number = (tab.questId ?? tab.threadKey).toLowerCase();
  return number.includes(needle) || tab.title.toLowerCase().includes(needle);
}

/**
 * Every tab, Main first, then the groups in order. Search narrows by title or quest
 * number; "Close all" asks once, then closes the finished tabs that can close.
 */
function ThreadTabSwitcherSheet({
  main,
  groups,
  context,
  onClose,
}: {
  main: PrimaryThreadChip;
  groups: Record<ThreadTabGroupId, PrimaryThreadChip[]>;
  context: RowContext;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<ThreadTabGroupId | "all">("all");
  const [query, setQuery] = useState("");
  const [confirmCloseAll, setConfirmCloseAll] = useState(false);
  const total = THREAD_TAB_GROUP_ORDER.reduce((sum, id) => sum + groups[id].filter((tab) => !isMain(tab)).length, 1);
  const showMainRow = filter === "all" && !main.needsInput && !main.blueNudge && matchesQuery(main, query);
  const sections = THREAD_TAB_GROUP_ORDER.filter((id) => filter === "all" || filter === id)
    .map((id) => ({ id, tabs: groups[id].filter((tab) => matchesQuery(tab, query)) }))
    .filter((section) => section.tabs.length > 0);
  const closableDone = groups.done.filter((tab) => tab.canClose);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const closeAll = () => {
    if (!confirmCloseAll) {
      setConfirmCloseAll(true);
      return;
    }
    for (const tab of closableDone) context.onClose?.(normalizeThreadKey(tab.threadKey));
    setConfirmCloseAll(false);
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40 md:items-center md:justify-start md:pt-[10vh]"
      onClick={onClose}
      data-testid="thread-tab-switcher-backdrop"
    >
      <div
        className="flex h-[88dvh] flex-col rounded-t-2xl border-t border-cc-border bg-cc-card shadow-2xl md:h-[75vh] md:w-[36rem] md:rounded-2xl md:border"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-label="All tabs"
        data-testid="thread-tab-switcher"
      >
        <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-cc-border md:hidden" />
        <div className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-2">
          <span className="text-[15px] font-medium text-cc-fg">{total} tabs</span>
          <button type="button" onClick={onClose} className="ml-auto text-[14px] text-cc-primary">
            Done
          </button>
        </div>
        <div className="shrink-0 px-4 pb-2">
          <label className="flex h-10 items-center gap-2 rounded-xl bg-cc-hover/70 px-3 text-cc-muted">
            <svg
              viewBox="0 0 16 16"
              className="h-4 w-4 shrink-0"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              aria-hidden="true"
            >
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5L14 14" strokeLinecap="round" />
            </svg>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Find a tab by title or quest number"
              className="min-w-0 flex-1 bg-transparent text-[16px] text-cc-fg outline-none placeholder:text-[14px] placeholder:text-cc-muted"
              aria-label="Find a tab"
              data-testid="thread-tab-switcher-search"
            />
          </label>
        </div>
        <div className="flex shrink-0 gap-1.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
          {(["all", ...THREAD_TAB_GROUP_ORDER] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-[12px] ${
                filter === id ? "border-cc-primary/50 bg-cc-primary/15 text-cc-fg" : "border-cc-border text-cc-muted"
              }`}
              aria-pressed={filter === id}
              data-testid="thread-tab-switcher-filter"
              data-filter={id}
            >
              {id === "needs-input" && <BellIcon className="h-3 w-3 text-cc-attention" />}
              {id === "new-results" && <BellIcon className="h-3 w-3 text-cc-info" />}
              {id === "all" ? "All" : GROUP_LABEL[id]}
              <span className="tabular-nums text-cc-muted">{id === "all" ? total : groups[id].length}</span>
            </button>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto pb-6">
          {showMainRow && <ThreadTabListRow tab={main} context={context} query={query} />}
          {sections.map((section) => (
            <div key={section.id} data-testid="thread-tab-switcher-section" data-group={section.id}>
              <GroupHeading
                id={section.id}
                count={section.tabs.length}
                action={
                  section.id === "done" && context.onClose && closableDone.length > 0 ? (
                    <button
                      type="button"
                      onClick={closeAll}
                      className="ml-auto text-[12px] text-cc-primary"
                      data-testid="thread-tab-switcher-close-all"
                    >
                      {confirmCloseAll ? `Close ${closableDone.length} tabs?` : "Close all"}
                    </button>
                  ) : undefined
                }
              />
              {section.tabs.map((tab) => (
                <ThreadTabListRow key={tab.threadKey} tab={tab} context={context} query={query} />
              ))}
            </div>
          ))}
          {!showMainRow && sections.length === 0 && (
            <p className="px-4 py-6 text-[13px] text-cc-muted">No tab matches “{query}”.</p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
