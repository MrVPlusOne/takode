import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  api,
  type MemoryCatalogEntry,
  type MemoryCatalogResponse,
  type MemoryFile,
  type MemoryKind,
  type MemoryLintIssue,
  type MemoryRecordResponse,
  type MemorySpaceInfo,
  type MemorySpacesResponse,
} from "../api.js";

interface MemoryPageProps {
  embedded?: boolean;
}

type LoadState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: null; error: string };

const MEMORY_KINDS: MemoryKind[] = ["current", "knowledge", "procedures", "decisions", "references", "artifacts"];

function formatDate(value: number | string | undefined): string {
  if (!value) return "none";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function sourceHref(source: string): string | undefined {
  const ref = source.trim();
  if (!ref) return undefined;
  if (/^https?:\/\//.test(ref)) return ref;

  const sessionMatch = /^session:([^:\s]+)(?::([^:\s]+))?$/i.exec(ref);
  if (sessionMatch) {
    const [, sessionId, messageId] = sessionMatch;
    if (messageId) return `#/session/${encodeURIComponent(sessionId)}/msg/${encodeURIComponent(messageId)}`;
    return `#/session/${encodeURIComponent(sessionId)}`;
  }

  const messageMatch = /^message:([^:\s]+):([^:\s]+)$/i.exec(ref);
  if (messageMatch) {
    const [, sessionId, messageId] = messageMatch;
    return `#/session/${encodeURIComponent(sessionId)}/msg/${encodeURIComponent(messageId)}`;
  }

  const questMatch = /^(?:quest:)?(q-\d+)$/i.exec(ref);
  if (questMatch) return `#/questmaster?quest=${encodeURIComponent(questMatch[1].toLowerCase())}`;
  return undefined;
}

function issueTone(issue: MemoryLintIssue): string {
  return issue.severity === "error"
    ? "border-red-500/25 bg-red-500/10 text-red-200"
    : "border-amber-500/25 bg-amber-500/10 text-amber-200";
}

function healthTone(catalog: MemoryCatalogResponse | null): string {
  if (!catalog) return "border-cc-border bg-cc-hover text-cc-muted";
  if (catalog.issueCounts.errors > 0) return "border-red-500/25 bg-red-500/10 text-red-200";
  if (catalog.issueCounts.warnings > 0) return "border-amber-500/25 bg-amber-500/10 text-amber-200";
  return "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";
}

function sourceLabel(source: string): ReactNode {
  const href = sourceHref(source);
  if (!href) return source;
  return (
    <a href={href} className="text-cc-primary hover:underline">
      {source}
    </a>
  );
}

function copyText(value: string): void {
  void navigator.clipboard?.writeText(value).catch(() => undefined);
}

function openPath(absolutePath: string, targetKind: "file" | "directory"): void {
  void api.openVsCodeRemoteFile({ absolutePath, targetKind }).catch(() => undefined);
}

function SkeletonRows({ count = 4 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="rounded-md border border-cc-border bg-cc-card p-3">
          <div className="h-3 w-3/5 rounded bg-cc-hover" />
          <div className="mt-2 h-2 w-4/5 rounded bg-cc-hover/70" />
          <div className="mt-3 h-2 w-1/3 rounded bg-cc-hover/70" />
        </div>
      ))}
    </div>
  );
}

function SpaceButton({
  space,
  selected,
  onSelect,
}: {
  space: MemorySpaceInfo;
  selected: boolean;
  onSelect: () => void;
}) {
  const label = space.sessionSpaceSlug ? `${space.slug}/${space.sessionSpaceSlug}` : space.slug;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
        selected ? "border-cc-primary/60 bg-cc-active" : "border-cc-border bg-cc-card hover:bg-cc-hover"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-sm font-semibold text-cc-fg">{label}</div>
        <span className="shrink-0 rounded bg-cc-hover px-1.5 py-0.5 text-[10px] text-cc-muted">
          {space.current ? "current" : space.initialized ? "repo" : "dir"}
        </span>
      </div>
      <div className="mt-1 truncate font-mono text-[10px] text-cc-muted">{space.root}</div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
        <span className="rounded bg-cc-hover px-1.5 py-0.5 text-cc-muted">{space.authoredDirs.length} dirs</span>
        <span className="rounded bg-cc-hover px-1.5 py-0.5 text-cc-muted">
          {space.hasAuthoredData ? "has records" : "empty"}
        </span>
      </div>
    </button>
  );
}

