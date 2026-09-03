import type { Ref } from "react";
import { flushSync } from "react-dom";
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
          <span>{summarizeWorkerEventActivity(stats.herdEventCount)}</span>
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
      type="button"
      onClick={(event) => {
        const turnContainer = event.currentTarget.closest<HTMLElement>("[data-turn-id]");
        flushSync(onClick);
        turnContainer?.querySelector<HTMLButtonElement>("[data-turn-toggle]")?.focus({ preventScroll: true });
      }}
      aria-expanded="true"
      aria-label="Collapse turn from top"
      className="w-full flex items-center gap-1.5 py-1 px-2 -mb-1 rounded hover:bg-cc-hover/40 transition-colors cursor-pointer text-[11px] text-cc-muted/50 hover:text-cc-muted font-mono-code"
      title="Collapse turn"
    >
      <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 shrink-0 transition-transform rotate-90">
        <path d="M6 4l4 4-4 4" />
      </svg>
      <TurnSummaryStats stats={stats} durationMs={durationMs} separatorClass="text-cc-muted/30" />
    </button>
  );
}
