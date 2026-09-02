import { memo, type Ref } from "react";
import type { TurnStats } from "../hooks/use-feed-model.js";
import { summarizeWorkerEventActivity } from "../utils/herd-event-classification.js";
import { formatElapsed } from "./message-feed-utils.js";

interface TurnSummaryStatsProps {
  stats: TurnStats;
  durationMs: number | null;
  separatorClass: string;
}

export function TurnSummaryStats({ stats, durationMs, separatorClass }: TurnSummaryStatsProps) {
  const hasMessages = stats.messageCount > 0;
  const hasTools = stats.toolCount > 0;
  const hasAgents = stats.subagentCount > 0;
  const hasHerdEvents = stats.herdEventCount > 0;
  const hasDuration = durationMs !== null;

  return (
    <>
      {hasMessages && (
        <span>
          {stats.messageCount} message{stats.messageCount !== 1 ? "s" : ""}
        </span>
      )}
      {hasTools && (
        <>
          {hasMessages && <span className={separatorClass}>·</span>}
          <span>
            {stats.toolCount} tool{stats.toolCount !== 1 ? "s" : ""}
          </span>
        </>
      )}
      {hasAgents && (
        <>
          {(hasMessages || hasTools) && <span className={separatorClass}>·</span>}
          <span>
            {stats.subagentCount} agent{stats.subagentCount !== 1 ? "s" : ""}
          </span>
        </>
      )}
      {hasHerdEvents && (
        <>
          {(hasMessages || hasTools || hasAgents) && <span className={separatorClass}>·</span>}
          <span>{summarizeWorkerEventActivity(stats.herdEventCount, stats.herdEventLifecycle ?? [])}</span>
        </>
      )}
      {hasDuration && (
        <>
          {(hasMessages || hasTools || hasAgents || hasHerdEvents) && <span className={separatorClass}>·</span>}
          <span data-testid="turn-summary-duration">{formatElapsed(durationMs)}</span>
        </>
      )}
    </>
  );
}

function hasTurnSummaryStats(stats: TurnStats, durationMs: number | null): boolean {
  return (
    stats.messageCount > 0 ||
    stats.toolCount > 0 ||
    stats.subagentCount > 0 ||
    stats.herdEventCount > 0 ||
    durationMs !== null
  );
}

export const CollapsedActivityBar = memo(function CollapsedActivityBar({
  stats,
  durationMs,
  leaderMode,
  onClick,
}: {
  stats: TurnStats;
  durationMs: number | null;
  leaderMode: boolean;
  onClick: () => void;
}) {
  const hasStats = hasTurnSummaryStats(stats, durationMs);
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-1.5 py-1.5 px-3 border-l-2 border-cc-border/40 bg-cc-hover/10 hover:bg-cc-hover/30 transition-colors cursor-pointer text-[11px] text-cc-muted font-mono-code"
    >
      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0 text-cc-muted/60">
        <path d="M6 4l4 4-4 4" />
      </svg>
      {leaderMode && (
        <>
          <span>Leader activity</span>
          {hasStats && <span className="text-cc-muted/40">·</span>}
        </>
      )}
      <TurnSummaryStats stats={stats} durationMs={durationMs} separatorClass="text-cc-muted/40" />
    </button>
  );
});

export function TurnCollapseBar({
  stats,
  durationMs,
  onClick,
  ref,
}: {
  stats: TurnStats;
  durationMs: number | null;
  onClick: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <button
      ref={ref}
      onClick={onClick}
      className="w-full flex items-center gap-1.5 py-1 px-2 -mb-1 rounded hover:bg-cc-hover/40 transition-colors cursor-pointer text-[11px] text-cc-muted/50 hover:text-cc-muted font-mono-code"
      title="Collapse this turn"
    >
      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0 transition-transform rotate-90">
        <path d="M6 4l4 4-4 4" />
      </svg>
      <TurnSummaryStats stats={stats} durationMs={durationMs} separatorClass="text-cc-muted/30" />
    </button>
  );
}
