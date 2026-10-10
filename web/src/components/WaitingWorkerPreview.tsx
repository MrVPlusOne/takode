import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { api } from "../api.js";
import { useStore } from "../store.js";
import type { SessionActivityPreview } from "../../server/session-activity-preview.js";
import type { BoardRowSessionStatus } from "../types.js";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import { isQuestThreadKey } from "../../shared/thread-routing.js";
import { formatQuestJourneyDuration } from "../../shared/quest-journey.js";
import { normalizeThreadKey } from "../utils/thread-projection.js";
import { navigateToSession, navigateToSessionMessage } from "../utils/routing.js";
import type { BoardRowData } from "./BoardTable.js";

/** How long the preview survives a cleared thread status after the leader stops generating. */
export const WAITING_WORKER_PREVIEW_HOLD_MS = 5_000;
const POLL_INTERVAL_MS = 3_000;
const CLOCK_TICK_MS = 5_000;

export type WaitingWorkerStatus = "running" | "idle" | "disconnected";

export interface WaitingWorkerTarget {
  questId: string;
  workerSessionId: string;
  workerNum: number | null;
  workerStatus: WaitingWorkerStatus;
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
  /** The thread's current status, newest last, as shown in its feed footer. */
  statuses: readonly LeaderThreadStatus[];
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

  const target: WaitingWorkerTarget = {
    questId: threadKey,
    workerSessionId,
    workerNum: participant?.sessionNum ?? row.workerNum ?? null,
    workerStatus:
      participant?.status === "running" || participant?.status === "idle" ? participant.status : "disconnected",
  };

  const status = input.statuses.at(-1);
  if (!status) return { kind: "soft", target };
  return status.kind === "waiting" ? { kind: "show", target } : { kind: "hide" };
}

/**
 * Resolve which worker, if any, the selected leader quest thread is waiting on.
 * The feed renders the preview under the thread's status footer whenever this is non-null.
 */
export function useWaitingWorkerPreviewTarget(
  leaderSessionId: string,
  threadKey: string,
  statuses: readonly LeaderThreadStatus[],
): WaitingWorkerTarget | null {
  const boardRows = useStore((state) => state.sessionBoards?.get(leaderSessionId));
  const rowStatuses = useStore((state) => state.sessionBoardRowStatuses?.get(leaderSessionId));
  const leaderRunning = useStore((state) => state.sessionStatus?.get(leaderSessionId) === "running");
  const gate = useMemo(
    () => resolveWaitingWorkerGate({ threadKey, statuses, boardRows, rowStatuses }),
    [boardRows, rowStatuses, statuses, threadKey],
  );
  return useFlashFreeTarget(gate, leaderRunning, `${leaderSessionId}:${normalizeThreadKey(threadKey)}`);
}

/**
 * Keep the preview through a `soft` gap while the leader is generating and briefly after,
 * so clearing and re-writing the Waiting marker does not unmount and remount it.
 * Once a hold expires the preview stays hidden until an explicit Waiting status returns.
 */
function useFlashFreeTarget(
  gate: WaitingWorkerGate,
  leaderRunning: boolean,
  scope: string,
): WaitingWorkerTarget | null {
  const scopeRef = useRef(scope);
  const shownRef = useRef(false);
  const lastReasonAtRef = useRef(0);
  const hadReasonRef = useRef(false);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  if (scopeRef.current !== scope) {
    // A different thread never inherits another thread's hold.
    scopeRef.current = scope;
    shownRef.current = false;
    hadReasonRef.current = false;
  }
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

/** Live in-feed peek at the waiting thread's worker; transient UI, never thread history. */
export function WaitingWorkerPreview({ target }: { target: WaitingWorkerTarget }) {
  const preview = useSessionActivityPreview(target.workerSessionId, target.workerStatus === "running");
  const now = useNow(CLOCK_TICK_MS);
  return (
    <WaitingWorkerPreviewPanel
      target={target}
      preview={preview}
      now={now}
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

export function WaitingWorkerPreviewPanel({
  target,
  preview,
  now,
  onOpenSession,
}: {
  target: WaitingWorkerTarget;
  preview: SessionActivityPreview | null;
  now: number;
  /** Opens the worker session, at a history index when one is given. */
  onOpenSession: (historyIndex?: number) => void;
}) {
  const workerLabel = target.workerNum === null ? "Worker" : `#${target.workerNum}`;
  const lines = preview?.lines ?? [];
  const running = target.workerStatus === "running";

  return (
    // The status-keyed left edge and tint set this live view of another session
    // apart from the leader's own activity groups, which use the same faint card.
    <section
      className={`w-full max-w-2xl rounded-lg border border-l-2 border-cc-border/70 px-2.5 py-1.5 font-sans-ui ${
        running ? "border-l-cc-success/70 bg-cc-success/[0.05]" : "border-l-cc-muted/50 bg-cc-card/60"
      }`}
      data-worker-status={target.workerStatus}
      aria-label={`${workerLabel} live preview for ${target.questId}`}
      data-testid="waiting-worker-preview"
    >
      {/* The quest header already names the worker's machine and phase, so the bar keeps
          only who it is, whether it is working, and the way into its session. */}
      <div className="flex min-w-0 items-center gap-2 text-[11px]">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            running
              ? "bg-cc-success animate-[pulse-dot_1.5s_ease-in-out_infinite] motion-reduce:animate-none"
              : "bg-cc-muted/50"
          }`}
          role="img"
          aria-label={running ? "working" : target.workerStatus}
          title={running ? "Working" : undefined}
          data-testid="waiting-worker-preview-dot"
        />
        <span className="shrink-0 font-mono-code font-medium text-cc-fg/85">{workerLabel}</span>
        {target.workerStatus !== "running" && (
          <WorkerStatusLabel status={target.workerStatus} lastActivityAt={preview?.lastActivityAt ?? null} now={now} />
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => onOpenSession()}
          className="shrink-0 rounded-md border border-cc-border px-2 py-0.5 text-[11px] font-medium text-cc-fg/85 hover:bg-cc-hover hover:text-cc-fg cursor-pointer"
          title={`Open ${workerLabel}'s full session`}
        >
          Open session
        </button>
      </div>
      {/* Fixed four-line body: lines never scroll, newer lines push older ones out, and the
          feed below never shifts as lines change. */}
      <ol className="mt-1 flex h-20 flex-col justify-end overflow-hidden" data-testid="waiting-worker-preview-lines">
        {lines.length === 0 && <li className="h-5 px-1 text-[11px] leading-5 text-cc-muted/60">No activity yet</li>}
        {lines.map((line) => (
          <li key={`${line.historyIndex}:${line.kind}:${line.toolName ?? ""}:${line.text}`} className="h-5 min-w-0">
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

/** Only for states the dot cannot tell apart: idle (with time since the last activity) and disconnected. */
function WorkerStatusLabel({
  status,
  lastActivityAt,
  now,
}: {
  status: Exclude<WaitingWorkerStatus, "running">;
  lastActivityAt: number | null;
  now: number;
}) {
  const idleFor =
    status === "idle" && lastActivityAt !== null ? formatQuestJourneyDuration(now - lastActivityAt) : null;
  return (
    <span
      className="min-w-0 truncate rounded-full border border-cc-border px-1.5 text-[10px] leading-4 text-cc-muted"
      data-testid="waiting-worker-preview-status"
    >
      {status}
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
