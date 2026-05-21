import { useEffect, useState } from "react";
import { api } from "../api.js";
import { MarkdownContent } from "./MarkdownContent.js";

interface ChangelogState {
  markdown: string;
  sourcePath: string;
}

export function ChangelogPage() {
  const [changelog, setChangelog] = useState<ChangelogState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setChangelog(null);

    void api
      .getChangelog()
      .then((response) => {
        if (cancelled) return;
        setChangelog(response);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="h-full bg-cc-bg text-cc-fg font-sans-ui antialiased overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 py-6 sm:px-8 sm:py-10">
        <header className="mb-4 flex flex-col gap-3 border-b border-cc-border pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-cc-fg">Changelog</h1>
            <p className="mt-1 text-xs text-cc-muted">{changelog?.sourcePath ?? "CHANGELOG.md"}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              window.location.hash = "#/settings";
            }}
            className="w-fit rounded-lg bg-cc-hover px-3 py-2 text-sm font-medium text-cc-fg transition-colors hover:bg-cc-active focus:outline-none focus:ring-2 focus:ring-cc-primary/40"
          >
            Back to Settings
          </button>
        </header>

        {loading && (
          <div
            className="space-y-3 rounded-lg border border-cc-border bg-cc-surface px-4 py-4"
            aria-label="Loading changelog"
          >
            <div className="h-4 w-40 rounded bg-cc-hover" />
            <div className="h-3 w-full max-w-2xl rounded bg-cc-hover/70" />
            <div className="h-3 w-3/4 rounded bg-cc-hover/70" />
          </div>
        )}

        {!loading && error && (
          <div role="alert" className="rounded-lg border border-cc-error/20 bg-cc-error/10 px-4 py-3">
            <p className="text-sm font-medium text-cc-fg">Changelog unavailable</p>
            <p className="mt-1 text-xs text-cc-error">{error}</p>
          </div>
        )}

        {!loading && changelog && (
          <main className="min-w-0 rounded-lg border border-cc-border bg-cc-surface px-4 py-4 sm:px-5">
            <MarkdownContent text={changelog.markdown} wrapLongContent className="max-w-none" />
          </main>
        )}
      </div>
    </div>
  );
}
