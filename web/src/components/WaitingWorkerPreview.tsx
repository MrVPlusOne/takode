import { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useStore } from "../store.js";
import type { SessionActivityPreview } from "../../server/session-activity-preview.js";
import type { BoardParticipantStatus, BoardRowSessionStatus } from "../types.js";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import { isQuestThreadKey } from "../../shared/thread-routing.js";
import { formatQuestJourneyDuration, getWaitForRefKind } from "../../shared/quest-journey.js";
import { describeSessionWaits } from "../../shared/session-waits.js";
import { normalizeThreadKey } from "../utils/thread-projection.js";
import { navigateToSession, navigateToSessionMessage } from "../utils/routing.js";
import { formatElapsed } from "./message-feed-utils.js";
import type { BoardRowData } from "./BoardTable.js";
import { SessionHostBadge } from "./HostBadge.js";

const POLL_INTERVAL_MS = 3_000;
const CLOCK_TICK_MS = 5_000;
/** The working worker's turn timer counts seconds, so it ticks every second. */
const TURN_CLOCK_TICK_MS = 1_000;

export type WaitingWorkerStatus = "running" | "idle" | "disconnected";

/** One session the preview can show: the quest's owner or a helper its row waits on. */
export interface WaitingSession {
  sessionId: string;
  sessionNum: number | null;
  status: WaitingWorkerStatus;
  /** Server time the session's current turn started; null unless it is running. */
  turnStartedAt: number | null;
  /** A helper session the row waits on (`--wait-for #N`), not the quest's owner. */
  helper: boolean;
}

export interface WaitingWorkerTarget {
  questId: string;
  /** The quest's owner first, then the helpers its row waits on. */
  sessions: WaitingSession[];
  /**
   * What the row says the owner waits for, besides its own session waits: "your answer"
   * for linked questions, then the helpers (#N) and quests (q-N) named with `--wait-for`.
   */
  ownerWaits: string[];
}

/**
 * Board states in which the assigned worker is not on this quest: it has not started
 * (proposed, queued) or has handed it over and waits for the landing queue. The worker
 * may be busy with other quests then, so its activity would mislead here.
 */
const IDLE_ROW_STATES = new Set(["PROPOSED", "QUEUED", "LANDING"]);

/**
 * The quest whose tab this is, while its worker is on it: the row is on the board in an
 * active phase (Work, User Checkpoint, Memory and legacy working phases) with a live
 * worker. The leader's Waiting status is not needed, so side quests, whose updates go to
 * the tab the request came from, show it too, and clearing and re-writing a status never
 * makes it flash. Only a Ready the leader posted in this tab during the current phase
 * hides it: the tab then leads with that result.
 */
export function resolveWaitingWorkerTarget(input: {
  threadKey: string;
  /** The thread's current status, newest last, as shown in its feed footer. */
  statuses: readonly LeaderThreadStatus[];
  boardRows: readonly BoardRowData[] | undefined;
  rowStatuses: Readonly<Record<string, BoardRowSessionStatus>> | undefined;
}): WaitingWorkerTarget | null {
  const threadKey = normalizeThreadKey(input.threadKey);
  if (!isQuestThreadKey(threadKey)) return null;
  const row = input.boardRows?.find((candidate) => candidate.questId.toLowerCase() === threadKey);
  if (!row || row.completedAt !== undefined) return null;
  if (IDLE_ROW_STATES.has((row.status ?? "").trim().toUpperCase())) return null;
  const participant = input.rowStatuses?.[row.questId]?.worker;
  const workerSessionId = participant?.sessionId ?? row.worker;
  if (!workerSessionId || participant?.status === "archived") return null;
  const status = input.statuses.at(-1);
  if (status?.kind === "ready" && status.updatedAt >= currentPhaseStartedAt(row)) return null;

  const helpers = input.rowStatuses?.[row.questId]?.helpers ?? [];
  const target: WaitingWorkerTarget = {
    questId: threadKey,
    sessions: [
      waitingSession(participant, workerSessionId, row.workerNum ?? null, false),
      ...helpers.map((helper) => waitingSession(helper, helper.sessionId, null, true)),
    ],
    ownerWaits: rowWaits(row, participant?.sessionNum ?? row.workerNum ?? null),
  };

  return target;
}

