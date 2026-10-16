import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { useOutsidePress } from "../hooks/useOutsidePress.js";
import { usePendingAction } from "../hooks/usePendingAction.js";
import { useStore } from "../store.js";
import { api } from "../api.js";
import type { SessionTimer } from "../types.js";
import type { SessionWait } from "../../shared/session-waits.js";
import { WaitKindIcon, waitKindLabel } from "./WaitKindIcon.js";

const EMPTY_TIMERS: SessionTimer[] = [];
const EMPTY_WAITS: SessionWait[] = [];

/** Format an epoch timestamp as a consistent countdown from now.
 *  < 1 hour: M:SS (e.g., "1:30", "0:45", "12:05")
 *  >= 1 hour: Xh Ym (e.g., "2h 15m", "1h 0m") */
function formatRelativeTime(epochMs: number): string {
  const diffMs = epochMs - Date.now();
  if (diffMs <= 0) return "firing...";
  const totalSeconds = Math.ceil(diffMs / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}:${String(seconds).padStart(2, "0")}`;
  const hours = Math.floor(minutes / 60);
  const remainMins = minutes % 60;
  return `${hours}h ${remainMins}m`;
}

/** Compact countdown label for the collapsed chip.
 *  < 1 hour: M:SS
 *  < 24 hours: Xh
 *  >= 24 hours: Xd */
function formatCompactRelativeTime(epochMs: number): string {
  const diffMs = epochMs - Date.now();
  if (diffMs <= 0) return "firing...";
  const totalSeconds = Math.ceil(diffMs / 1_000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) {
    const seconds = totalSeconds % 60;
    return `${totalMinutes}:${String(seconds).padStart(2, "0")}`;
  }
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours < 24) return `${totalHours}h`;
  // Round down like the hour form: the chip shows whole units left, never more time than remains.
  return `${Math.floor(totalHours / 24)}d`;
}

/** How long a background job has run: "45s", "12m", "1h 5m", "2d". */
function formatElapsed(startedAt: number): string {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1_000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / 60);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  if (hours < 24) return `${hours}h ${totalMinutes % 60}m`;
  return `${Math.floor(hours / 24)}d`;
}

// ─── Shared hooks ────────────────────────────────────────────────────────────

/**
 * Everything the session waits on: its timers, soonest first, and the waits the
 * server reports (the user's answer, background jobs, a landing run, lease queues),
 * in their display order. Re-renders every second while anything is listed, so
 * countdowns and job run times stay current.
 */
function useSessionWaiting(sessionId: string) {
  const timers = useStore((s) => s.sessionTimers?.get(sessionId) ?? EMPTY_TIMERS);
  const waits = useStore((s) => s.sdkSessions.find((session) => session.sessionId === sessionId)?.waits ?? EMPTY_WAITS);

  const [, setTick] = useState(0);
  const listed = timers.length + waits.length;
  useEffect(() => {
    if (listed === 0) return;
    const interval = setInterval(() => setTick((t) => t + 1), 1_000);
    return () => clearInterval(interval);
  }, [listed]);

  // Sort by nextFireAt ascending (soonest first). Called before any early return
  // so hook count stays stable across renders.
  const timersSoonestFirst = useMemo(() => [...timers].sort((a, b) => a.nextFireAt - b.nextFireAt), [timers]);

  return { timers: timersSoonestFirst, waits };
}

// ─── Waiting list popover ────────────────────────────────────────────────────

function KindIcon({ kind }: { kind: SessionWait["kind"] | "timer" }) {
  return (
    <span className="shrink-0 pt-0.5 text-emerald-500" title={waitKindLabel(kind)}>
      <WaitKindIcon kind={kind} className="h-3.5 w-3.5" />
    </span>
  );
}

/** Title and detail line of one server-reported wait in the list. */
function waitRowText(wait: SessionWait): { title: string; detail: string } {
  if (wait.kind === "answer") return { title: `Your answer on ${wait.questId}`, detail: "User Checkpoint" };
  if (wait.kind === "job") {
    return {
      title: wait.description || "Background job",
      detail: `Background job · running ${formatElapsed(wait.startedAt)}`,
    };
  }
  if (wait.kind === "landing") return { title: "Landing run", detail: "The change is being landed" };
  return { title: wait.resource, detail: `#${wait.position} in line` };
}

