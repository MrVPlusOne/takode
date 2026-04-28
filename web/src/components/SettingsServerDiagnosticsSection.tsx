import { useState } from "react";
import { api, type InterruptRestartBlockersResponse, type ServerInterruptResultItem } from "../api.js";
import { CollapsibleSection } from "./CollapsibleSection.js";
import type { SettingsSearchResults, SettingsSectionId } from "./settings-search.js";

function ResultList({ items, emptyText }: { items: ServerInterruptResultItem[]; emptyText: string }) {
  if (items.length === 0) {
    return <p className="text-xs text-cc-muted">{emptyText}</p>;
  }

  return (
    <ul className="space-y-2 text-xs text-cc-fg">
      {items.map((item) => (
        <li key={item.sessionId} className="rounded-lg border border-cc-border bg-cc-hover/40 px-3 py-2">
          <div className="font-medium">{item.label}</div>
          <div className="mt-0.5 text-cc-muted">{item.reasons.join(", ")}</div>
          {item.detail && <div className="mt-1 text-cc-muted">{item.detail}</div>}
        </li>
      ))}
    </ul>
  );
}

function SessionSummaryList({
  items,
  emptyText,
}: {
  items: Array<{ sessionId: string; label: string }>;
  emptyText: string;
}) {
  if (items.length === 0) {
    return <p className="text-xs text-cc-muted">{emptyText}</p>;
  }

  return (
    <ul className="space-y-2 text-xs text-cc-fg">
      {items.map((item) => (
        <li key={item.sessionId} className="rounded-lg border border-cc-border bg-cc-hover/40 px-3 py-2">
          <div className="font-medium">{item.label}</div>
        </li>
      ))}
    </ul>
  );
}

function HerdDeliverySummary({ result }: { result: InterruptRestartBlockersResponse }) {
  const delivery = result.herdDelivery;
  if (!delivery.countsFinal) {
    return (
      <div className="space-y-1 text-xs text-cc-muted">
        <p>{delivery.detail ?? "Restart-prep herd delivery tracking is active."}</p>
        <p>
          Current suppressed prep events: {delivery.suppressed}. Current held unrelated events: {delivery.held}.
        </p>
      </div>
    );
  }

  return (
    <p className="text-xs text-cc-muted">
      Suppressed prep events: {delivery.suppressed}. Held unrelated events: {delivery.held}.
    </p>
  );
}

function RestartPrepResultPanel({ result, title }: { result: InterruptRestartBlockersResponse; title: string }) {
  return (
    <div className="space-y-3 rounded-lg border border-cc-border bg-cc-hover/30 px-3 py-3">
      <div>
        <p className="text-sm font-medium text-cc-fg">{title}</p>
        <p className="mt-0.5 text-xs text-cc-muted">
          {result.interrupted.length === 0 && result.skipped.length === 0 && result.failures.length === 0
            ? "No restart-blocking sessions were active."
            : result.restartRequested
              ? "Restart was requested after blockers cleared."
              : result.unresolvedBlockers.length > 0
                ? "Restart prep ran, but some blockers are still unresolved."
                : "Restart prep ran and no restart request was sent."}
        </p>
        <p className="mt-1 text-xs text-cc-muted">
          Mode: {result.mode}. Restart requested: {result.restartRequested ? "yes" : "no"}.
          {result.timedOut ? " Blocker wait timed out." : ""}
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-cc-muted">Interrupted</p>
        <ResultList items={result.interrupted} emptyText="No sessions needed interruption." />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-cc-muted">Skipped</p>
        <ResultList items={result.skipped} emptyText="No sessions were skipped." />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-cc-muted">Unresolved Blockers</p>
        <ResultList items={result.unresolvedBlockers} emptyText="No blockers remain reported." />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-cc-muted">Protected Leaders</p>
        <SessionSummaryList
          items={result.protectedLeaders}
          emptyText="No idle leaders needed herd-delivery protection."
        />
      </div>

      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wide text-cc-muted">Herd Delivery</p>
        <HerdDeliverySummary result={result} />
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-wide text-cc-muted">Failures</p>
        <ResultList items={result.failures} emptyText="No interrupt failures." />
      </div>
    </div>
  );
}