/** When the row entered its current phase; a reopened quest or a later phase starts after an older Ready. */
function currentPhaseStartedAt(row: BoardRowData): number {
  const index = row.journey?.activePhaseIndex;
  return (index !== undefined ? row.journey?.phaseTimings?.[String(index)]?.startedAt : undefined) ?? 0;
}

function waitingSession(
  participant: BoardParticipantStatus | undefined,
  sessionId: string,
  fallbackNum: number | null,
  helper: boolean,
): WaitingSession {
  const status =
    participant?.status === "running" || participant?.status === "idle" ? participant.status : "disconnected";
  return {
    sessionId,
    sessionNum: participant?.sessionNum ?? fallbackNum,
    status,
    turnStartedAt: status === "running" ? (participant?.generationStartedAt ?? null) : null,
    helper,
  };
}

/** A queued row's wait-for list is about starting, not about the working owner, so only rows past it count. */
function rowWaits(row: BoardRowData, ownerNum: number | null): string[] {
  if ((row.status ?? "").trim().toUpperCase() === "QUEUED") return [];
  const refs = (row.waitFor ?? []).filter((ref) => {
    const kind = getWaitForRefKind(ref);
    return kind === "quest" || (kind === "session" && ref !== `#${ownerNum}`);
  });
  return [...((row.waitForInput ?? []).length > 0 ? ["your answer"] : []), ...new Set(refs)];
}

/**
 * Resolve which worker, if any, the selected leader quest thread shows a preview of.
 * The feed renders the preview in the thread's status footer whenever this is non-null.
 */
export function useWaitingWorkerPreviewTarget(
  leaderSessionId: string,
  threadKey: string,
  statuses: readonly LeaderThreadStatus[],
): WaitingWorkerTarget | null {
  const boardRows = useStore((state) => state.sessionBoards?.get(leaderSessionId));
  const rowStatuses = useStore((state) => state.sessionBoardRowStatuses?.get(leaderSessionId));
  return useMemo(
    () => resolveWaitingWorkerTarget({ threadKey, statuses, boardRows, rowStatuses }),
    [boardRows, rowStatuses, statuses, threadKey],
  );
}

/**
 * Live in-feed peek at the waiting thread's worker, and at the helpers its row waits on;
 * transient UI, never thread history.
 */
export function WaitingWorkerPreview({ target }: { target: WaitingWorkerTarget }) {
  const [selectedSessionId, selectSession] = useAutoSelectedSession(target.sessions);
  const selected = target.sessions.find((session) => session.sessionId === selectedSessionId) ?? target.sessions[0]!;
  const preview = useSessionActivityPreview(selected.sessionId, selected.status === "running");
  const now = useNow(selected.turnStartedAt === null ? CLOCK_TICK_MS : TURN_CLOCK_TICK_MS);
  const ownerSessionId = target.sessions[0]?.sessionId;
  const waitingFor = useStore((state) => {
    const sdk = state.sdkSessions.find((session) => session.sessionId === selected.sessionId);
    const own = describeSessionWaits(
      // In the quest's own tab, the owner's "user's answer on q-N" reads as "your answer" below.
      (sdk?.waits ?? []).filter((wait) => wait.kind !== "answer" || wait.questId !== target.questId),
    );
    const parts = [
      ...(selected.sessionId === ownerSessionId ? target.ownerWaits : []),
      ...(own ? [own] : []),
      ...((sdk?.pendingTimerCount ?? 0) > 0 ? ["a timer"] : []),
    ];
    return parts.length > 0 ? parts.join("; ") : null;
  });
  return (
    <WaitingWorkerPreviewPanel
      target={target}
      selectedSessionId={selected.sessionId}
      onSelectSession={selectSession}
      waitingFor={waitingFor}
      preview={preview}
      now={now}
      onOpenSession={(historyIndex) =>
        historyIndex === undefined
          ? navigateToSession(selected.sessionId)
          : navigateToSessionMessage(selected.sessionId, historyIndex)
      }
    />
  );
}

