import type { ModelProvenanceMigration } from "../types.js";

export function ModelProvenanceMigrationBanner({ migration }: { migration: ModelProvenanceMigration }) {
  return (
    <div
      data-testid="model-provenance-migration-banner"
      role="alert"
      className="shrink-0 border-b border-cc-warning/35 bg-cc-warning/12 px-4 py-2.5 text-cc-warning"
    >
      <div className="mx-auto flex max-w-4xl items-start justify-center gap-2 text-center">
        <span aria-hidden="true" className="mt-1 h-2 w-2 shrink-0 rounded-full bg-cc-warning" />
        <div className="min-w-0">
          <div className="text-xs font-semibold">Model provenance migrated</div>
          <div className="mt-0.5 text-[11px] leading-relaxed text-cc-warning/90">{migration.warning}</div>
        </div>
      </div>
    </div>
  );
}
