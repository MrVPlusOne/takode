import { useState, useEffect, useMemo } from "react";
import { useStore } from "../store.js";
import { api } from "../api.js";
import type { SessionTimer } from "../types.js";

const EMPTY_TIMERS: SessionTimer[] = [];

/** Format an epoch timestamp as a relative human-readable duration from now. */
function formatRelativeTime(epochMs: number): string {
  const diffMs = epochMs - Date.now();
  if (diffMs <= 0) return "firing...";
  const totalSeconds = Math.ceil(diffMs / 1_000);
  if (totalSeconds < 60) return `in ${totalSeconds}s`;
  const minutes = Math.ceil(diffMs / 60_000);
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainMins = minutes % 60;
  return remainMins > 0 ? `in ${hours}h${remainMins}m` : `in ${hours}h`;
}

function TimerRow({ timer, sessionId }: { timer: SessionTimer; sessionId: string }) {
  const typeLabel =
    timer.type === "recurring"
      ? `every ${timer.originalSpec}`
      : timer.type === "delay"
        ? `in ${timer.originalSpec}`
        : `at ${timer.originalSpec}`;

  return (
    <div className="flex items-center gap-2 text-xs group">
      <span className="font-mono text-cc-muted shrink-0">{timer.id}</span>
      <span className="truncate flex-1 text-cc-text-secondary" title={timer.prompt}>
        {timer.prompt}
      </span>
      <span className="text-cc-muted whitespace-nowrap shrink-0">{typeLabel}</span>
      <span className="text-cc-muted whitespace-nowrap shrink-0">
        {formatRelativeTime(timer.nextFireAt)}
      </span>
      <button
        onClick={() => void api.cancelTimer(sessionId, timer.id)}
        className="text-cc-muted hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
        title="Cancel timer"
      >
        ✕
      </button>
    </div>
  );
}

export function TimerWidget({ sessionId }: { sessionId: string }) {
  const timers = useStore((s) => s.sessionTimers?.get(sessionId) ?? EMPTY_TIMERS);
  const [expanded, setExpanded] = useState(false);

  // Auto-refresh relative times every 10 seconds
  const [, setTick] = useState(0);
  useEffect(() => {
    if (timers.length === 0) return;
    const interval = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(interval);
  }, [timers.length]);

  if (timers.length === 0) return null;

  // Sort by nextFireAt ascending (soonest first), memoized to avoid re-sorting on tick re-renders
  const sorted = useMemo(
    () => [...timers].sort((a, b) => a.nextFireAt - b.nextFireAt),
    [timers],
  );

  return (
    <div className="shrink-0 border-t border-cc-border bg-cc-bg">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-cc-muted hover:text-cc-text-secondary transition-colors cursor-pointer"
      >
        <span>⏰</span>
        <span>
          {timers.length} timer{timers.length !== 1 ? "s" : ""}
        </span>
        <span className="text-cc-muted">
          {" "}
          -- next {formatRelativeTime(sorted[0].nextFireAt)}
        </span>
        <span className="ml-auto">{expanded ? "▴" : "▾"}</span>
      </button>

      {expanded && (
        <div className="px-3 pb-2 space-y-1.5 max-h-48 overflow-y-auto">
          {sorted.map((timer) => (
            <TimerRow key={timer.id} timer={timer} sessionId={sessionId} />
          ))}
        </div>
      )}
    </div>
  );
}
