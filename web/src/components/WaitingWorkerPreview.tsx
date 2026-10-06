import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { api } from "../api.js";
import { useStore } from "../store.js";
import type { SessionActivityPreview } from "../../server/session-activity-preview.js";
import type { BoardRowSessionStatus } from "../types.js";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import { isQuestThreadKey } from "../../shared/thread-routing.js";
import {
  formatQuestJourneyDuration,
  getQuestJourneyCurrentPhaseIndex,
  getQuestJourneyPhase,
} from "../../shared/quest-journey.js";
import { selectLeaderThreadStatuses } from "../utils/leader-thread-tabs-resolver.js";
import { normalizeThreadKey } from "../utils/thread-projection.js";
import { navigateToSession, navigateToSessionMessage } from "../utils/routing.js";
import { getVisibleCurrentThreadStatuses } from "./MessageFeedThreadStatus.js";
import type { BoardRowData } from "./BoardTable.js";

/** How long the panel survives a cleared thread status after the leader stops generating. */
export const WAITING_WORKER_PREVIEW_HOLD_MS = 5_000;
const POLL_INTERVAL_MS = 3_000;
const CLOCK_TICK_MS = 5_000;
const COLLAPSED_STORAGE_KEY = "cc-worker-preview-collapsed";
const PHONE_WIDTH_QUERY = "(max-width: 639px)";

export type WaitingWorkerStatus = "running" | "idle" | "disconnected";

export interface WaitingWorkerTarget {
  questId: string;
  workerSessionId: string;
  workerNum: number | null;
  workerStatus: WaitingWorkerStatus;
  phaseLabel: string | null;
  phaseStartedAt: number | null;
}

/**
 * `soft` means the worker is still assigned but the thread has no current status,
 * which happens transiently while the leader acts in the thread before writing a
 * new marker. Only `soft` may be held to avoid flashing; everything else is exact.
 */
export type WaitingWorkerGate =
  | { kind: "show"; target: WaitingWorkerTarget }
  | { kind: "soft"; target: WaitingWorkerTarget }
  | { kind: "hide" };

export function resolveWaitingWorkerGate(input: {
  threadKey: string;
  statuses: Readonly<Record<string, LeaderThreadStatus>> | undefined;
  boardRows: readonly BoardRowData[] | undefined;
  rowStatuses: Readonly<Record<string, BoardRowSessionStatus>> | undefined;
}): WaitingWorkerGate {
  const threadKey = normalizeThreadKey(input.threadKey);
  if (!isQuestThreadKey(threadKey)) return { kind: "hide" };
  const row = input.boardRows?.find((candidate) => candidate.questId.toLowerCase() === threadKey);
  if (!row || row.completedAt !== undefined) return { kind: "hide" };
  const participant = input.rowStatuses?.[row.questId]?.worker;
  const workerSessionId = participant?.sessionId ?? row.worker;
  if (!workerSessionId || participant?.status === "archived") return { kind: "hide" };

  const phaseIndex = getQuestJourneyCurrentPhaseIndex(row.journey, row.status);
  const phaseStartedAt =
    phaseIndex === undefined ? undefined : row.journey?.phaseTimings?.[String(phaseIndex)]?.startedAt;
  const target: WaitingWorkerTarget = {
    questId: threadKey,
    workerSessionId,
    workerNum: participant?.sessionNum ?? row.workerNum ?? null,
    workerStatus:
      participant?.status === "running" || participant?.status === "idle" ? participant.status : "disconnected",
    phaseLabel: getQuestJourneyPhase(row.journey?.currentPhaseId)?.label ?? null,
    phaseStartedAt: typeof phaseStartedAt === "number" ? phaseStartedAt : null,
  };

  const status = getVisibleCurrentThreadStatuses(input.statuses, threadKey).at(-1);
  if (!status) return { kind: "soft", target };
  return status.kind === "waiting" ? { kind: "show", target } : { kind: "hide" };
}

/**
 * Live peek at the assigned worker's latest actions, pinned above the composer while a
 * leader quest thread is waiting on that worker. It is transient UI, never thread history.
 */
export function WaitingWorkerPreview({ leaderSessionId, threadKey }: { leaderSessionId: string; threadKey: string }) {
  const statuses = useStore((state) => selectLeaderThreadStatuses(state, leaderSessionId));
  const boardRows = useStore((state) => state.sessionBoards.get(leaderSessionId));
  const rowStatuses = useStore((state) => state.sessionBoardRowStatuses.get(leaderSessionId));
  const leaderRunning = useStore((state) => state.sessionStatus.get(leaderSessionId) === "running");
  const gate = useMemo(
    () => resolveWaitingWorkerGate({ threadKey, statuses, boardRows, rowStatuses }),
    [boardRows, rowStatuses, statuses, threadKey],
  );
  const target = useFlashFreeTarget(gate, leaderRunning);
  return target ? <LiveWaitingWorkerPreview target={target} /> : null;
}