/**
 * The session whose activity the preview shows: the one that most recently started working
 * (a helper wins a tie), else the owner. A tab the user picks stays until that changes, so
 * the preview follows whoever is working without overriding a deliberate look elsewhere.
 */
function useAutoSelectedSession(sessions: readonly WaitingSession[]): [string, (sessionId: string) => void] {
  const auto = autoSelectedSessionId(sessions);
  const [state, setState] = useState<{ auto: string; picked: string | null }>({ auto, picked: null });
  // A change of the working session drops the user's pick, so a later return to the same one can't revive it.
  if (state.auto !== auto) setState({ auto, picked: null });
  const picked = state.auto === auto ? state.picked : null;
  const valid = picked !== null && sessions.some((session) => session.sessionId === picked);
  return [valid ? picked : auto, (sessionId) => setState({ auto, picked: sessionId })];
}

export function autoSelectedSessionId(sessions: readonly WaitingSession[]): string {
  const running = sessions.filter((session) => session.status === "running");
  const latest = running.reduce<WaitingSession | null>((best, session) => {
    if (!best) return session;
    const start = session.turnStartedAt ?? 0;
    const bestStart = best.turnStartedAt ?? 0;
    return start > bestStart || (start === bestStart && session.helper && !best.helper) ? session : best;
  }, null);
  return (latest ?? sessions[0])!.sessionId;
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
  selectedSessionId,
  onSelectSession,
  waitingFor,
  preview,
  now,
  onOpenSession,
}: {
  target: WaitingWorkerTarget;
  selectedSessionId: string;
  onSelectSession: (sessionId: string) => void;
  /** What the selected session waits for, shown in place of a bare "idle". */
  waitingFor: string | null;
  preview: SessionActivityPreview | null;
  now: number;
  /** Opens the selected session, at a history index when one is given. */
  onOpenSession: (historyIndex?: number) => void;
}) {
  const selected = target.sessions.find((session) => session.sessionId === selectedSessionId) ?? target.sessions[0]!;
  const label = sessionLabel(selected);
  const lines = preview?.lines ?? [];
  const running = selected.status === "running";

  return (
    // The status-keyed left edge and tint set this live view of another session
    // apart from the leader's own activity groups, which use the same faint card.
    <section
      className={`w-full max-w-2xl rounded-lg border border-l-2 border-cc-border/70 px-2.5 py-1.5 font-sans-ui ${
        running ? "border-l-cc-success/70 bg-cc-success/[0.05]" : "border-l-cc-muted/50 bg-cc-card/60"
      }`}
      data-worker-status={selected.status}
      aria-label={`${label} live preview for ${target.questId}`}
      data-testid="waiting-worker-preview"
    >
      {/* The quest header already names the owner's machine and phase, so the bar keeps only
          who it is, whether (and for how long) it is working, and the way into its session.
          Helpers the row waits on share the bar as tabs instead of stacking more cards. */}
      <div className="flex min-w-0 items-center gap-2 text-[11px]">
        {target.sessions.length === 1 ? (
          <>
            <StatusDot status={selected.status} />
            <span className="shrink-0 font-mono-code font-medium text-cc-fg/85">{label}</span>
          </>
        ) : (
          <div className="-ml-1 flex shrink-0 items-center gap-0.5" role="tablist" aria-label="Sessions">
            {target.sessions.map((session) => {
              const isSelected = session.sessionId === selected.sessionId;
              return (
                <button
                  key={session.sessionId}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => onSelectSession(session.sessionId)}
                  className={`inline-flex h-5 items-center gap-1 rounded px-1 font-mono-code cursor-pointer ${
                    isSelected ? "bg-cc-hover font-medium text-cc-fg/90" : "text-cc-muted hover:text-cc-fg"
                  }`}
                  title={`${session.helper ? "Helper" : "Owner"} ${sessionLabel(session)}`}
                  data-testid="waiting-worker-preview-tab"
                >
                  <StatusDot status={session.status} />
                  {sessionLabel(session)}
                  {/* Helpers often run on another machine, which the quest header does not name. */}
                  {session.helper && <SessionHostBadge sessionId={session.sessionId} iconOnPhone />}
                </button>
              );
            })}
          </div>
        )}
        {running && selected.turnStartedAt !== null && (
          // Server turn start, so every device and reload shows the same elapsed time.
          <span
            className="shrink-0 font-mono-code tabular-nums text-cc-muted"
            title="Time in the current turn"
            data-testid="waiting-worker-preview-turn-time"
          >
            · {formatElapsed(Math.max(0, now - selected.turnStartedAt))}
          </span>
        )}
        {selected.status !== "running" && (
          <WorkerStatusLabel
            status={selected.status}
            waitingFor={waitingFor}
            lastActivityAt={preview?.lastActivityAt ?? null}
            now={now}
          />
        )}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => onOpenSession()}
          className="shrink-0 rounded-md border border-cc-border px-2 py-0.5 text-[11px] font-medium text-cc-fg/85 hover:bg-cc-hover hover:text-cc-fg cursor-pointer"
          title={`Open ${label}'s full session`}
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
              title={`Open ${label} at this point`}
            >
              <PreviewLineText line={line} />
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function sessionLabel(session: WaitingSession): string {
  return session.sessionNum === null ? (session.helper ? "Helper" : "Worker") : `#${session.sessionNum}`;
}

