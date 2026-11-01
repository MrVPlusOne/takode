/**
 * A leader's Home: its threads in one list, the one the user last dealt with first and threads with
 * a question for the user pinned on top, as the sessions panel's Threads view lists every leader's
 * (Jiayi, Nov 1: Home's groups overlapped, an unread quest showing under Unread and Idle). Each
 * thread is listed once; unread and running show in its colour bar and bell, never by moving it.
 * Home has the width for more than the panel: the Scribe's news line in full, the question asked,
 * the worker and what it is doing now for a running quest, and a finished quest's commits.
 */
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { api } from "../../api.js";
import { useStore } from "../../store.js";
import type { SessionActivityPreview } from "../../../server/session-activity-preview.js";
import { resolveLeaderThreadTabsProjection } from "../../utils/leader-thread-tabs-resolver.js";
import { resolveNotificationOwnerThreadKey } from "../../utils/notification-thread.js";
import { timeAgo } from "../../utils/quest-helpers.js";
import { navigateToSessionThread } from "../../utils/routing.js";
import { isOpenInSideClick, openInSide } from "../../utils/side-column.js";
import { ALL_THREADS_KEY, MAIN_THREAD_KEY, normalizeThreadKey } from "../../utils/thread-projection.js";
import { isTopicViewKey } from "../../../shared/topic-thread-key.js";
import { NewThreadIcon } from "../library/library-icons.js";
import { SessionStatusDot } from "../SessionStatusDot.js";
import { participantStatusToDotProps } from "../session-participant-status.js";
import { SideQuestIcon } from "../SideQuestCue.js";
import { ClockIcon, formatSnoozeUntil } from "../RemindLaterChoices.js";
import { ActiveOutputSpinner, AttentionBell, isRunning, THREAD_GROUP_DOT, threadGroupOf } from "../ThreadTabGroups.js";
import type { PrimaryThreadChip } from "../WorkBoardThreadTabs.js";
import { ThreadsByTopic, HomeViewSwitch, useHomeView } from "./HomeExtras.js";

export type HomeFilter = "all" | "needs-input" | "new" | "running";

const FILTERS: ReadonlyArray<{ id: HomeFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "needs-input", label: "Needs you" },
  { id: "new", label: "New" },
  { id: "running", label: "Running" },
];

/** The rows shown before "N older". */
const SHOWN = 40;
/** How often a running worker's latest step is read again while Home is on screen. */
const ACTIVITY_POLL_MS = 5_000;

/** A thread as Home lists it. */
export interface HomeThread {
  tab: PrimaryThreadChip;
  /** When the user last dealt with it: the order, and the time a row shows. 0 when never. */
  at: number;
  /** Its own latest activity: the order between threads the user dealt with at the same time. */
  activityAt: number;
}

/**
 * The leader's threads in Home's order: questions for the user first, then by when the user last
 * dealt with them (`userInteractionAt` from the leader's tab projection; a thread the user started,
 * from its start). Cancelled quests are already left out of the members (`ThreadTabRail`).
 */
export function homeThreadOrder(
  threads: readonly PrimaryThreadChip[],
  userInteractionAt: Readonly<Record<string, number>>,
): HomeThread[] {
  const asking = (thread: HomeThread) => (thread.tab.needsInput ? 1 : 0);
  return threads
    .map((tab) => {
      const key = normalizeThreadKey(tab.threadKey);
      const own = userInteractionAt[key === ALL_THREADS_KEY ? MAIN_THREAD_KEY : key] ?? 0;
      return {
        tab,
        at: Math.max(own, tab.userStartedAt ?? 0),
        activityAt: Math.max(tab.updatedAt, tab.groupChangedAt ?? 0),
      };
    })
    .sort((a, b) => asking(b) - asking(a) || b.at - a.at || b.activityAt - a.activityAt);
}

/** Whether a thread is in a filter: a question, an unread result, or work going on. */
export function inHomeFilter(tab: PrimaryThreadChip, filter: HomeFilter): boolean {
  if (filter === "needs-input") return tab.needsInput;
  if (filter === "new") return tab.blueNudge;
  if (filter === "running") return !tab.attentionOnly && isRunning(tab);
  return true;
}