/**
 * Keep the panel through a `soft` gap while the leader is generating and briefly after,
 * so clearing and re-writing the Waiting marker does not unmount and remount it.
 * Once a hold expires the panel stays hidden until an explicit Waiting status returns.
 */
function useFlashFreeTarget(gate: WaitingWorkerGate, leaderRunning: boolean): WaitingWorkerTarget | null {
  const shownRef = useRef(false);
  const lastReasonAtRef = useRef(0);
  const hadReasonRef = useRef(false);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const now = Date.now();
  // A Waiting status or a generating leader is a reason to show. The grace period
  // starts when the last reason ended, i.e. on the first render without one.
  const hasReason = gate.kind === "show" || leaderRunning;
  const reasonAt = hasReason || hadReasonRef.current ? now : lastReasonAtRef.current;
  const holding = gate.kind === "soft" && shownRef.current && now - reasonAt < WAITING_WORKER_PREVIEW_HOLD_MS;
  const visible = gate.kind === "show" || holding ? gate.target : null;

  useLayoutEffect(() => {
    shownRef.current = visible !== null;
    lastReasonAtRef.current = reasonAt;
    hadReasonRef.current = hasReason;
  });

  const holdDeadline = holding && !hasReason ? reasonAt + WAITING_WORKER_PREVIEW_HOLD_MS : null;
  useEffect(() => {
    if (holdDeadline === null) return;
    const timer = setTimeout(rerender, Math.max(0, holdDeadline - Date.now()) + 10);
    return () => clearTimeout(timer);
  }, [holdDeadline]);

  return visible;
}

function LiveWaitingWorkerPreview({ target }: { target: WaitingWorkerTarget }) {
  const preview = useSessionActivityPreview(target.workerSessionId, target.workerStatus === "running");
  const [collapsed, setCollapsed] = useState(readStoredCollapsed);
  const now = useNow(CLOCK_TICK_MS);
  const toggleCollapsed = () => {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, String(!collapsed));
    setCollapsed(!collapsed);
  };
  return (
    <WaitingWorkerPreviewPanel
      target={target}
      preview={preview}
      collapsed={collapsed}
      now={now}
      onToggleCollapsed={toggleCollapsed}
      onOpenSession={(historyIndex) =>
        historyIndex === undefined
          ? navigateToSession(target.workerSessionId)
          : navigateToSessionMessage(target.workerSessionId, historyIndex)
      }
    />
  );
}

