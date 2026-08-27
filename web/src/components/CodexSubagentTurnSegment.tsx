import type {
  CodexNativeSubagentSnapshot,
  CodexNativeSubagentStatus,
} from "../../shared/codex-native-subagent-types.js";
import { useStore } from "../store.js";

const STATUS_LABELS: Record<CodexNativeSubagentStatus, string> = {
  starting: "Starting",
  working: "Working",
  waiting: "Waiting",
  done: "Done",
  failed: "Failed",
  interrupted: "Interrupted",
  unknown: "Unknown",
};

const STATUS_CLASSES: Record<CodexNativeSubagentStatus, string> = {
  starting: "text-cc-info",
  working: "text-cc-success",
  waiting: "text-cc-warning",
  done: "text-cc-muted",
  failed: "text-cc-error",
  interrupted: "text-cc-warning",
  unknown: "text-cc-muted",
};

export function CodexSubagentTurnSegment({
  sessionId,
  turnId,
  className = "",
}: {
  sessionId: string;
  turnId: string;
  className?: string;
}) {
  const aggregate = useStore((state) => state.sessions.get(sessionId)?.codex_native_subagents?.turns[turnId]);
  const openInspector = useStore((state) => state.openCodexSubagentInspector);

  if (!aggregate || (aggregate.coverage === "complete" && aggregate.total === 0)) return null;

  const countLabel =
    aggregate.total > 0
      ? `${aggregate.total}${aggregate.coverage === "partial" ? "+" : ""} Codex subagent${aggregate.total === 1 ? "" : "s"}`
      : "Codex subagents";
  const statusLabel = STATUS_LABELS[aggregate.status];
  const coverageLabel = aggregate.coverage === "partial" ? "Coverage partial." : "Coverage complete.";

  return (
    <button
      type="button"
      onClick={() => openInspector(sessionId, { scopeTurnId: turnId })}
      className={`inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-md border border-cc-border bg-cc-card/70 px-2 py-1 text-[11px] font-mono-code text-cc-fg/80 transition-colors hover:border-cc-primary/35 hover:bg-cc-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-primary/45 ${className}`}
      aria-label={`Open Codex subagents for this turn. ${countLabel}. ${statusLabel}. ${coverageLabel}`}
      data-testid="codex-subagent-turn-segment"
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.35"
        className="h-3.5 w-3.5 shrink-0 text-cc-primary"
        aria-hidden="true"
      >
        <circle cx="4" cy="3.5" r="1.5" />
        <circle cx="12" cy="7.5" r="1.5" />
        <circle cx="12" cy="12.5" r="1.5" />
        <path d="M5.5 3.5h1.25A2.25 2.25 0 019 5.75v4.5a2.25 2.25 0 002.25 2.25h-.75M9 7.5h1.5" />
      </svg>
      <span className="truncate">{countLabel}</span>
      <span aria-hidden="true" className="text-cc-muted/60">
        ·
      </span>
      <span className={`shrink-0 ${STATUS_CLASSES[aggregate.status]}`}>{statusLabel}</span>
      {aggregate.coverage === "partial" && (
        <span className="shrink-0 rounded bg-cc-warning/10 px-1 py-0.5 text-[9px] uppercase tracking-wide text-cc-warning">
          Partial
        </span>
      )}
    </button>
  );
}