function EntryRow({
  entry,
  issues,
  selected,
  onSelect,
}: {
  entry: MemoryCatalogEntry;
  issues: MemoryLintIssue[];
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-md border p-3 text-left transition-colors ${
        selected ? "border-cc-primary/60 bg-cc-active" : "border-cc-border bg-cc-card hover:bg-cc-hover"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="break-all font-mono text-[11px] text-cc-fg">{entry.path}</div>
          <div className="mt-1 line-clamp-2 text-xs leading-relaxed text-cc-muted">
            {entry.description || "Missing description."}
          </div>
        </div>
        <span className="shrink-0 rounded border border-cc-border bg-cc-hover px-1.5 py-0.5 text-[10px] text-cc-muted">
          {entry.kind}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
        {entry.source.slice(0, 3).map((source) => (
          <span key={source} className="rounded bg-cc-hover px-1.5 py-0.5 text-cc-muted">
            {source}
          </span>
        ))}
        {entry.source.length > 3 ? (
          <span className="rounded bg-cc-hover px-1.5 py-0.5 text-cc-muted">+{entry.source.length - 3}</span>
        ) : null}
        {issues.length ? (
          <span className={`rounded border px-1.5 py-0.5 ${issueTone(issues[0]!)}`}>
            {issues.length} issue{issues.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-cc-muted">{label}</div>
      <div className="mt-1 break-words text-xs text-cc-fg">{children}</div>
    </div>
  );
}

function RecordDetail({
  recordState,
  selectedPath,
}: {
  recordState: LoadState<MemoryRecordResponse> | { status: "idle"; data: null; error: null };
  selectedPath: string | null;
}) {
  if (!selectedPath) {
    return (
      <div className="flex h-full min-h-[220px] items-center justify-center rounded-md border border-dashed border-cc-border px-4 text-center text-sm text-cc-muted">
        Select a memory record to inspect provenance, health, and Markdown content.
      </div>
    );
  }

  if (recordState.status === "loading") {
    return (
      <div className="rounded-md border border-cc-border bg-cc-card p-4">
        <SkeletonRows count={3} />
      </div>
    );
  }

  if (recordState.status === "error") {
    return (
      <div className="rounded-md border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200">
        Failed to load record: {recordState.error}
      </div>
    );
  }

  if (recordState.status !== "ready") return null;
  const file = recordState.data.file;
  return <MemoryFileDetail file={file} issues={recordState.data.issues} />;
}

function MemoryFileDetail({ file, issues }: { file: MemoryFile; issues: MemoryLintIssue[] }) {
  const facetEntries = Object.entries(file.frontmatter.facets ?? {}) as Array<[string, unknown]>;
  return (
    <div className="h-full overflow-y-auto rounded-md border border-cc-border bg-cc-card">
      <div className="sticky top-0 z-10 border-b border-cc-border bg-cc-card/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <h2 className="break-all font-mono text-sm font-semibold text-cc-fg">{file.path}</h2>
            <div className="mt-1 break-all font-mono text-[10px] text-cc-muted">{file.absolutePath}</div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => copyText(file.absolutePath)}
              className="rounded-md border border-cc-border bg-cc-hover px-2 py-1 text-[11px] text-cc-fg hover:border-cc-primary/40"
            >
              Copy path
            </button>
            <button
              type="button"
              onClick={() => openPath(file.absolutePath, "file")}
              className="rounded-md border border-cc-border bg-cc-hover px-2 py-1 text-[11px] text-cc-fg hover:border-cc-primary/40"
            >
              Open record
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-4">
        <section className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <Field label="Kind">{file.kind}</Field>
          <Field label="Description">{file.description || "missing"}</Field>
          <Field label="Sources">
            {file.source.length ? (
              <div className="flex flex-wrap gap-1.5">
                {file.source.map((source) => (
                  <span key={source} className="rounded border border-cc-border bg-cc-hover px-1.5 py-0.5">
                    {sourceLabel(source)}
                  </span>
                ))}
              </div>
            ) : (
              "none"
            )}
          </Field>
        </section>

        {facetEntries.length ? (
          <section>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-cc-muted">Facets</h3>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
              {facetEntries.map(([key, raw]) => {
                const values = Array.isArray(raw) ? raw : [raw];
                return values.map((value) => (
                  <span key={`${key}-${String(value)}`} className="rounded bg-cc-hover px-1.5 py-0.5 text-cc-muted">
                    {key}: {String(value)}
                  </span>
                ));
              })}
            </div>
          </section>
        ) : null}

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-cc-muted">Health</h3>
          <div className="mt-2 space-y-2">
            {issues.length ? (
              issues.map((issue, index) => (
                <div key={`${issue.message}-${index}`} className={`rounded-md border p-2 text-xs ${issueTone(issue)}`}>
                  <span className="font-semibold">{issue.severity}</span>: {issue.message}
                </div>
              ))
            ) : (
              <div className="rounded-md border border-emerald-500/25 bg-emerald-500/10 p-2 text-xs text-emerald-200">
                Lint clean for this record.
              </div>
            )}
          </div>
        </section>

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-cc-muted">Markdown Body</h3>
          <pre className="mt-2 max-h-[56vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-cc-border bg-cc-bg/50 p-3 font-mono text-xs leading-relaxed text-cc-fg">
            {file.body || "No body content."}
          </pre>
        </section>
      </div>
    </div>
  );
}

function issuesByPath(issues: MemoryLintIssue[]): Map<string, MemoryLintIssue[]> {
  const map = new Map<string, MemoryLintIssue[]>();
  for (const issue of issues) {
    const key = issue.path || issue.id;
    if (!key) continue;
    map.set(key, [...(map.get(key) ?? []), issue]);
  }
  return map;
}

function entryMatches(entry: MemoryCatalogEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [entry.path, entry.kind, entry.description, entry.source.join(" "), Object.keys(entry.facets).join(" ")]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

export function MemoryPage({ embedded = false }: MemoryPageProps) {
  const [spacesState, setSpacesState] = useState<LoadState<MemorySpacesResponse>>({
    status: "loading",
    data: null,
    error: null,
  });
  const [catalogState, setCatalogState] = useState<LoadState<MemoryCatalogResponse>>({
    status: "loading",
    data: null,
    error: null,
  });
  const [recordState, setRecordState] = useState<
    LoadState<MemoryRecordResponse> | { status: "idle"; data: null; error: null }
  >({ status: "idle", data: null, error: null });
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<MemoryKind | "all">("all");

  useEffect(() => {
    let cancelled = false;
    setSpacesState({ status: "loading", data: null, error: null });
    api
      .listMemorySpaces()
      .then((data) => {
        if (cancelled) return;
        setSpacesState({ status: "ready", data, error: null });
        const preferredSlug = data.currentServerSlug || data.spaces[0]?.slug || null;
        setSelectedSlug((current) =>
          current && data.spaces.some((space) => space.slug === current) ? current : preferredSlug,
        );
      })
      .catch((error) => {
        if (!cancelled) {
          setSpacesState({
            status: "error",
            data: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedSlug) return;
    let cancelled = false;
    setCatalogState({ status: "loading", data: null, error: null });
    setRecordState({ status: "idle", data: null, error: null });
    api
      .getMemoryCatalog({ serverSlug: selectedSlug })
      .then((data) => {
        if (cancelled) return;
        setCatalogState({ status: "ready", data, error: null });
        setSelectedPath((current) =>
          current && data.entries.some((entry) => entry.path === current) ? current : (data.entries[0]?.path ?? null),
        );
      })
      .catch((error) => {
        if (!cancelled) {
          setCatalogState({
            status: "error",
            data: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSlug]);

  useEffect(() => {
    if (!selectedSlug || !selectedPath) {
      setRecordState({ status: "idle", data: null, error: null });
      return;
    }
    let cancelled = false;
    setRecordState({ status: "loading", data: null, error: null });
    api
      .getMemoryRecord({ serverSlug: selectedSlug, path: selectedPath })
      .then((data) => {
        if (!cancelled) setRecordState({ status: "ready", data, error: null });
      })
      .catch((error) => {
        if (!cancelled) {
          setRecordState({
            status: "error",
            data: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSlug, selectedPath]);

  const catalog = catalogState.data;
  const pathIssues = useMemo(() => issuesByPath(catalog?.issues ?? []), [catalog?.issues]);
  const filteredEntries = useMemo(
    () =>
      (catalog?.entries ?? []).filter(
        (entry) => (kindFilter === "all" || entry.kind === kindFilter) && entryMatches(entry, query),
      ),
    [catalog?.entries, kindFilter, query],
  );
  const selectedSpace = spacesState.data?.spaces.find((space) => space.slug === selectedSlug) ?? null;
  const selectedRecordPath = recordState.status === "ready" ? recordState.data.file.absolutePath : selectedSpace?.root;

  return (
    <div className={`${embedded ? "h-full" : "min-h-screen"} bg-cc-bg text-cc-fg`}>
      <div className="flex h-full flex-col">
        <header className="border-b border-cc-border px-4 py-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold text-cc-fg">Memory</h1>
                {selectedSlug ? (
                  <span className="rounded border border-cc-border bg-cc-hover px-2 py-0.5 font-mono text-[11px] text-cc-muted">
                    {selectedSpace?.sessionSpaceSlug
                      ? `${selectedSlug}/${selectedSpace.sessionSpaceSlug}`
                      : selectedSlug}
                  </span>
                ) : null}
                <span className={`rounded border px-2 py-0.5 text-[11px] ${healthTone(catalog)}`}>
                  {catalog
                    ? catalog.issueCounts.errors
                      ? `${catalog.issueCounts.errors} errors`
                      : catalog.issueCounts.warnings
                        ? `${catalog.issueCounts.warnings} warnings`
                        : "lint clean"
                    : "health"}
                </span>
                {catalog ? (
                  <span className="rounded border border-cc-border bg-cc-hover px-2 py-0.5 text-[11px] text-cc-muted">
                    {catalog.git.dirty ? "dirty" : "clean"}
                  </span>
                ) : null}
                {catalog?.lock.locked ? (
                  <span className="rounded border border-amber-500/25 bg-amber-500/10 px-2 py-0.5 text-[11px] text-amber-200">
                    locked{catalog.lock.owner ? ` by ${catalog.lock.owner}` : ""}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 break-all font-mono text-[11px] text-cc-muted">
                {catalog?.repo.root ?? selectedSpace?.root ?? ""}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  selectedSlug &&
                  api
                    .getMemoryCatalog({ serverSlug: selectedSlug })
                    .then((data) => setCatalogState({ status: "ready", data, error: null }))
                    .catch((error) =>
                      setCatalogState({
                        status: "error",
                        data: null,
                        error: error instanceof Error ? error.message : String(error),
                      }),
                    )
                }
                className="rounded-md border border-cc-border bg-cc-hover px-2.5 py-1.5 text-xs text-cc-fg hover:border-cc-primary/40"
              >
                Refresh
              </button>
              {selectedSpace ? (
                <>
                  <button
                    type="button"
                    onClick={() => copyText(selectedRecordPath ?? selectedSpace.root)}
                    className="rounded-md border border-cc-border bg-cc-hover px-2.5 py-1.5 text-xs text-cc-fg hover:border-cc-primary/40"
                  >
                    Copy path
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      openPath(
                        selectedRecordPath ?? selectedSpace.root,
                        recordState.status === "ready" ? "file" : "directory",
                      )
                    }
                    className="rounded-md border border-cc-border bg-cc-hover px-2.5 py-1.5 text-xs text-cc-fg hover:border-cc-primary/40"
                  >
                    Open
                  </button>
                </>
              ) : null}
            </div>
          </div>
          {catalog ? (
            <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
              <span className="rounded bg-cc-hover px-2 py-1 text-cc-muted">{catalog.entries.length} records</span>
              {MEMORY_KINDS.map((kind) => {
                const count = catalog.entries.filter((entry) => entry.kind === kind).length;
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setKindFilter((current) => (current === kind ? "all" : kind))}
                    className={`rounded px-2 py-1 ${
                      kindFilter === kind ? "bg-cc-active text-cc-fg" : "bg-cc-hover text-cc-muted hover:text-cc-fg"
                    }`}
                  >
                    {kind} {count}
                  </button>
                );
              })}
            </div>
          ) : null}
        </header>

        <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[260px_minmax(300px,420px)_1fr]">
          <aside className="min-h-0 space-y-2 overflow-y-auto">
            {spacesState.status === "loading" ? <SkeletonRows count={3} /> : null}
            {spacesState.status === "error" ? (
              <div className="rounded-md border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200">
                Failed to load memory spaces: {spacesState.error}
              </div>
            ) : null}
            {spacesState.status === "ready" && spacesState.data.spaces.length === 0 ? (
              <div className="rounded-md border border-dashed border-cc-border p-4 text-sm text-cc-muted">
                No memory spaces found.
              </div>
            ) : null}
            {spacesState.status === "ready"
              ? spacesState.data.spaces.map((space) => (
                  <SpaceButton
                    key={`${space.slug}-${space.root}`}
                    space={space}
                    selected={selectedSlug === space.slug}
                    onSelect={() => {
                      setSelectedSlug(space.slug);
                      setSelectedPath(null);
                    }}
                  />
                ))
              : null}
          </aside>

          <section className="min-h-0 space-y-2 overflow-y-auto">
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter memory..."
              aria-label="Filter memory"
              className="w-full rounded-md border border-cc-border bg-cc-input-bg px-2.5 py-1.5 text-xs text-cc-fg outline-none placeholder:text-cc-muted focus:border-cc-primary/60"
            />
            {catalogState.status === "loading" ? <SkeletonRows count={5} /> : null}
            {catalogState.status === "error" ? (
              <div className="rounded-md border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200">
                Failed to load catalog: {catalogState.error}
              </div>
            ) : null}
            {catalogState.status === "ready" && catalogState.data.entries.length === 0 ? (
              <div className="rounded-md border border-dashed border-cc-border p-4 text-sm text-cc-muted">
                This memory repo has no Markdown records in authored directories.
              </div>
            ) : null}
            {catalogState.status === "ready" && catalogState.data.entries.length > 0 && filteredEntries.length === 0 ? (
              <div className="rounded-md border border-dashed border-cc-border p-4 text-sm text-cc-muted">
                No memory records match this filter.
              </div>
            ) : null}
            {filteredEntries.map((entry) => (
              <EntryRow
                key={entry.path}
                entry={entry}
                issues={pathIssues.get(entry.path) ?? []}
                selected={selectedPath === entry.path}
                onSelect={() => setSelectedPath(entry.path)}
              />
            ))}
          </section>

          <section className="min-h-0 space-y-3">
            {catalog?.git.statusEntries.length ? (
              <div className="rounded-md border border-cc-border bg-cc-card p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-cc-muted">Working tree</div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                  {catalog.git.statusEntries.slice(0, 6).map((entry) => (
                    <span key={entry.raw} className="rounded bg-cc-hover px-1.5 py-0.5 font-mono text-cc-muted">
                      {entry.code} {entry.path}
                    </span>
                  ))}
                  {catalog.git.statusEntries.length > 6 ? (
                    <span className="rounded bg-cc-hover px-1.5 py-0.5 text-cc-muted">
                      +{catalog.git.statusEntries.length - 6}
                    </span>
                  ) : null}
                </div>
              </div>
            ) : catalog?.git.recentCommits.length ? (
              <div className="rounded-md border border-cc-border bg-cc-card p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-cc-muted">Recent update</div>
                <div className="mt-1 truncate text-xs text-cc-fg">
                  {catalog.git.recentCommits[0]?.shortSha} {catalog.git.recentCommits[0]?.message}
                </div>
                <div className="mt-1 text-[11px] text-cc-muted">
                  {formatDate(catalog.git.recentCommits[0]?.timestamp)}
                </div>
              </div>
            ) : null}
            <RecordDetail recordState={recordState} selectedPath={selectedPath} />
          </section>
        </main>
      </div>
    </div>
  );
}