function WaitRow({ wait }: { wait: SessionWait }) {
  const { title, detail } = waitRowText(wait);
  return (
    <div className="flex items-start gap-3 px-4 py-3" data-testid="waiting-row" data-wait-kind={wait.kind}>
      <KindIcon kind={wait.kind} />
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-[13px] font-medium text-cc-fg leading-snug break-words">{title}</p>
        <p className="text-[11px] text-cc-muted">{detail}</p>
      </div>
    </div>
  );
}

function TimerRow({ timer, sessionId }: { timer: SessionTimer; sessionId: string }) {
  const [expanded, setExpanded] = useState(false);
  const cancel = usePendingAction("Cancel failed.");
  const typeLabel =
    timer.type === "recurring"
      ? `every ${timer.originalSpec}`
      : timer.type === "at"
        ? `at ${timer.originalSpec}`
        : null;
  const descriptionLines = timer.description.split(/\r?\n/);
  const collapsedDescription = descriptionLines[0] ?? "";
  const canExpandDescription = descriptionLines.length > 1;
  const visibleDescription = expanded ? timer.description : collapsedDescription;

  return (
    <div
      className="flex items-start gap-3 px-4 py-3 group hover:bg-white/[0.03] transition-colors"
      data-testid="waiting-row"
      data-wait-kind="timer"
    >
      <KindIcon kind="timer" />
      <div className="flex-1 min-w-0 space-y-0.5">
        <p className="text-[13px] font-medium text-cc-fg leading-snug break-words">{timer.title}</p>
        {timer.description && (
          <div className="space-y-1">
            <p className="text-[12px] text-cc-fg/65 leading-snug break-words whitespace-pre-wrap">
              {visibleDescription}
            </p>
            {canExpandDescription && (
              <button
                onClick={() => setExpanded((value) => !value)}
                className="text-[11px] text-cc-muted hover:text-cc-fg transition-colors cursor-pointer"
                aria-label={
                  expanded ? `Collapse timer ${timer.id} description` : `Expand timer ${timer.id} description`
                }
              >
                {expanded ? "Show less" : "Show more"}
              </button>
            )}
          </div>
        )}
        <div className="flex items-center gap-2 text-[11px] text-cc-muted">
          <span className="font-mono">{timer.id}</span>
          {typeLabel && <span>{typeLabel}</span>}
          <span>{formatRelativeTime(timer.nextFireAt)}</span>
        </div>
      </div>
      <button
        onClick={() => void cancel.run(() => api.cancelTimer(sessionId, timer.id))}
        aria-busy={cancel.pending || undefined}
        className="text-cc-muted hover:text-red-400 opacity-0 group-hover:opacity-100 focus:opacity-100 aria-busy:opacity-100 transition-opacity shrink-0 text-xs pt-0.5 cursor-pointer"
        title={cancel.error ?? "Cancel timer"}
      >
        ✕
      </button>
    </div>
  );
}

/**
 * Lists everything the session waits on: the server-reported waits first, in the
 * chip's order, then its timers with their cancel controls. With only timers it is
 * the familiar timer list.
 */
