import { isTopicViewKey } from "../../shared/topic-thread-key.js";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useOutsidePress } from "../hooks/useOutsidePress.js";
import { useAttentionThreadTitles, type AttentionThreadTitles } from "../hooks/useAttentionThreadTitles.js";
import { api } from "../api.js";
import { useStore } from "../store.js";
import { navigateToSession, navigateToSessionThread, routeSessionRefForId } from "../utils/routing.js";
import { ALL_THREADS_KEY, MAIN_THREAD_KEY } from "../utils/thread-projection.js";
import { getViewHistory, subscribeViewHistory, type ViewedTab } from "../utils/view-history.js";
import { formatRelativeTime } from "./AttentionKind.js";

/** The parts of the Navigation API used here; TypeScript's DOM types do not include it yet. */
interface NavigationLike extends EventTarget {
  canGoBack: boolean;
  canGoForward: boolean;
}

function browserNavigation(): NavigationLike | undefined {
  return (window as unknown as { navigation?: NavigationLike }).navigation;
}

function subscribeNavigation(onChange: () => void): () => void {
  const navigation = browserNavigation();
  if (!navigation) return () => {};
  navigation.addEventListener("currententrychange", onChange);
  return () => navigation.removeEventListener("currententrychange", onChange);
}

/**
 * Whether browser history has a step back or forward inside Takode. Browsers without the
 * Navigation API cannot tell, so both stay available there.
 */
export function useHistoryAvailability(): { canGoBack: boolean; canGoForward: boolean } {
  const canGoBack = useSyncExternalStore(subscribeNavigation, () => browserNavigation()?.canGoBack ?? true);
  const canGoForward = useSyncExternalStore(subscribeNavigation, () => browserNavigation()?.canGoForward ?? true);
  return { canGoBack, canGoForward };
}

/**
 * Back, forward and recently viewed tabs, for the desktop's top-left corner: one outlined
 * control of equal cells. Back and forward walk the browser's own history, the same steps as its
 * buttons and gestures; the history list opens a tab the user viewed recently, newest first.
 */
