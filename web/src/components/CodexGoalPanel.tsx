import { useEffect, useMemo, useRef, useState } from "react";
import { codexGoalApi } from "../api/codex-goal.js";
import type { SessionState } from "../types.js";

type Goal = SessionState["codex_goal"];
type Capability = SessionState["codex_goal_capability"];

const STATUS_LABEL: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  blocked: "Blocked",
  usage_limited: "Usage limited",
  budget_limited: "Budget limited",
  complete: "Complete",
};

function formatTokens(value: number | null | undefined): string {
  if (!value || value <= 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function statusClass(status: string | undefined): string {
  switch (status) {
    case "active":
      return "border-emerald-500/40 bg-emerald-500/10 text-emerald-300";
    case "paused":
      return "border-amber-500/40 bg-amber-500/10 text-amber-300";
    case "blocked":
    case "usage_limited":
    case "budget_limited":
      return "border-rose-500/40 bg-rose-500/10 text-rose-300";
    case "complete":
      return "border-sky-500/40 bg-sky-500/10 text-sky-300";
    default:
      return "border-cc-border bg-cc-hover text-cc-muted";
  }
}

export function CodexGoalPanel({
  sessionId,
  goal,
  capability,
  autoFocusObjective = false,
}: {
  sessionId: string;
  goal: Goal;
  capability: Capability;
  autoFocusObjective?: boolean;
}) {
  const objectiveRef = useRef<HTMLTextAreaElement | null>(null);
  const [draft, setDraft] = useState(goal?.objective ?? "");
  const [budgetDraft, setBudgetDraft] = useState(goal?.tokenBudget ? String(goal.tokenBudget) : "");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unsupported = capability?.state === "unsupported";

  useEffect(() => {
    setDraft(goal?.objective ?? "");
    setBudgetDraft(goal?.tokenBudget ? String(goal.tokenBudget) : "");
  }, [goal?.objective, goal?.tokenBudget]);

  useEffect(() => {
    if (!autoFocusObjective || unsupported) return;
    const raf = requestAnimationFrame(() => {
      objectiveRef.current?.focus();
      objectiveRef.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, [autoFocusObjective, unsupported]);

  const budgetValue = useMemo(() => {
    if (!budgetDraft.trim()) return null;
    const numeric = Number(budgetDraft);
    return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : Number.NaN;
  }, [budgetDraft]);

  async function run(label: string, action: () => Promise<unknown>) {
    setBusy(label);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  const controlsDisabled = !!busy || unsupported;
  const canSubmit = draft.trim().length > 0 && !Number.isNaN(budgetValue);

  return (
    <div className="space-y-2 rounded-md border border-cc-border bg-cc-bg/35 p-2.5">
      <div className="space-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-cc-muted/60">Codex Goal</span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${statusClass(goal?.status)}`}>
            {goal ? STATUS_LABEL[goal.status] || goal.status : unsupported ? "Unsupported" : "None"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            className="rounded-md border border-cc-border px-2 py-1 text-[11px] text-cc-muted hover:border-cc-primary/40 hover:bg-cc-hover hover:text-cc-fg disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!!busy}
            title="Refresh Codex Goal state"
            onClick={() => void run("refresh", () => codexGoalApi.refresh(sessionId))}
          >
            Refresh
          </button>
          {goal?.status === "active" ? (
            <button
              type="button"
              className="rounded-md border border-cc-border px-2 py-1 text-[11px] text-cc-muted hover:border-amber-400/40 hover:bg-cc-hover hover:text-cc-fg disabled:cursor-not-allowed disabled:opacity-45"
              disabled={controlsDisabled}
              title="Pause Codex Goal continuation"
              onClick={() => void run("pause", () => codexGoalApi.pause(sessionId))}
            >
              Pause
            </button>
          ) : (
            <button
              type="button"
              className="rounded-md border border-cc-border px-2 py-1 text-[11px] text-cc-muted hover:border-emerald-400/40 hover:bg-cc-hover hover:text-cc-fg disabled:cursor-not-allowed disabled:opacity-45"
              disabled={controlsDisabled || !goal}
              title="Resume Codex Goal"
              onClick={() => void run("resume", () => codexGoalApi.resume(sessionId))}
            >
              Resume
            </button>
          )}
          <button
            type="button"
            className="rounded-md border border-cc-border px-2 py-1 text-[11px] text-cc-muted hover:border-rose-400/40 hover:bg-cc-hover hover:text-cc-fg disabled:cursor-not-allowed disabled:opacity-45"
            disabled={controlsDisabled || !goal}
            title="Clear Codex Goal"
            onClick={() => void run("clear", () => codexGoalApi.clear(sessionId))}
          >
            Clear
          </button>
        </div>
      </div>

      {goal && (
        <div className="grid grid-cols-3 gap-2 text-[11px] text-cc-muted">
          <div>
            <span className="block text-[9px] uppercase text-cc-muted/60">Used</span>
            <span className="text-cc-fg">{formatTokens(goal.tokensUsed)}</span>
          </div>
          <div>
            <span className="block text-[9px] uppercase text-cc-muted/60">Budget</span>
            <span className="text-cc-fg">{goal.tokenBudget ? formatTokens(goal.tokenBudget) : "None"}</span>
          </div>
          <div>
            <span className="block text-[9px] uppercase text-cc-muted/60">Time</span>
            <span className="text-cc-fg">{Math.max(0, Math.round(goal.timeUsedSeconds / 60))}m</span>
          </div>
        </div>
      )}

      <textarea
        ref={objectiveRef}
        className="h-16 w-full resize-none rounded-md border border-cc-border bg-cc-input px-2 py-1.5 text-xs text-cc-fg outline-none focus:border-cc-primary/60"
        value={draft}
        disabled={unsupported}
        aria-label="Codex Goal objective"
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="h-8 min-w-24 flex-1 rounded-md border border-cc-border bg-cc-input px-2 text-xs text-cc-fg outline-none focus:border-cc-primary/60"
          value={budgetDraft}
          disabled={unsupported}
          inputMode="numeric"
          aria-label="Codex Goal token budget"
          placeholder="Budget"
          onChange={(event) => setBudgetDraft(event.target.value)}
        />
        <button
          type="button"
          className="h-8 rounded-md border border-cc-border px-2.5 text-xs text-cc-fg hover:border-cc-primary/40 hover:bg-cc-hover disabled:cursor-not-allowed disabled:opacity-45"
          disabled={controlsDisabled || !canSubmit}
          title="Edit in place and preserve usage when the backend supports it"
          onClick={() =>
            void run("edit", () =>
              codexGoalApi.set(sessionId, { objective: draft.trim(), tokenBudget: budgetValue, mode: "edit" }),
            )
          }
        >
          Edit
        </button>
        <button
          type="button"
          className="h-8 rounded-md border border-cc-border px-2.5 text-xs text-cc-fg hover:border-cc-primary/40 hover:bg-cc-hover disabled:cursor-not-allowed disabled:opacity-45"
          disabled={controlsDisabled || !canSubmit}
          title="Replace by clearing the current Goal before setting a new objective"
          onClick={() =>
            void run("replace", () =>
              codexGoalApi.set(sessionId, { objective: draft.trim(), tokenBudget: budgetValue, mode: "replace" }),
            )
          }
        >
          Replace
        </button>
      </div>

      {(busy || error || capability?.error) && (
        <div className={`text-[11px] ${error ? "text-cc-error" : "text-cc-muted"}`}>
          {error || (busy ? `${busy}...` : capability?.error)}
        </div>
      )}
    </div>
  );
}