export function WaitingPopover({
  sessionId,
  onClose,
  anchor,
}: {
  sessionId: string;
  onClose: () => void;
  /** The chip that opens and closes this popover. Presses on it are left to its own toggle. */
  anchor?: HTMLElement | null;
}) {
  const { timers, waits } = useSessionWaiting(sessionId);
  const popoverRef = useRef<HTMLDivElement>(null);
  const count = timers.length + waits.length;
  const heading = waits.length > 0 ? "Waiting on" : "Session Timers";

  // Close on Escape — stop propagation so stacked handlers (search overlay, etc.) don't also fire.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", handler, { capture: true });
    return () => document.removeEventListener("keydown", handler, { capture: true });
  }, [onClose]);

  useOutsidePress([popoverRef, anchor], onClose);

  return createPortal(
    <div
      ref={popoverRef}
      className="fixed bottom-14 right-3 z-50 w-80 max-w-[calc(100vw-1.5rem)] max-h-[50vh] flex flex-col rounded-2xl border border-cc-border bg-cc-card/95 shadow-[0_25px_60px_rgba(0,0,0,0.5)] backdrop-blur-xl overflow-hidden"
      role="dialog"
      aria-label={heading}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-cc-border/50 shrink-0">
        <h2 className="text-[13px] font-medium text-cc-fg">
          {heading}
          <span className="ml-1.5 text-[11px] text-cc-muted font-normal">({count})</span>
        </h2>
        <button
          onClick={onClose}
          className="text-cc-muted hover:text-cc-fg transition-colors p-1 -mr-1 cursor-pointer"
          aria-label="Close"
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <path d="M4 4l8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>

      <div className="overflow-y-auto flex-1 divide-y divide-cc-border/30">
        {count === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-cc-muted">Not waiting on anything</p>
        ) : (
          <>
            {waits.map((wait, index) => (
              <WaitRow key={`${wait.kind}-${index}`} wait={wait} />
            ))}
            {timers.map((timer) => (
              <TimerRow key={timer.id} timer={timer} sessionId={sessionId} />
            ))}
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

// ─── Waiting chip (floating pill) ────────────────────────────────────────────

/** The chip's text for its leading wait: a main part that may truncate and a short suffix that stays. */
function chipText(wait: SessionWait): { main: string; suffix?: string } {
  if (wait.kind === "answer") return { main: "Your answer", suffix: wait.questId };
  if (wait.kind === "job") return { main: wait.description || "Background job", suffix: formatElapsed(wait.startedAt) };
  if (wait.kind === "landing") return { main: "Landing run" };
  return { main: wait.resource, suffix: `#${wait.position} in line` };
}

/**
 * Glassmorphic floating pill matching the Purring indicator style, naming what the
 * session waits on with that wait's icon: the leading server-reported wait, else the
 * soonest timer, plus a count of the rest. Tapping lists them all. Renders nothing
 * when the session waits on nothing.
 */
export function WaitingChip({ sessionId }: { sessionId: string }) {
  const { timers, waits } = useSessionWaiting(sessionId);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);

  const togglePopover = useCallback(() => setPopoverOpen((open) => !open), []);
  const closePopover = useCallback(() => setPopoverOpen(false), []);

  const count = timers.length + waits.length;
  if (count === 0) return null;
  const lead = waits[0];
  const kind = lead?.kind ?? "timer";
  const { main, suffix } = lead ? chipText(lead) : { main: `in ${formatCompactRelativeTime(timers[0].nextFireAt)}` };

  return (
    <>
      <button
        ref={chipRef}
        onClick={togglePopover}
        data-testid="waiting-chip"
        data-wait-kind={kind}
        aria-label={`Waiting on ${count === 1 ? "1 thing" : `${count} things`}`}
        className="pointer-events-auto relative inline-flex max-w-[min(18rem,calc(100vw-2.75rem))] items-center gap-1.5 overflow-hidden rounded-[18px] border border-white/8 bg-[linear-gradient(135deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02))] px-2.5 py-1 text-[11px] text-cc-muted font-mono-code shadow-[0_10px_30px_rgba(0,0,0,0.28)] backdrop-blur-md cursor-pointer hover:border-white/15 transition-colors"
      >
        <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,255,255,0.10),transparent_55%)]" />
        <WaitKindIcon kind={kind} className="relative h-3 w-3 shrink-0 text-emerald-500" />
        <span className="relative min-w-0 truncate text-cc-fg/90">{main}</span>
        {suffix && <span className="relative shrink-0 text-cc-fg/90">· {suffix}</span>}
        {count > 1 && <span className="relative shrink-0">· +{count - 1}</span>}
      </button>

      {popoverOpen && <WaitingPopover sessionId={sessionId} onClose={closePopover} anchor={chipRef.current} />}
    </>
  );
}