/** Fetch the server-bounded activity slice; poll only while the worker is generating and the page is visible. */
function useSessionActivityPreview(sessionId: string, live: boolean): SessionActivityPreview | null {
  const [loaded, setLoaded] = useState<{ sessionId: string; preview: SessionActivityPreview; key: string } | null>(
    null,
  );
  useEffect(() => {
    let cancelled = false;
    let latestRequest = 0;
    const load = () => {
      const request = ++latestRequest;
      api
        .getSessionActivityPreview(sessionId)
        .then((preview) => {
          if (cancelled || request !== latestRequest) return;
          const key = JSON.stringify(preview);
          setLoaded((previous) =>
            previous?.sessionId === sessionId && previous.key === key ? previous : { sessionId, preview, key },
          );
        })
        .catch((error) => console.warn("[waiting-worker-preview] failed to load activity preview", error));
    };
    load();
    if (!live) return () => void (cancelled = true);
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden") load();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [live, sessionId]);
  return loaded?.sessionId === sessionId ? loaded.preview : null;
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function readStoredCollapsed(): boolean {
  const stored = localStorage.getItem(COLLAPSED_STORAGE_KEY);
  if (stored === "true" || stored === "false") return stored === "true";
  return typeof window.matchMedia === "function" && window.matchMedia(PHONE_WIDTH_QUERY).matches;
}

export function WaitingWorkerPreviewPanel({
  target,
  preview,
  collapsed,
  now,
  onToggleCollapsed,
  onOpenSession,
}: {
  target: WaitingWorkerTarget;
  preview: SessionActivityPreview | null;
  collapsed: boolean;
  now: number;
  onToggleCollapsed: () => void;
  /** Opens the worker session, at a history index when one is given. */
  onOpenSession: (historyIndex?: number) => void;
}) {
  const workerLabel = target.workerNum === null ? "Worker" : `#${target.workerNum}`;
  const elapsed = target.phaseStartedAt === null ? null : formatQuestJourneyDuration(now - target.phaseStartedAt);
  const lines = preview?.lines ?? [];
  const latest = lines.at(-1);
  const running = target.workerStatus === "running";

  const openButton = (
    <button
      type="button"
      onClick={() => onOpenSession()}
      className="shrink-0 rounded-md border border-cc-border px-2 py-0.5 text-[11px] font-medium text-cc-fg/85 hover:bg-cc-hover hover:text-cc-fg cursor-pointer"
      title={`Open ${workerLabel}'s full session`}
    >
      Open session
    </button>
  );
  const chevron = (
    <button
      type="button"
      onClick={onToggleCollapsed}
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-cc-muted hover:bg-cc-hover hover:text-cc-fg cursor-pointer"
      aria-label={collapsed ? "Expand worker preview" : "Collapse worker preview"}
      aria-expanded={!collapsed}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="h-3 w-3"
        aria-hidden="true"
      >
        <path d={collapsed ? "m4 10 4-4 4 4" : "m4 6 4 4 4-4"} strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
  const dot = (
    <span
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${running ? "bg-cc-success" : "bg-cc-muted/50"}`}
      aria-hidden="true"
    />
  );

  return (
    <section
      className="shrink-0 border-t border-cc-border bg-cc-card px-2 py-1 sm:px-4"
      aria-label={`${workerLabel} live preview for ${target.questId}`}
      data-testid="waiting-worker-preview"
      data-collapsed={collapsed}
    >
      <div className="mx-auto w-full max-w-3xl">
        {collapsed ? (
          <div className="flex min-w-0 items-center gap-2 text-[11px]">
            {dot}
            <span className="shrink-0 font-mono-code font-medium text-cc-fg/85">{workerLabel}</span>
            <span className="min-w-0 flex-1 truncate text-cc-muted" data-testid="waiting-worker-preview-latest">
              {latest ? <PreviewLineText line={latest} /> : "No activity yet"}
            </span>
            {elapsed && <span className="shrink-0 tabular-nums text-cc-muted/70">{elapsed}</span>}
            {openButton}
            {chevron}
          </div>
        ) : (
          <>
            <div className="flex min-w-0 items-center gap-2 text-[11px]">
              {dot}
              <span className="shrink-0 font-mono-code font-medium text-cc-fg/85">{workerLabel}</span>
              <span className="min-w-0 truncate text-cc-muted">
                {[target.phaseLabel, elapsed].filter(Boolean).join(" · ")}
              </span>
              <WorkerStatusLabel
                status={target.workerStatus}
                lastActivityAt={preview?.lastActivityAt ?? null}
                now={now}
              />
              <span className="flex-1" />
              {openButton}
              {chevron}
            </div>
            {/* Fixed four-line body: lines never scroll, newer lines push older ones out. */}
            <ol
              className="mt-0.5 flex h-20 flex-col justify-end overflow-hidden"
              data-testid="waiting-worker-preview-lines"
            >
              {lines.length === 0 && <li className="h-5 text-[11px] leading-5 text-cc-muted/60">No activity yet</li>}
              {lines.map((line) => (
                <li
                  key={`${line.historyIndex}:${line.kind}:${line.toolName ?? ""}:${line.text}`}
                  className="h-5 min-w-0"
                >
                  <button
                    type="button"
                    onClick={() => onOpenSession(line.historyIndex)}
                    className="block h-5 w-full truncate rounded px-1 text-left text-[11px] leading-5 text-cc-muted hover:bg-cc-hover/70 hover:text-cc-fg cursor-pointer"
                    title={`Open ${workerLabel} at this point`}
                  >
                    <PreviewLineText line={line} />
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
    </section>
  );
}

function PreviewLineText({ line }: { line: SessionActivityPreview["lines"][number] }) {
  if (line.kind === "message") return <span className="text-cc-fg/80">{line.text}</span>;
  return (
    <>
      <span className="font-mono-code text-cc-primary/80">{line.toolName}</span>
      {line.text && <span className="ml-1.5">{line.text}</span>}
    </>
  );
}

function WorkerStatusLabel({
  status,
  lastActivityAt,
  now,
}: {
  status: WaitingWorkerStatus;
  lastActivityAt: number | null;
  now: number;
}) {
  const idleFor =
    status === "idle" && lastActivityAt !== null ? formatQuestJourneyDuration(now - lastActivityAt) : null;
  return (
    <span
      className={`shrink-0 rounded-full border px-1.5 text-[10px] leading-4 ${
        status === "running" ? "border-cc-success/30 text-cc-success" : "border-cc-border text-cc-muted"
      }`}
      data-testid="waiting-worker-preview-status"
    >
      {status === "running" ? "working" : status}
      {idleFor && (
        <>
          {" · "}
          <span className="hidden sm:inline">last activity </span>
          {idleFor} ago
        </>
      )}
    </span>
  );
}
