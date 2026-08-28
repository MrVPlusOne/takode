import { useStore } from "../store.js";

function subagentCountLabel(total: number, coverage: "complete" | "partial"): string {
  if (coverage === "partial") return total > 0 ? `${total}+` : "?";
  return String(total);
}

export function CodexSubagentFeedControl({ sessionId }: { sessionId: string }) {
  const session = useStore((state) => state.sessions.get(sessionId));
  const inspectorOpen = useStore((state) => state.codexSubagentInspector?.sessionId === sessionId);
  const openInspector = useStore((state) => state.openCodexSubagentInspector);
  const closeInspector = useStore((state) => state.closeCodexSubagentInspector);

  if (session?.backend_type !== "codex") return null;

  const snapshot = session.codex_native_subagents;
  const count = snapshot ? subagentCountLabel(snapshot.session.total, snapshot.coverage) : "?";
  const status = !snapshot
    ? "Unavailable"
    : snapshot.session.activeCount > 0
      ? `${snapshot.session.activeCount} active`
      : snapshot.session.unresolvedCount > 0
        ? `${snapshot.session.unresolvedCount} unresolved`
        : snapshot.session.total > 0
          ? "History"
          : snapshot.coverage === "partial"
            ? "Unknown"
            : "None";
  const coverage = snapshot ? `${snapshot.coverage} coverage` : "Snapshot unavailable";

  return (
    <div
      className="pointer-events-none flex shrink-0 justify-end px-2 pb-1 pt-2 sm:px-4"
      data-testid="codex-subagent-feed-control-row"
    >
      <button
        type="button"
        onClick={() => (inspectorOpen ? closeInspector() : openInspector(sessionId))}
        className={`pointer-events-auto inline-flex min-h-11 max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-primary/45 ${
          inspectorOpen
            ? "border-cc-primary/30 bg-cc-active text-cc-primary"
            : "border-cc-border/70 bg-cc-card/90 text-cc-muted hover:border-cc-primary/30 hover:bg-cc-hover hover:text-cc-fg"
        }`}
        aria-label={`Codex subagents: ${count}. ${status}. ${coverage}. ${inspectorOpen ? "Close" : "Open"} inspector.`}
        aria-expanded={inspectorOpen}
        data-testid="feed-codex-subagents"
      >
        <svg
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          className="h-4 w-4 shrink-0 text-cc-primary"
          aria-hidden="true"
        >
          <circle cx="4" cy="4" r="1.5" />
          <circle cx="12" cy="8" r="1.5" />
          <circle cx="12" cy="13" r="1.5" />
          <path d="M5.5 4h1A2.5 2.5 0 019 6.5v4A2.5 2.5 0 0011.5 13M9 8h1.5" />
        </svg>
        <span className="tabular-nums text-cc-fg">{count}</span>
        <span>
          subagent
          {snapshot?.session.total === 1 && snapshot.coverage === "complete" ? "" : "s"}
        </span>
        <span aria-hidden="true" className="text-cc-muted/50">
          ·
        </span>
        <span
          className={
            snapshot?.session.activeCount
              ? "text-cc-success"
              : snapshot?.session.unresolvedCount
                ? "text-cc-warning"
                : "text-cc-muted"
          }
        >
          {status}
        </span>
        {snapshot?.coverage === "partial" && (
          <span className="rounded bg-cc-warning/10 px-1 py-0.5 text-[9px] uppercase tracking-wide text-cc-warning">
            Partial
          </span>
        )}
      </button>
    </div>
  );
}
