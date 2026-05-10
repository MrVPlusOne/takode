import type { InterruptRestartBlockersResponse, ServerInterruptResultItem } from "../api.js";
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
          {item.diagnostics && (
            <div className="mt-1 font-mono text-[11px] text-cc-muted">
              Diagnostics:{" "}
              {Object.entries(item.diagnostics)
                .map(([key, value]) => `${key}=${String(value)}`)
                .join(", ")}
            </div>
          )}
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
        {result.retryAttempts.length > 0 && (
          <p className="mt-1 text-xs text-cc-muted">
            Retry attempts: {result.retryAttempts.length}. Final retry blockers:{" "}
            {result.retryAttempts.at(-1)?.remainingBlockers.length ?? 0}.
          </p>
        )}
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
        <p className="text-xs font-medium uppercase tracking-wide text-cc-muted">Fallbacks</p>
        <ResultList items={result.fallbacks} emptyText="No Codex fallback was needed." />
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
  serverSlug,
  setServerSlug,
  serverSlugSaving,
  serverSlugError,
  restartSupported,
  restartError,
  restartPrepResult,
  restarting,
  onSaveServerSlug,
  onRestartServer,
  sectionSearch,
}: {
  logFile: string;
  serverSlug: string;
  setServerSlug: (value: string) => void;
  serverSlugSaving: boolean;
  serverSlugError: string;
  restartSupported: boolean;
  restartError: string;
  restartPrepResult?: InterruptRestartBlockersResponse | null;
  restarting: boolean;
  onSaveServerSlug: (value: string) => void;
  onRestartServer: () => void;
  sectionSearch?: {
    results: SettingsSearchResults;
    id: SettingsSectionId;
  };
}) {
  const visibleRestartPrepResult = restartPrepResult ?? null;

  return (
    <CollapsibleSection
      id="server"
      title="Server & Diagnostics"
      hidden={sectionSearch ? !sectionSearch.results.visibleSectionIds.has(sectionSearch.id) : false}
      searchQuery={sectionSearch?.results.query}
      matchCount={sectionSearch ? (sectionSearch.results.sectionMatchCounts.get(sectionSearch.id) ?? 0) : 0}
    >
      <div className="space-y-3">
        <div
          hidden={
            sectionSearch ? !sectionSearch.results.visibleItemIds.get(sectionSearch.id)?.has("server-slug") : false
          }
        >
          <label className="block text-sm font-medium text-cc-fg mb-1.5" htmlFor="server-slug">
            Server Slug
          </label>
          <div className="flex gap-2">
            <input
              id="server-slug"
              type="text"
              value={serverSlug}
              onChange={(event) => setServerSlug(event.target.value)}
              onBlur={() => onSaveServerSlug(serverSlug)}
              className="flex-1 px-3 py-2.5 text-sm bg-cc-input-bg border border-cc-border rounded-lg text-cc-fg placeholder:text-cc-muted focus:outline-none focus:border-cc-primary/60 font-mono"
              placeholder="prod"
            />
            <button
              type="button"
              onClick={() => onSaveServerSlug(serverSlug)}
              disabled={serverSlugSaving}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                serverSlugSaving
                  ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                  : "bg-cc-hover text-cc-fg hover:bg-cc-active cursor-pointer"
              }`}
            >
              {serverSlugSaving ? "Saving..." : "Save"}
            </button>
          </div>
          <p className="mt-1.5 text-xs text-cc-muted">
            Used for model-facing memory paths such as{" "}
            <code className="font-mono">~/.companion/memory/prod/Takode</code>. Existing memory data is moved to the
            current session-space path on the next memory operation.
          </p>
          {serverSlugError && <p className="mt-1.5 text-xs text-cc-error">{serverSlugError}</p>}
        </div>

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
            readiness is blocked by active turns or pending permission dialogs, restart prep interrupts active blockers
            first and reports anything still unresolved.
          </p>

          {!restartSupported && (
            <div className="px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400">
              Restart not available. Start the server with{" "}
              <code className="font-mono bg-cc-hover px-1 py-0.5 rounded">make dev</code> or{" "}
              <code className="font-mono bg-cc-hover px-1 py-0.5 rounded">make serve</code> to enable.
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
              disabled={restarting || !restartSupported}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                restarting || !restartSupported
                  ? "bg-cc-hover text-cc-muted cursor-not-allowed"
                  : "bg-cc-primary hover:bg-cc-primary-hover text-white cursor-pointer"
              }`}
            >
              {restarting ? "Restarting..." : "Restart Server"}
            </button>
          </div>

          {visibleRestartPrepResult && (
            <RestartPrepResultPanel result={visibleRestartPrepResult} title="Restart Prep Result" />
          )}
        </div>
      </div>
    </CollapsibleSection>
  );
}