export function HomeThreadList({
  leaderId,
  threads,
  lineOf,
  writingThreadKey,
}: {
  leaderId: string;
  threads: readonly PrimaryThreadChip[];
  /** The thread's news line (the Scribe's, else a stand-in from the agents' notes). */
  lineOf: (threadKey: string) => string | undefined;
  /** Where the leader is writing now. */
  writingThreadKey: string | null;
}) {
  const userInteractionAt = useStore(
    (state) => resolveLeaderThreadTabsProjection(state, leaderId).value?.userInteractionAt ?? EMPTY_TIMES,
  );
  const ordered = useMemo(() => homeThreadOrder(threads, userInteractionAt), [threads, userInteractionAt]);
  const [filter, setFilter] = useState<HomeFilter>("all");
  const [view, setView] = useHomeView();
  const [all, setAll] = useState(false);
  const listed = ordered.filter((thread) => inHomeFilter(thread.tab, filter));
  const shown = all || view === "topic" ? listed : listed.slice(0, SHOWN);
  const details = useRowDetails(leaderId, shown);
  const open = (threadKey: string, event: MouseEvent) => {
    const tab = shown.find((thread) => normalizeThreadKey(thread.tab.threadKey) === threadKey)?.tab;
    if (tab?.onOpen) tab.onOpen();
    else if (isOpenInSideClick(event)) details.openInSide(threadKey);
    else details.select(threadKey);
  };
  const row = (thread: HomeThread) => (
    <HomeThreadRow
      key={thread.tab.threadKey}
      thread={thread}
      line={lineOf(thread.tab.threadKey)}
      detail={details.of(thread.tab)}
      writing={!!writingThreadKey && normalizeThreadKey(writingThreadKey) === normalizeThreadKey(thread.tab.threadKey)}
      onOpen={open}
    />
  );
  return (
    <section
      className="overflow-hidden rounded-xl border border-cc-border bg-cc-card pb-1"
      data-testid="leader-home-threads"
    >
      <div className="flex flex-wrap items-center gap-1 border-b border-cc-border/60 px-2 py-2 @xl:gap-1.5 @xl:px-3">
        {FILTERS.map(({ id, label }) => {
          const count = id === "all" ? ordered.length : ordered.filter((thread) => inHomeFilter(thread.tab, id)).length;
          if (id !== "all" && count === 0 && filter !== id) return null;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2 text-[12px] transition-colors @xl:px-2.5 ${
                filter === id
                  ? "border-cc-primary/50 bg-cc-primary/10 text-cc-fg"
                  : "border-cc-border/70 text-cc-muted hover:bg-cc-hover/50 hover:text-cc-fg"
              }`}
              aria-pressed={filter === id}
              data-testid="home-filter"
              data-filter={id}
            >
              {id !== "all" && <span className={`h-1.5 w-1.5 rounded-full ${FILTER_DOT[id]}`} />}
              {label}
              <span className="tabular-nums text-cc-muted">{count}</span>
            </button>
          );
        })}
        <span className="ml-auto">
          <HomeViewSwitch value={view} onChange={setView} />
        </span>
      </div>
      {listed.length === 0 ? (
        <p className="px-4 py-6 text-center text-[13px] text-cc-muted" data-testid="home-filter-empty">
          Nothing here now.
        </p>
      ) : view === "topic" ? (
        <ThreadsByTopic leaderId={leaderId} threads={listed} renderRow={row} />
      ) : (
        <>
          {shown.map((thread, index) => (
            <div key={thread.tab.threadKey}>
              {row(thread)}
              {/* A line under the questions kept on top, where the order by recency starts. */}
              {thread.tab.needsInput && shown[index + 1] && !shown[index + 1]!.tab.needsInput && (
                <div className="mx-4 border-t border-cc-border/60" data-testid="home-pinned-end" />
              )}
            </div>
          ))}
          {shown.length < listed.length && (
            <button
              type="button"
              onClick={() => setAll(true)}
              className="w-full px-4 py-2 text-left text-[12.5px] text-cc-muted hover:bg-cc-hover/40"
              data-testid="home-more"
            >
              {listed.length - shown.length} older
            </button>
          )}
        </>
      )}
    </section>
  );
}

const EMPTY_TIMES: Readonly<Record<string, number>> = {};
const FILTER_DOT: Record<Exclude<HomeFilter, "all">, string> = {
  "needs-input": THREAD_GROUP_DOT["needs-input"],
  new: THREAD_GROUP_DOT["new-results"],
  running: THREAD_GROUP_DOT["in-progress"],
};

/** What a row adds under its news line. */
interface RowDetail {
  /** The question waiting for the user there. */
  question?: string;
  /** A running quest's worker: its number and state, and what it is doing now. */
  worker?: { sessionNum: number | null; status: "running" | "idle" | "disconnected" | "archived"; doing?: string };
  /** A finished quest's delivered commits. */
  commits?: number;
}

/** Details for the rows on screen, from what the browser holds, plus each running worker's latest step. */
function useRowDetails(leaderId: string, shown: readonly HomeThread[]) {
  const notifications = useStore((state) => state.sessionNotifications.get(leaderId));
  const rowStatuses = useStore((state) => state.sessionBoardRowStatuses.get(leaderId));
  const previews = useStore((state) => state.questTitlePreviews);
  const workers = shown.flatMap(({ tab }) => {
    const worker = tab.questId && isRunning(tab) ? rowStatuses?.[normalizeThreadKey(tab.questId)]?.worker : undefined;
    return worker && worker.status !== "archived" ? [worker.sessionId] : [];
  });
  const doing = useLatestSteps(workers);
  return {
    select: (threadKey: string) => navigateHome(leaderId, threadKey, false),
    openInSide: (threadKey: string) => navigateHome(leaderId, threadKey, true),
    of: (tab: PrimaryThreadChip): RowDetail => {
      const key = normalizeThreadKey(tab.threadKey);
      const question = tab.needsInput
        ? (notifications ?? []).find(
            (notification) =>
              notification.category === "needs-input" &&
              !notification.done &&
              resolveNotificationOwnerThreadKey(notification) === (key === ALL_THREADS_KEY ? MAIN_THREAD_KEY : key),
          )
        : undefined;
      const questId = tab.questId ? normalizeThreadKey(tab.questId) : null;
      const worker = questId && isRunning(tab) ? rowStatuses?.[questId]?.worker : undefined;
      const commits = questId && tab.completed ? previews.get(questId)?.commitShas?.length : undefined;
      return {
        ...(question ? { question: question.questions?.[0]?.prompt ?? question.summary ?? tab.stateLabel } : {}),
        ...(worker && worker.status !== "archived"
          ? {
              worker: {
                sessionNum: worker.sessionNum ?? null,
                status: worker.status,
                ...(doing[worker.sessionId] ? { doing: doing[worker.sessionId] } : {}),
              },
            }
          : {}),
        ...(commits ? { commits } : {}),
      };
    },
  };
}

function navigateHome(leaderId: string, threadKey: string, side: boolean): void {
  if (side) openInSide({ kind: "conversation", threadKey, leaderId });
  else navigateToSessionThread(leaderId, threadKey);
}

/**
 * Each worker's latest step (a tool call or a line it wrote), read now and again every few seconds
 * while the page is visible; Home lists few running quests, so this stays small.
 */
function useLatestSteps(sessionIds: readonly string[]): Record<string, string> {
  const [steps, setSteps] = useState<Record<string, string>>({});
  const key = [...sessionIds].sort().join(",");
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    const load = () => {
      for (const sessionId of key.split(",")) {
        api
          .getSessionActivityPreview(sessionId)
          .then((preview: SessionActivityPreview) => {
            const last = preview.lines.at(-1);
            if (cancelled || !last) return;
            const text = last.kind === "tool" && last.toolName ? `${last.toolName}: ${last.text}` : last.text;
            setSteps((all) => (all[sessionId] === text ? all : { ...all, [sessionId]: text }));
          })
          .catch((error: Error) => console.warn("[home] Could not load a worker's latest step:", error.message));
      }
    };
    load();
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") load();
    }, ACTIVITY_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [key]);
  return steps;
}

/**
 * One thread: its status bar, quest number, title and time, its news line in full, and what else
 * says where it stands (the question asked, the worker at work, the commits delivered).
 */
function HomeThreadRow({
  thread: { tab, at, activityAt },
  line,
  detail,
  writing,
  onOpen,
}: {
  thread: HomeThread;
  line?: string;
  detail: RowDetail;
  writing: boolean;
  onOpen: (threadKey: string, event: MouseEvent) => void;
}) {
  const threadKey = normalizeThreadKey(tab.threadKey);
  const plainThread = isTopicViewKey(threadKey) && !tab.questId;
  const questLabel = tab.questId ?? (plainThread || threadKey === ALL_THREADS_KEY ? null : threadKey);
  const quiet = tab.completed && !tab.needsInput && !tab.blueNudge;
  const time = tab.remindAt !== undefined ? `Remind ${formatSnoozeUntil(tab.remindAt)}` : timeAgo(at || activityAt);
  const status = statusLine(tab, detail);
  return (
    <button
      type="button"
      onClick={(event) => onOpen(threadKey, event)}
      className="flex w-full items-stretch gap-3 px-4 py-2 text-left hover:bg-cc-hover/40"
      data-testid="home-thread-row"
      data-thread-key={threadKey}
      data-group={threadGroupOf(tab)}
    >
      <span className={`w-1 shrink-0 rounded-full ${THREAD_GROUP_DOT[threadGroupOf(tab)]}`} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 leading-snug">
        <span className={`flex min-w-0 items-center gap-1.5 text-[14px] ${quiet ? "text-cc-muted" : "text-cc-fg"}`}>
          {writing && <ActiveOutputSpinner />}
          {plainThread && <NewThreadIcon className="h-3.5 w-3.5 shrink-0 text-cc-muted" />}
          {tab.remindAt !== undefined && (
            <span className="inline-flex shrink-0 text-cc-muted">
              <ClockIcon />
            </span>
          )}
          {tab.sideQuestOf && (
            <span className="inline-flex shrink-0 text-cc-muted">
              <SideQuestIcon sideQuestOf={tab.sideQuestOf} />
            </span>
          )}
          {questLabel && <span className="shrink-0 font-mono-code text-[12px] text-cc-muted">{questLabel}</span>}
          <span className="truncate">{tab.title}</span>
          <span className="ml-auto shrink-0 pl-2 text-[11.5px] tabular-nums text-cc-muted" data-testid="home-row-time">
            {time}
          </span>
          <span className="flex w-4 shrink-0 justify-center">
            <AttentionBell tab={tab} size="md" />
          </span>
        </span>
        {line && (
          <span className="line-clamp-2 text-[13px] text-cc-fg/80" data-testid="home-row-line">
            {line}
          </span>
        )}
        {status && (
          <span
            className={`flex min-w-0 items-center gap-1.5 text-[12px] ${tab.needsInput ? "text-cc-attention" : "text-cc-muted"}`}
            data-testid="home-row-status"
          >
            {status}
          </span>
        )}
      </span>
    </button>
  );
}

/** The row's last line: the question waiting, else the worker at work, else the state and commits. */
function statusLine(tab: PrimaryThreadChip, detail: RowDetail) {
  if (detail.question) return <span className="truncate">Asks: {detail.question}</span>;
  const state = tab.stateLabel ?? tab.detail;
  // A question another session asks about the quest: its label says who asks and what.
  if (tab.needsInput) return state ? <span className="truncate">{state}</span> : null;
  if (detail.worker) {
    const { sessionNum, status, doing } = detail.worker;
    return (
      <>
        {state && <span className="shrink-0">{state}</span>}
        <span className="shrink-0">·</span>
        <SessionStatusDot {...participantStatusToDotProps(status)} />
        <span className="shrink-0">#{sessionNum ?? "?"}</span>
        {doing && (
          <span className="min-w-0 truncate font-mono-code text-[11.5px]" data-testid="home-row-doing">
            {doing}
          </span>
        )}
      </>
    );
  }
  const parts = [state, detail.commits ? `${detail.commits} ${detail.commits === 1 ? "commit" : "commits"}` : null];
  const text = parts.filter(Boolean).join(" · ");
  return text ? <span className="truncate">{text}</span> : null;
}
