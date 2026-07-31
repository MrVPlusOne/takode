import type {
  CodexAutoPauseRecoveryOutcome,
  CodexAutoPauseRecoveryReceipt,
  CodexAutoPauseRecoverySummary as RecoverySummary,
} from "../types.js";
import { useState } from "react";

const OUTCOME_LABELS: Record<CodexAutoPauseRecoveryOutcome, string> = {
  released_to_delivery: "Released",
  delivered: "Delivered",
  suppressed: "Suppressed",
  discarded: "Discarded",
  failed: "Failed",
};

function outcomeClasses(outcome: CodexAutoPauseRecoveryOutcome): string {
  if (outcome === "delivered") return "border-emerald-400/25 bg-emerald-400/10 text-emerald-200";
  if (outcome === "released_to_delivery") return "border-blue-400/25 bg-blue-400/10 text-blue-200";
  if (outcome === "failed") return "border-red-400/25 bg-red-400/10 text-red-200";
  return "border-amber-400/25 bg-amber-400/10 text-amber-200";
}

function formatTime(timestamp: number | undefined): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function receiptTitle(receipt: CodexAutoPauseRecoveryReceipt): string {
  return receipt.sourceDetail ? `${receipt.sourceLabel} · ${receipt.sourceDetail}` : receipt.sourceLabel;
}

export function CodexAutoPauseRecoverySummary({ summary }: { summary: RecoverySummary }) {
  const terminalCount = summary.receipts.filter((receipt) => receipt.outcome !== "released_to_delivery").length;
  const deliveredCount = summary.receipts.filter((receipt) => receipt.outcome === "delivered").length;
  const issueCount = summary.receipts.filter((receipt) =>
    ["suppressed", "discarded", "failed"].includes(receipt.outcome),
  ).length;
  const settled = summary.status === "settled";
  const [open, setOpen] = useState(!settled || issueCount > 0);

  return (
    <section
      aria-label="Automatic input recovery summary"
      aria-live="polite"
      data-testid="codex-auto-pause-recovery-summary"
      className="rounded-lg border border-cc-border/70 bg-cc-card/70 px-3 py-2.5 text-xs text-cc-fg"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium">
            {settled ? "Automatic input recovery complete" : "Releasing held automatic inputs"}
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-cc-muted">
            A manual recovery probe succeeded. Held inputs were released through the exact-once delivery path.
          </p>
        </div>
        <span className="shrink-0 rounded-full border border-cc-border/60 px-2 py-0.5 font-mono-code text-[10px] text-cc-muted">
          {terminalCount}/{summary.receipts.length} settled
        </span>
      </div>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 font-mono-code text-[10px] text-cc-muted">
        {deliveredCount > 0 && <span className="text-emerald-300/80">{deliveredCount} delivered</span>}
        {issueCount > 0 && <span className="text-amber-300/80">{issueCount} not delivered</span>}
        {!settled && <span>{summary.receipts.length - terminalCount} awaiting delivery</span>}
        <span>Updated {formatTime(summary.updatedAt)}</span>
      </div>

      <details className="mt-2" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary className="cursor-pointer select-none text-[11px] font-medium text-cc-muted hover:text-cc-fg">
          Inspect held input outcomes
        </summary>
        <ul className="mt-2 space-y-1.5" aria-label="Held input outcomes">
          {summary.receipts.map((receipt) => (
            <li
              key={receipt.groupId}
              className="rounded-md border border-cc-border/50 bg-cc-bg/35 px-2.5 py-2"
              data-testid={`codex-auto-pause-receipt-${receipt.outcome}`}
            >
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate font-medium" title={receiptTitle(receipt)}>
                  {receiptTitle(receipt)}
                </span>
                <span
                  className={`rounded border px-1.5 py-0.5 font-mono-code text-[10px] ${outcomeClasses(receipt.outcome)}`}
                >
                  {OUTCOME_LABELS[receipt.outcome]}
                </span>
                {receipt.count > 1 && (
                  <span className="rounded bg-cc-hover px-1.5 py-0.5 font-mono-code text-[10px] text-cc-muted">
                    ×{receipt.count}
                  </span>
                )}
              </div>
              <p className="mt-1 leading-relaxed text-cc-muted">{receipt.reason}</p>
              {receipt.coalescedCount > 0 && (
                <p className="mt-1 text-[10px] text-cc-muted/80">
                  {receipt.coalescedCount} similar input{receipt.coalescedCount === 1 ? " was" : "s were"} coalesced
                  into representative {receipt.survivingGroupId?.slice(-8)}.
                </p>
              )}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 font-mono-code text-[10px] text-cc-muted/70">
                <span title={new Date(receipt.queuedAt).toISOString()}>Held {formatTime(receipt.queuedAt)}</span>
                <span title={new Date(receipt.releasedAt).toISOString()}>
                  Released {formatTime(receipt.releasedAt)}
                </span>
                {receipt.terminalAt && (
                  <span title={new Date(receipt.terminalAt).toISOString()}>
                    Terminal {formatTime(receipt.terminalAt)}
                  </span>
                )}
                <span title={receipt.groupId}>Group {receipt.groupId.slice(-8)}</span>
              </div>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
