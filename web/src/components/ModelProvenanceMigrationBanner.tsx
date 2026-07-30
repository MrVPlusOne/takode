import { useState } from "react";
import type { ModelProvenanceMigration } from "../types.js";

export function ModelProvenanceMigrationBanner({
  migration,
  onAcknowledge,
  defaultDetailsOpen = false,
}: {
  migration: ModelProvenanceMigration;
  onAcknowledge: (eventId: string) => Promise<unknown>;
  defaultDetailsOpen?: boolean;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (migration.acknowledgedAt !== undefined) return null;

  const acknowledge = async () => {
    setPending(true);
    setError(null);
    try {
      await onAcknowledge(migration.eventId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not dismiss the notice");
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      data-testid="model-provenance-migration-banner"
      role="status"
      aria-label="Model provenance migration notice"
      className="shrink-0 px-2 py-1.5 sm:px-4"
    >
      <div className="mx-auto max-w-4xl rounded-lg border border-cc-warning/30 bg-cc-card px-2.5 py-1.5 text-cc-fg shadow-sm">
        <div className="flex items-start gap-2">
          <span aria-hidden="true" className="mt-1 h-2 w-2 shrink-0 rounded-full bg-cc-warning" />
          <div className="min-w-0 flex-1 text-[11px] leading-4">
            <div className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="font-semibold text-cc-warning">Model provenance migrated</span>
              <span className="text-cc-muted">Takode preserved {migration.selectedModel} for this session family.</span>
            </div>
            <details className="mt-0.5" open={defaultDetailsOpen || undefined}>
              <summary className="w-fit cursor-pointer rounded text-cc-muted underline decoration-cc-muted/50 underline-offset-2 hover:text-cc-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-accent">
                Details
              </summary>
              <p className="mt-1 max-w-3xl text-cc-muted">{migration.warning}</p>
            </details>
            {error && (
              <p role="alert" className="mt-1 text-cc-error">
                {error}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={() => void acknowledge()}
            disabled={pending}
            aria-label="Dismiss model provenance migration notice"
            className="shrink-0 rounded-md border border-cc-border px-2 py-0.5 text-[11px] font-medium text-cc-muted hover:border-cc-warning/50 hover:text-cc-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-accent disabled:cursor-wait disabled:opacity-60"
          >
            {pending ? "Dismissing…" : "Dismiss"}
          </button>
        </div>
      </div>
    </div>
  );
}