/** A working session pulses green; the dot's name says what no pill repeats. */
function StatusDot({ status }: { status: WaitingWorkerStatus }) {
  const running = status === "running";
  return (
    <span
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
        running
          ? "bg-cc-success animate-[pulse-dot_1.5s_ease-in-out_infinite] motion-reduce:animate-none"
          : "bg-cc-muted/50"
      }`}
      role="img"
      aria-label={running ? "working" : status}
      title={running ? "Working" : undefined}
      data-testid="waiting-worker-preview-dot"
    />
  );
}

function PreviewLineText({ line }: { line: SessionActivityPreview["lines"][number] }) {
  if (line.kind === "message") return <span className="text-cc-fg/80">{line.text}</span>;
  if (line.kind === "quiet") {
    return (
      <span title="The worker marked this turn quiet, so it did not wake the leader">
        <span className="font-mono-code text-cc-muted/80">quiet</span>
        <span className="ml-1.5 text-cc-fg/80">{line.text}</span>
      </span>
    );
  }
  return (
    <>
      <span className="font-mono-code text-cc-primary/80">{line.toolName}</span>
      {line.text && <span className="ml-1.5">{line.text}</span>}
    </>
  );
}

/**
 * Only for states the dot cannot tell apart: disconnected, and idle, which names what the
 * session waits for when it waits on something (a helper, a quest, the user's answer, a
 * job or a timer), with the time since its last activity.
 */
function WorkerStatusLabel({
  status,
  waitingFor,
  lastActivityAt,
  now,
}: {
  status: Exclude<WaitingWorkerStatus, "running">;
  waitingFor: string | null;
  lastActivityAt: number | null;
  now: number;
}) {
  const idleFor =
    status === "idle" && lastActivityAt !== null ? formatQuestJourneyDuration(now - lastActivityAt) : null;
  const waiting = status === "idle" && waitingFor ? waitingFor : null;
  return (
    <span
      className="min-w-0 truncate rounded-full border border-cc-border px-1.5 text-[10px] leading-4 text-cc-muted"
      title={waiting ? `Waiting for ${waiting}` : undefined}
      data-testid="waiting-worker-preview-status"
    >
      {waiting ? (
        <>
          waiting for {waiting}
          {/* Phones keep the reason; the idle time is the first thing to go. */}
          {idleFor && <span className="hidden sm:inline"> · last activity {idleFor} ago</span>}
        </>
      ) : (
        <>
          {status}
          {idleFor && (
            <>
              {" · "}
              <span className="hidden sm:inline">last activity </span>
              {idleFor} ago
            </>
          )}
        </>
      )}
    </span>
  );
}