export function SettingsServerDiagnosticsSection({
  logFile,
  restartSupported,
  restartError,
  restartPrepResult,
  restarting,
  onRestartServer,
  sectionSearch,
}: {
  logFile: string;
  restartSupported: boolean;
  restartError: string;
  restartPrepResult?: InterruptRestartBlockersResponse | null;
  restarting: boolean;
  onRestartServer: () => void;
  sectionSearch?: {
    results: SettingsSearchResults;
    id: SettingsSectionId;
  };
}) {
  const [interrupting, setInterrupting] = useState(false);
  const [interruptError, setInterruptError] = useState("");
  const [interruptResult, setInterruptResult] = useState<InterruptRestartBlockersResponse | null>(null);
  const visibleRestartPrepResult = interruptResult ?? restartPrepResult ?? null;

  async function onInterruptRestartBlockers() {
    if (
      !window.confirm(
        "Prepare restart by interrupting active restart blockers? This stops active work, protects idle leaders from prep-related herd wakeups, and reports blockers that remain unresolved.",
      )
    ) {
      return;
    }

    setInterrupting(true);
    setInterruptError("");
    setInterruptResult(null);
    try {
      const result = await api.interruptRestartBlockers();
      setInterruptResult(result);
    } catch (error) {
      setInterruptError(error instanceof Error ? error.message : String(error));
    } finally {
      setInterrupting(false);
    }
  }

  return (
    <CollapsibleSection
      id="server"
      title="Server & Diagnostics"
      hidden={sectionSearch ? !sectionSearch.results.visibleSectionIds.has(sectionSearch.id) : false}
      searchQuery={sectionSearch?.results.query}
      matchCount={sectionSearch ? (sectionSearch.results.sectionMatchCounts.get(sectionSearch.id) ?? 0) : 0}
    >
      <div className="space-y-3">
        <div>
          <p className="text-sm font-medium text-cc-fg">Log Viewer</p>
          <p className="mt-0.5 text-xs text-cc-muted">
            Structured server/runtime logs with live streaming, filtering, and Takode CLI access.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            window.location.hash = "#/logs";
          }}
          className="px-3 py-2 rounded-lg text-sm font-medium bg-cc-hover text-cc-fg hover:bg-cc-active transition-colors cursor-pointer"
        >
          Open Log Viewer
        </button>

        {logFile && (
          <div className="px-3 py-2 rounded-lg bg-cc-hover/60 border border-cc-border text-xs text-cc-muted font-mono break-all">
            {logFile}
          </div>
        )}

        <p className="text-xs text-cc-muted">
          CLI access: <code className="font-mono">takode logs --level warn,error --follow</code>
        </p>

        <div className="border-t border-cc-border pt-3 space-y-3">
          <p className="text-xs text-cc-muted">
            Restart the server process. Useful after pulling new code. Sessions will reconnect automatically. If restart
            readiness is blocked by active turns or pending permission dialogs, interrupt those blockers here first.
          </p>

          {!restartSupported && (
            <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400">
              Restart not available. Start the server with{" "}
              <code className="font-mono bg-cc-hover px-1 py-0.5 rounded">make dev</code> or{" "}
              <code className="font-mono bg-cc-hover px-1 py-0.5 rounded">make serve</code> to enable.
            </div>
          )}

          {interruptError && (
            <div className="px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/20 text-xs text-cc-error">
              {interruptError}
            </div>
          )}

          {restartError && (
            <div className="px-3 py-2 rounded-lg bg-cc-error/10 border border-cc-error/20 text-xs text-cc-error">
              {restartError}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={onRestartServer}
              disabled={restarting || interrupting || !restartSupported}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                restarting || interrupting || !restartSupported
                  ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                  : "bg-cc-primary hover:bg-cc-primary-hover text-white cursor-pointer"
              }`}
            >
              {restarting ? "Restarting..." : "Restart Server"}
            </button>

            <button
              type="button"
              onClick={onInterruptRestartBlockers}
              disabled={interrupting || restarting}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                interrupting || restarting
                  ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                  : "bg-amber-500/15 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 cursor-pointer"
              }`}
            >
              {interrupting ? "Interrupting..." : "Interrupt Restart Blockers"}
            </button>
          </div>

          {visibleRestartPrepResult && (
            <RestartPrepResultPanel
              result={visibleRestartPrepResult}
              title={interruptResult ? "Interrupt Result" : "Restart Prep Result"}
            />
          )}
        </div>
      </div>
    </CollapsibleSection>
  );
}