export function NavigationButtons() {
  const { canGoBack, canGoForward } = useHistoryAvailability();
  const [historyOpen, setHistoryOpen] = useState(false);
  const groupRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={groupRef}
      role="group"
      aria-label="Navigation"
      className="flex shrink-0 items-center divide-x divide-cc-border/60 rounded-lg border border-cc-border/70 bg-cc-card/60"
      data-testid="navigation-buttons"
    >
      <button
        type="button"
        onClick={() => history.back()}
        disabled={!canGoBack}
        className={CELL_CLASS}
        aria-label="Back"
        title="Back"
      >
        <ChevronIcon direction="left" />
      </button>
      <button
        type="button"
        onClick={() => history.forward()}
        disabled={!canGoForward}
        className={CELL_CLASS}
        aria-label="Forward"
        title="Forward"
      >
        <ChevronIcon direction="right" />
      </button>
      <button
        type="button"
        onClick={() => setHistoryOpen((open) => !open)}
        className={`${CELL_CLASS} ${historyOpen ? "bg-cc-active text-cc-fg" : ""}`}
        aria-label="Recently viewed"
        aria-expanded={historyOpen}
        title="Recently viewed"
      >
        <HistoryIcon />
      </button>
      {historyOpen && <NavigationHistoryPanel trigger={groupRef.current} onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}

const CELL_CLASS =
  "flex h-7 w-8 items-center justify-center text-cc-muted transition-colors first:rounded-l-[7px] last:rounded-r-[7px] enabled:cursor-pointer enabled:hover:bg-cc-hover enabled:hover:text-cc-fg disabled:opacity-35";

/**
 * The recently viewed list. The tab on screen sits first, marked as current. `inline` renders
 * in place for the Playground, which passes its own entries, sessions and titles.
 */
export function NavigationHistoryPanel({
  trigger,
  onClose,
  entriesOverride,
  sessionsOverride,
  threadsOverride,
  inline = false,
}: {
  trigger?: HTMLElement | null;
  onClose: () => void;
  entriesOverride?: readonly ViewedTab[];
  sessionsOverride?: ReadonlyArray<{ sessionId: string; sessionNum?: number | null; name?: string }>;
  threadsOverride?: AttentionThreadTitles;
  inline?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const storedEntries = useSyncExternalStore(subscribeViewHistory, getViewHistory);
  const sdkSessions = useStore((s) => s.sdkSessions);
  const sessions = sessionsOverride ?? sdkSessions;
  const sessionById = useMemo(() => new Map(sessions.map((session) => [session.sessionId, session])), [sessions]);
  // Sessions deleted since are left out; archived ones still open.
  const entries = useMemo(
    () => (entriesOverride ?? storedEntries).filter((entry) => sessionById.has(entry.sessionId)),
    [entriesOverride, storedEntries, sessionById],
  );
  const storeThreads = useAttentionThreadTitles(entries);
  const threads = threadsOverride ?? storeThreads;
  const currentKey = entries[0] ? viewedTabKey(entries[0]) : null;

  useOutsidePress([panelRef, trigger], onClose, !inline);
  useEffect(() => {
    if (inline) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [inline, onClose]);

  const anchor = trigger?.getBoundingClientRect();
  const open = (entry: ViewedTab) => {
    onClose();
    if (inline) return;
    openViewedTab(entry, sdkSessions);
  };

  const panel = (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Recently viewed"
      data-testid="navigation-history-panel"
      style={inline || !anchor ? undefined : { left: anchor.left, top: anchor.bottom + 6 }}
      className={`flex flex-col overflow-hidden rounded-xl border border-cc-border bg-cc-card shadow-[0_18px_45px_rgba(0,0,0,0.28)] font-sans-ui ${
        inline ? "w-full max-h-[28rem]" : "fixed z-50 w-[22rem] max-h-[min(70dvh,30rem)]"
      }`}
    >
      <div className="border-b border-cc-border/50 px-3 py-2 text-[12px] font-medium text-cc-fg">Recently viewed</div>
      {entries.length === 0 ? (
        <p className="px-3 py-4 text-[12px] text-cc-muted">Tabs you open will show here.</p>
      ) : (
        <ul className="overflow-y-auto py-1">
          {entries.map((entry) => {
            const key = viewedTabKey(entry);
            const current = key === currentKey;
            const session = sessionById.get(entry.sessionId);
            const tag = session?.sessionNum ? `#${session.sessionNum}` : "";
            const row = describeViewedTab(entry, session?.name, tag, threads);
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => open(entry)}
                  aria-current={current ? "page" : undefined}
                  className={`flex w-full min-w-0 flex-col gap-0.5 px-3 py-1.5 text-left transition-colors cursor-pointer ${
                    current ? "bg-cc-active" : "hover:bg-cc-hover"
                  }`}
                  data-testid="navigation-history-row"
                >
                  <span className="flex w-full min-w-0 items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate text-[12px] text-cc-fg">{row.title}</span>
                    <span className="shrink-0 text-[10px] text-cc-muted tabular-nums">
                      {current ? "Current" : formatRelativeTime(entry.viewedAt)}
                    </span>
                  </span>
                  <span className="min-w-0 truncate text-[10px] text-cc-muted">
                    {row.thread && <span className="font-medium text-cc-fg/70">{row.thread} </span>}
                    {row.place}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
  return inline ? panel : createPortal(panel, document.body);
}

function viewedTabKey(entry: ViewedTab): string {
  return `${entry.sessionId}:${entry.threadKey ?? ""}`;
}

/**
 * A row's two lines. The first names what was on screen: the quest's title, Main, All Threads,
 * or the session for sessions without thread tabs. The second says where: the quest ID and the
 * leader session, or the session number.
 */
function describeViewedTab(
  entry: ViewedTab,
  sessionName: string | undefined,
  sessionTag: string,
  threads: AttentionThreadTitles,
): { title: string; thread: string | null; place: string } {
  const sessionLabel = [sessionTag, sessionName].filter(Boolean).join(" ");
  const key = entry.threadKey;
  if (!key) return { title: sessionName || sessionTag || "Session", thread: null, place: sessionTag };
  if (key === MAIN_THREAD_KEY) return { title: "Main", thread: null, place: sessionLabel };
  if (key === ALL_THREADS_KEY) return { title: "All Threads", thread: null, place: sessionLabel };
  return {
    title: threads.titleFor(entry.sessionId, key) || key,
    // A quest's ID helps tell quests apart; a topic's conversation is named by its topic alone.
    thread: isTopicViewKey(key) ? null : key,
    place: sessionTag ? `· ${sessionLabel}` : sessionLabel,
  };
}

/** Opens a viewed tab the way the attention list opens a thread or session. */
function openViewedTab(entry: ViewedTab, sdkSessions: Parameters<typeof routeSessionRefForId>[1]): void {
  if (entry.threadKey) {
    navigateToSessionThread(
      entry.sessionId,
      entry.threadKey,
      false,
      routeSessionRefForId(entry.sessionId, sdkSessions),
      // Without an explicit Main route a leader restores the tab it showed last instead.
      { preserveMainThreadRoute: true },
    );
    return;
  }
  // Same as choosing the session in the sidebar: opening it reads its unread result.
  api.markSessionRead?.(entry.sessionId, { mode: "session-view" }).catch((error: unknown) => {
    console.warn("[navigation-history] failed to mark session read:", error);
  });
  navigateToSession(entry.sessionId);
}

function ChevronIcon({ direction }: { direction: "left" | "right" }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d={direction === "left" ? "M10 3.5L5.5 8 10 12.5" : "M6 3.5L10.5 8 6 12.5"} />
    </svg>
  );
}

function HistoryIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M2.75 8a5.25 5.25 0 1 0 1.54-3.71" />
      <path d="M2.5 2.5v2.25h2.25" />
      <path d="M8 5.25V8l1.9 1.4" />
    </svg>
  );
}
