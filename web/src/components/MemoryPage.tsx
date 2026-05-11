import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  api,
  type MemoryCatalogEntry,
  type MemoryCatalogResponse,
  type MemoryFile,
  type MemoryKind,
  type MemoryLintIssue,
  type MemoryRecentCommit,
  type MemoryRecordResponse,
  type MemorySpaceInfo,
  type MemorySpacesResponse,
  type MemoryUpdateDiffResponse,
} from "../api.js";
import { DiffViewer } from "./DiffViewer.js";
import { MarkdownContent } from "./MarkdownContent.js";

interface MemoryPageProps {
  embedded?: boolean;
}

type LoadState<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: T; error: null }
  | { status: "error"; data: null; error: string };

const MEMORY_KINDS: MemoryKind[] = ["current", "knowledge", "procedures", "decisions", "references", "artifacts"];
const INITIAL_RECENT_LIMIT = 20;
const RECENT_INCREMENT = 20;
type MemorySidePanelTab = "records" | "updates";

function spaceLabel(space: Pick<MemorySpaceInfo, "slug" | "sessionSpaceSlug">): string {
  return space.sessionSpaceSlug ? `${space.slug}/${space.sessionSpaceSlug}` : space.slug;
}

function splitMemoryPath(path: string): { name: string; parent: string } {
  const parts = path.split("/");
  const name = parts.pop() || path;
  return { name, parent: parts.join("/") };
}

function formatRecordCount(count: number): string {
  return `${count} record${count === 1 ? "" : "s"}`;
}

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

function ActionButton({
  children,
  onClick,
  disabled = false,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-cc-border bg-cc-hover px-2.5 py-1.5 text-xs font-medium text-cc-fg transition-colors hover:border-cc-primary/40 hover:bg-cc-active focus:border-cc-primary/60 focus:outline-none disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
  );
}

function PanelTabButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-cc-primary/60 ${
        active ? "bg-cc-active text-cc-fg" : "text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
      }`}
    >
      {children}
    </button>
  );
}

function SpaceSelect({
  spaces,
  selectedRoot,
  onSelect,
}: {
  spaces: MemorySpaceInfo[];
  selectedRoot: string | null;
  onSelect: (root: string) => void;
}) {
  return (
    <label className="min-w-[220px] max-w-full text-[11px] font-semibold uppercase tracking-wide text-cc-muted">
      Space
      <select
        value={selectedRoot ?? ""}
        onChange={(event) => onSelect(event.target.value)}
        className="mt-1 w-full rounded-md border border-cc-border bg-cc-input-bg px-2.5 py-2 text-xs normal-case tracking-normal text-cc-fg outline-none focus:border-cc-primary/60"
        aria-label="Memory space"
      >
        {spaces.map((space) => (
          <option key={space.root} value={space.root}>
            {spaceLabel(space)}
          </option>
        ))}
      </select>
    </label>
  );
}

function RecordTree({
  entriesByKind,
  pathIssues,
  collapsedKinds,
  selectedPath,
  onToggleKind,
  onSelectEntry,
}: {
  entriesByKind: Map<MemoryKind, MemoryCatalogEntry[]>;
  pathIssues: Map<string, MemoryLintIssue[]>;
  collapsedKinds: Set<MemoryKind>;
  selectedPath: string | null;
  onToggleKind: (kind: MemoryKind) => void;
  onSelectEntry: (entry: MemoryCatalogEntry) => void;
}) {
  return (
    <div className="divide-y divide-cc-border rounded-md border border-cc-border bg-cc-card">
      {MEMORY_KINDS.map((kind) => {
        const entries = entriesByKind.get(kind) ?? [];
        const collapsed = collapsedKinds.has(kind);
        return (
          <section key={kind} aria-label={`${kind} memory records`}>
            <button
              type="button"
              onClick={() => onToggleKind(kind)}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors hover:bg-cc-hover focus:bg-cc-hover focus:outline-none"
              aria-expanded={!collapsed}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-3 shrink-0 text-cc-muted">{collapsed ? "+" : "-"}</span>
                <span className="truncate font-semibold text-cc-fg">{kind}</span>
              </span>
              <span className="shrink-0 rounded bg-cc-hover px-1.5 py-0.5 text-[10px] text-cc-muted">
                {entries.length}
              </span>
            </button>
            {!collapsed ? (
              <div className="pb-1">
                {entries.length ? (
                  entries.map((entry) => (
                    <RecordTreeRow
                      key={entry.path}
                      entry={entry}
                      issueCount={pathIssues.get(entry.path)?.length ?? 0}
                      selected={selectedPath === entry.path}
                      onSelect={() => onSelectEntry(entry)}
                    />
                  ))
                ) : (
                  <div className="px-8 py-2 text-xs text-cc-muted">No records</div>
                )}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}

function RecordTreeRow({
  entry,
  issueCount,
  selected,
  onSelect,
}: {
  entry: MemoryCatalogEntry;
  issueCount: number;
  selected: boolean;
  onSelect: () => void;
}) {
  const { name } = splitMemoryPath(entry.path);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={`group flex w-full min-w-0 items-start gap-2 px-8 py-2 text-left transition-colors focus:outline-none ${
        selected ? "bg-cc-active text-cc-fg" : "text-cc-muted hover:bg-cc-hover hover:text-cc-fg focus:bg-cc-hover"
      }`}
    >
      <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-45" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-[12px] font-semibold text-cc-fg">{name}</span>
        <span className="mt-0.5 block line-clamp-2 text-xs leading-relaxed text-cc-muted">
          {entry.description || "Missing description."}
        </span>
      </span>
      {issueCount ? (
        <span className="shrink-0 rounded border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-200">
          {issueCount}
        </span>
      ) : null}
    </button>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-cc-muted">{label}</div>
      <div className="mt-1 break-words text-xs leading-relaxed text-cc-fg">{children}</div>
    </div>
  );
}

function RecordDetail({
  recordState,
  selectedPath,
  history,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
}: {
  recordState: LoadState<MemoryRecordResponse> | { status: "idle"; data: null; error: null };
  selectedPath: string | null;
  history: MemoryRecentCommit[];
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  if (!selectedPath) {
    return (
      <div className="flex h-full min-h-[220px] items-center justify-center rounded-md border border-dashed border-cc-border px-4 text-center text-sm text-cc-muted">
        Select a memory record to read its content and recent history.
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
  return (
    <MemoryFileDetail
      file={recordState.data.file}
      issues={recordState.data.issues}
      history={history}
      canPrevious={canPrevious}
      canNext={canNext}
      onPrevious={onPrevious}
      onNext={onNext}
    />
  );
}

function MemoryFileDetail({
  file,
  issues,
  history,
  canPrevious,
  canNext,
  onPrevious,
  onNext,
}: {
  file: MemoryFile;
  issues: MemoryLintIssue[];
  history: MemoryRecentCommit[];
  canPrevious: boolean;
  canNext: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  const facetEntries = facetEntriesFromFrontmatter(file.frontmatter);
  const { name, parent } = splitMemoryPath(file.path);
  return (
    <article className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-cc-border bg-cc-card">
      <div className="shrink-0 border-b border-cc-border bg-cc-card px-4 py-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-cc-muted">Selected record</div>
            <h2 className="mt-1 break-words font-mono text-base font-semibold leading-snug text-cc-fg">{name}</h2>
            {parent ? <div className="mt-1 break-all font-mono text-[11px] text-cc-muted">{parent}/</div> : null}
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <ActionButton onClick={onPrevious} disabled={!canPrevious}>
              Previous
            </ActionButton>
            <ActionButton onClick={onNext} disabled={!canNext}>
              Next
            </ActionButton>
            <ActionButton onClick={() => copyText(file.absolutePath)}>Copy path</ActionButton>
            <ActionButton onClick={() => openPath(file.absolutePath, "file")}>Open record</ActionButton>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="min-w-0 space-y-4" data-testid="memory-detail-body">
          <section
            className="rounded-md border border-cc-border bg-cc-bg/30 p-3"
            data-testid="memory-record-description"
          >
            <Field label="Description">{file.description || "missing"}</Field>
          </section>

          <section
            className="rounded-md border border-cc-border bg-cc-bg/30 p-3"
            data-testid="memory-record-current-content"
          >
            <h3 className="text-xs font-semibold uppercase tracking-wide text-cc-muted">Current content</h3>
            <div className="mt-3 w-full max-w-none rounded-md border border-cc-border bg-cc-bg/50 p-4">
              {file.body ? (
                <MarkdownContent text={file.body} size="sm" variant="conservative" wrapLongContent />
              ) : (
                <div className="text-xs text-cc-muted">No body content.</div>
              )}
            </div>
          </section>

          <section className="space-y-3 rounded-md border border-cc-border bg-cc-bg/30 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-cc-muted">Record metadata</h3>
            <Field label="Path">
              <div className="break-all font-mono text-[11px] leading-relaxed text-cc-muted">{file.absolutePath}</div>
            </Field>
            <Field label="Kind">
              <span className="rounded border border-cc-border bg-cc-hover px-1.5 py-0.5 text-[11px] text-cc-muted">
                {file.kind}
              </span>
            </Field>
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
            {facetEntries.length ? (
              <Field label="Facets">
                <div className="flex flex-wrap gap-1.5 text-[11px]">
                  {facetEntries.map(([key, value]) => (
                    <span key={`${key}-${value}`} className="rounded bg-cc-hover px-1.5 py-0.5 text-cc-muted">
                      {key}: {value}
                    </span>
                  ))}
                </div>
              </Field>
            ) : null}
          </section>

          <section className="rounded-md border border-cc-border bg-cc-bg/30 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-cc-muted">Health</h3>
            <div className="mt-2 space-y-2">
              {issues.length ? (
                issues.map((issue, index) => (
                  <div
                    key={`${issue.message}-${index}`}
                    className={`rounded-md border p-2 text-xs ${issueTone(issue)}`}
                  >
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

          <RecordHistory history={history} />
        </div>
      </div>
    </article>
  );
}

function RecordHistory({ history }: { history: MemoryRecentCommit[] }) {
  return (
    <section className="rounded-md border border-cc-border bg-cc-bg/30 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-cc-muted">Recent history</h3>
      {history.length ? (
        <div className="mt-2 space-y-2">
          {history.slice(0, 3).map((commit) => (
            <div key={commit.sha} className="min-w-0 text-xs">
              <div className="truncate font-medium text-cc-fg">{commit.message || commit.shortSha}</div>
              <div className="mt-0.5 text-[11px] text-cc-muted">
                {formatDate(commit.timestamp)} by {commit.actor ?? "unknown"}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-2 text-xs text-cc-muted">No recent timeline entries for this record.</div>
      )}
    </section>
  );
}

function RecentTimeline({
  catalog,
  recentLimit,
  selectedSha,
  onSelectCommit,
  onLoadMore,
}: {
  catalog: MemoryCatalogResponse | null;
  recentLimit: number;
  selectedSha: string | null;
  onSelectCommit: (commit: MemoryRecentCommit) => void;
  onLoadMore: () => void;
}) {
  const commits = catalog?.git.recentCommits ?? [];
  const canLoadMore = commits.length >= recentLimit;
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-cc-border px-3 py-2">
        <div>
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-cc-muted">Recent updates</h2>
          <div className="mt-0.5 text-[11px] text-cc-muted">{commits.length ? `${commits.length} shown` : "none"}</div>
        </div>
        {canLoadMore ? <ActionButton onClick={onLoadMore}>Load more</ActionButton> : null}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {catalog?.git.statusEntries.length ? (
          <div className="mb-2 rounded-md border border-amber-500/25 bg-amber-500/10 p-2 text-xs text-amber-100">
            <div className="font-semibold">Uncommitted memory changes</div>
            <div className="mt-1 space-y-1 font-mono text-[11px] text-amber-100/80">
              {catalog.git.statusEntries.slice(0, 4).map((entry) => (
                <div key={entry.raw} className="break-all">
                  {entry.code} {entry.path}
                </div>
              ))}
              {catalog.git.statusEntries.length > 4 ? <div>+{catalog.git.statusEntries.length - 4} more</div> : null}
            </div>
          </div>
        ) : null}
        {commits.length ? (
          <div className="space-y-2">
            {commits.map((commit) => (
              <TimelineCommit
                key={commit.sha}
                commit={commit}
                selected={selectedSha === commit.sha}
                onSelect={() => onSelectCommit(commit)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-cc-border p-3 text-xs text-cc-muted">
            No committed memory edits found.
          </div>
        )}
      </div>
    </section>
  );
}

function TimelineCommit({
  commit,
  selected,
  onSelect,
}: {
  commit: MemoryRecentCommit;
  selected: boolean;
  onSelect: () => void;
}) {
  const files = commit.changedFiles.map((change) => change.path);
  const provenance = [commit.quest, commit.session, ...commit.sources].filter((source): source is string =>
    Boolean(source),
  );
  return (
    <article
      aria-current={selected ? "true" : undefined}
      className={`min-w-0 rounded-md border p-2.5 text-xs transition-colors ${
        selected
          ? "border-cc-primary/50 bg-cc-active text-cc-fg"
          : "border-cc-border bg-cc-bg/30 hover:border-cc-primary/30 hover:bg-cc-hover"
      }`}
    >
      <button
        type="button"
        onClick={onSelect}
        className="block w-full rounded text-left focus:outline-none focus:ring-1 focus:ring-cc-primary/60"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="truncate font-medium text-cc-fg">{commit.message || commit.shortSha}</div>
            <div className="mt-1 text-[11px] text-cc-muted">
              {formatDate(commit.timestamp)} by {commit.actor ?? "unknown"}
            </div>
          </div>
          <span className="shrink-0 font-mono text-[10px] text-cc-muted">{commit.shortSha}</span>
        </div>
        <div className="mt-2 text-[11px] leading-relaxed text-cc-muted">
          {files.length ? (
            <>
              {files.length} file{files.length === 1 ? "" : "s"}:{" "}
              <span className="break-all font-mono">{files.slice(0, 3).join(", ")}</span>
              {files.length > 3 ? `, +${files.length - 3} more` : ""}
            </>
          ) : (
            "Changed files unknown"
          )}
        </div>
      </button>
      {provenance.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {provenance.slice(0, 4).map((source) => (
            <span key={source} className="rounded border border-cc-border bg-cc-hover px-1.5 py-0.5 text-[10px]">
              {sourceLabel(source)}
            </span>
          ))}
        </div>
      ) : (
        <div className="mt-2 text-[10px] uppercase tracking-wide text-cc-muted">source unknown</div>
      )}
    </article>
  );
}

function UpdateDiffDetail({
  updateState,
  fallbackCommit,
}: {
  updateState: LoadState<MemoryUpdateDiffResponse> | { status: "idle"; data: null; error: null };
  fallbackCommit: MemoryRecentCommit | null;
}) {
  if (!fallbackCommit) {
    return (
      <div className="flex h-full min-h-[220px] items-center justify-center rounded-md border border-dashed border-cc-border px-4 text-center text-sm text-cc-muted">
        Select a recent update to inspect changed memory content.
      </div>
    );
  }

  if (updateState.status === "loading") {
    return (
      <div className="rounded-md border border-cc-border bg-cc-card p-4">
        <SkeletonRows count={3} />
      </div>
    );
  }

  if (updateState.status === "error") {
    return (
      <div className="rounded-md border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200">
        Failed to load update diff: {updateState.error}
      </div>
    );
  }

  const commit = updateState.status === "ready" ? updateState.data.commit : fallbackCommit;
  const diff = updateState.status === "ready" ? updateState.data.diff : "";
  const repoRoot = updateState.status === "ready" ? updateState.data.repo.root : "";
  const provenance = [commit.quest, commit.session, ...commit.sources].filter((source): source is string =>
    Boolean(source),
  );

  return (
    <article className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-cc-border bg-cc-card">
      <div className="shrink-0 border-b border-cc-border bg-cc-card px-4 py-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-cc-muted">Selected update</div>
            <h2 className="mt-1 break-words text-base font-semibold leading-snug text-cc-fg">
              {commit.message || commit.shortSha}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-cc-muted">
              <span>{formatDate(commit.timestamp)}</span>
              <span>by {commit.actor ?? "unknown"}</span>
              <span className="font-mono">{commit.shortSha}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            <ActionButton onClick={() => copyText(commit.sha)}>Copy SHA</ActionButton>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="min-w-0 space-y-4" data-testid="memory-update-detail-body">
          <section className="rounded-md border border-cc-border bg-cc-bg/30 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-cc-muted">Changed files</h3>
            {commit.changedFiles.length ? (
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                {commit.changedFiles.map((change) => (
                  <span
                    key={`${change.status}-${change.previousPath ?? ""}-${change.path}`}
                    className="rounded border border-cc-border bg-cc-hover px-1.5 py-0.5 font-mono text-cc-muted"
                  >
                    {change.status} {change.path}
                  </span>
                ))}
              </div>
            ) : (
              <div className="mt-2 text-xs text-cc-muted">Changed files unknown.</div>
            )}
            {provenance.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                {provenance.map((source) => (
                  <span key={source} className="rounded border border-cc-border bg-cc-hover px-1.5 py-0.5">
                    {sourceLabel(source)}
                  </span>
                ))}
              </div>
            ) : null}
          </section>

          <section className="rounded-md border border-cc-border bg-cc-bg/30 p-3">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-cc-muted">Diff</h3>
            <div className="mt-3 min-w-0 overflow-hidden rounded-md border border-cc-border bg-cc-bg/50">
              <DiffViewer
                unifiedDiff={diff}
                mode="full"
                showLineNumbers
                stickyFileHeaders
                collapsibleFiles
                renderHeaderActions={(fileName) => {
                  const memoryPath = fileName.replace(/^\/+/, "");
                  const absolutePath = repoRoot ? `${repoRoot}/${memoryPath}` : memoryPath;
                  return (
                    <>
                      <ActionButton onClick={() => copyText(absolutePath)}>Copy path</ActionButton>
                      <ActionButton onClick={() => openPath(absolutePath, "file")}>Open file</ActionButton>
                    </>
                  );
                }}
              />
            </div>
          </section>
        </div>
      </div>
    </article>
  );
}

function MobileRecordSheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-cc-bg lg:hidden" data-testid="memory-mobile-detail">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-cc-border px-3 py-2">
        <div className="text-sm font-semibold text-cc-fg">{title}</div>
        <ActionButton onClick={onClose}>Back to browser</ActionButton>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden p-3">{children}</div>
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

function groupEntries(entries: MemoryCatalogEntry[]): Map<MemoryKind, MemoryCatalogEntry[]> {
  const map = new Map<MemoryKind, MemoryCatalogEntry[]>();
  for (const kind of MEMORY_KINDS) map.set(kind, []);
  for (const entry of entries) {
    map.set(entry.kind, [...(map.get(entry.kind) ?? []), entry]);
  }
  return map;
}

function facetEntriesFromFrontmatter(frontmatter: Record<string, unknown>): Array<[string, string]> {
  const facets = frontmatter.facets;
  if (!facets || typeof facets !== "object" || Array.isArray(facets)) return [];
  return Object.entries(facets as Record<string, unknown>).flatMap(([key, raw]) => {
    const values = Array.isArray(raw) ? raw : [raw];
    return values.map((value) => [key, String(value)] as [string, string]);
  });
}

function commitTouchesPath(commit: MemoryRecentCommit, path: string): boolean {
  return commit.changedFiles.some((change) => change.path === path || change.previousPath === path);
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
  const [updateDiffState, setUpdateDiffState] = useState<
    LoadState<MemoryUpdateDiffResponse> | { status: "idle"; data: null; error: null }
  >({ status: "idle", data: null, error: null });
  const [selectedRoot, setSelectedRoot] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedUpdateSha, setSelectedUpdateSha] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [collapsedKinds, setCollapsedKinds] = useState<Set<MemoryKind>>(new Set());
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [sidePanelTab, setSidePanelTab] = useState<MemorySidePanelTab>("records");
  const [recentLimit, setRecentLimit] = useState(INITIAL_RECENT_LIMIT);

  useEffect(() => {
    let cancelled = false;
    setSpacesState({ status: "loading", data: null, error: null });
    api
      .listMemorySpaces()
      .then((data) => {
        if (cancelled) return;
        setSpacesState({ status: "ready", data, error: null });
        const preferredRoot = data.spaces.find((space) => space.current)?.root ?? data.spaces[0]?.root ?? null;
        setSelectedRoot((current) =>
          current && data.spaces.some((space) => space.root === current) ? current : preferredRoot,
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
    if (!selectedRoot) return;
    let cancelled = false;
    setCatalogState({ status: "loading", data: null, error: null });
    api
      .getMemoryCatalog({ root: selectedRoot, recentLimit })
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
  }, [recentLimit, selectedRoot]);

  useEffect(() => {
    if (!selectedRoot || !selectedPath) {
      setRecordState({ status: "idle", data: null, error: null });
      return;
    }
    let cancelled = false;
    setRecordState({ status: "loading", data: null, error: null });
    api
      .getMemoryRecord({ root: selectedRoot, path: selectedPath })
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
  }, [selectedRoot, selectedPath]);

  useEffect(() => {
    if (sidePanelTab !== "updates") return;
    const commits = catalogState.data?.git.recentCommits ?? [];
    setSelectedUpdateSha((current) =>
      current && commits.some((commit) => commit.sha === current) ? current : (commits[0]?.sha ?? null),
    );
  }, [catalogState.data?.git.recentCommits, sidePanelTab]);

  useEffect(() => {
    if (!selectedRoot || !selectedUpdateSha) {
      setUpdateDiffState({ status: "idle", data: null, error: null });
      return;
    }
    let cancelled = false;
    setUpdateDiffState({ status: "loading", data: null, error: null });
    api
      .getMemoryUpdateDiff({ root: selectedRoot, sha: selectedUpdateSha })
      .then((data) => {
        if (!cancelled) setUpdateDiffState({ status: "ready", data, error: null });
      })
      .catch((error) => {
        if (!cancelled) {
          setUpdateDiffState({
            status: "error",
            data: null,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRoot, selectedUpdateSha]);

  const catalog = catalogState.data;
  const pathIssues = useMemo(() => issuesByPath(catalog?.issues ?? []), [catalog?.issues]);
  const filteredEntries = useMemo(
    () => (catalog?.entries ?? []).filter((entry) => entryMatches(entry, query)),
    [catalog?.entries, query],
  );
  const entriesByKind = useMemo(() => groupEntries(filteredEntries), [filteredEntries]);
  const selectedSpace = spacesState.data?.spaces.find((space) => space.root === selectedRoot) ?? null;
  const selectedSpaceLabel = selectedSpace ? spaceLabel(selectedSpace) : null;
  const selectedEntry = selectedPath ? (catalog?.entries.find((entry) => entry.path === selectedPath) ?? null) : null;
  const selectedRecordPath = recordState.status === "ready" ? recordState.data.file.absolutePath : selectedSpace?.root;
  const selectedUpdate =
    selectedUpdateSha && catalog
      ? (catalog.git.recentCommits.find((commit) => commit.sha === selectedUpdateSha) ?? null)
      : null;
  const detailMode = sidePanelTab === "updates" && selectedUpdateSha ? "update" : "record";
  const selectedIndex = filteredEntries.findIndex((entry) => entry.path === selectedPath);
  const canPrevious = selectedIndex > 0;
  const canNext = selectedIndex >= 0 && selectedIndex < filteredEntries.length - 1;
  const selectedHistory = useMemo(
    () =>
      selectedPath
        ? (catalog?.git.recentCommits ?? []).filter((commit) => commitTouchesPath(commit, selectedPath))
        : [],
    [catalog?.git.recentCommits, selectedPath],
  );

  function selectRoot(root: string): void {
    setSelectedRoot(root || null);
    setSelectedPath(null);
    setSelectedUpdateSha(null);
    setMobileDetailOpen(false);
    setRecentLimit(INITIAL_RECENT_LIMIT);
  }

  function selectEntry(entry: MemoryCatalogEntry): void {
    setSelectedPath(entry.path);
    setSidePanelTab("records");
    setMobileDetailOpen(true);
  }

  function selectUpdate(commit: MemoryRecentCommit): void {
    setSelectedUpdateSha(commit.sha);
    setSidePanelTab("updates");
    setMobileDetailOpen(true);
  }

  function toggleKind(kind: MemoryKind): void {
    setCollapsedKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  }

  function selectOffset(offset: number): void {
    if (!filteredEntries.length) return;
    const baseIndex = selectedIndex >= 0 ? selectedIndex : 0;
    const nextIndex = Math.min(Math.max(baseIndex + offset, 0), filteredEntries.length - 1);
    const nextEntry = filteredEntries[nextIndex];
    if (!nextEntry) return;
    setSelectedPath(nextEntry.path);
    setMobileDetailOpen(true);
  }

  function refreshCatalog(): void {
    if (!selectedRoot) return;
    setCatalogState({ status: "loading", data: null, error: null });
    api
      .getMemoryCatalog({ root: selectedRoot, recentLimit })
      .then((data) => setCatalogState({ status: "ready", data, error: null }))
      .catch((error) =>
        setCatalogState({
          status: "error",
          data: null,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
  }

  const detail =
    detailMode === "update" ? (
      <UpdateDiffDetail updateState={updateDiffState} fallbackCommit={selectedUpdate} />
    ) : (
      <RecordDetail
        recordState={recordState}
        selectedPath={selectedPath}
        history={selectedHistory}
        canPrevious={canPrevious}
        canNext={canNext}
        onPrevious={() => selectOffset(-1)}
        onNext={() => selectOffset(1)}
      />
    );

  return (
    <div className={`${embedded ? "h-full" : "min-h-screen"} bg-cc-bg text-cc-fg`}>
      <div className="flex h-full min-w-0 flex-col overflow-hidden">
        <header className="shrink-0 border-b border-cc-border px-3 py-2">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h1 className="text-lg font-semibold leading-tight text-cc-fg">Memory</h1>
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

              <div className="flex flex-wrap items-center gap-1.5">
                <ActionButton onClick={refreshCatalog}>Refresh</ActionButton>
                {selectedSpace && sidePanelTab === "records" ? (
                  <>
                    <ActionButton onClick={() => copyText(selectedRecordPath ?? selectedSpace.root)}>
                      Copy path
                    </ActionButton>
                    <ActionButton
                      onClick={() =>
                        openPath(
                          selectedRecordPath ?? selectedSpace.root,
                          recordState.status === "ready" ? "file" : "directory",
                        )
                      }
                    >
                      Open
                    </ActionButton>
                  </>
                ) : null}
              </div>
            </div>

            <div className="grid min-w-0 gap-2 md:grid-cols-[minmax(220px,320px)_minmax(0,1fr)] md:items-end">
              {spacesState.status === "ready" ? (
                <SpaceSelect spaces={spacesState.data.spaces} selectedRoot={selectedRoot} onSelect={selectRoot} />
              ) : null}
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-cc-muted">Repository path</div>
                <div
                  className="mt-1 truncate font-mono text-[11px] leading-relaxed text-cc-muted"
                  title={catalog?.repo.root ?? selectedSpace?.root ?? ""}
                >
                  {catalog?.repo.root ?? selectedSpace?.root ?? ""}
                </div>
              </div>
            </div>
          </div>
        </header>

        <main className="min-h-0 flex-1 overflow-hidden p-3">
          <div
            className="grid h-full min-h-0 grid-cols-1 gap-3 overflow-y-auto lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)] lg:overflow-hidden"
            data-testid="memory-page-layout"
          >
            <section
              className="flex min-h-[420px] flex-col overflow-hidden rounded-md border border-cc-border bg-cc-card lg:min-h-0"
              data-testid="memory-side-panel"
            >
              <div
                className="flex shrink-0 items-center justify-between gap-2 border-b border-cc-border px-2 py-1.5"
                role="tablist"
                aria-label="Memory side panel"
              >
                <div className="flex items-center gap-1">
                  <PanelTabButton active={sidePanelTab === "records"} onClick={() => setSidePanelTab("records")}>
                    Records
                  </PanelTabButton>
                  <PanelTabButton active={sidePanelTab === "updates"} onClick={() => setSidePanelTab("updates")}>
                    Recent updates
                  </PanelTabButton>
                </div>
                {catalog ? (
                  <span className="shrink-0 rounded border border-cc-border bg-cc-hover px-2 py-1 text-[11px] text-cc-muted">
                    {sidePanelTab === "records"
                      ? formatRecordCount(catalog.entries.length)
                      : `${catalog.git.recentCommits.length} shown`}
                  </span>
                ) : null}
              </div>

              {sidePanelTab === "records" ? (
                <div className="flex min-h-0 flex-1 flex-col" role="tabpanel" aria-label="Records">
                  <div className="shrink-0 space-y-2 border-b border-cc-border p-2">
                    <div className="text-[11px] text-cc-muted">
                      {catalog
                        ? `${filteredEntries.length}/${catalog.entries.length} in ${selectedSpaceLabel}`
                        : "loading"}
                    </div>
                    <input
                      type="search"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Filter records..."
                      aria-label="Filter memory"
                      className="w-full rounded-md border border-cc-border bg-cc-input-bg px-2.5 py-1.5 text-xs text-cc-fg outline-none placeholder:text-cc-muted focus:border-cc-primary/60"
                    />
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto p-2">
                    {spacesState.status === "loading" ? <SkeletonRows count={2} /> : null}
                    {spacesState.status === "error" ? (
                      <div className="rounded-md border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200">
                        Failed to load memory spaces: {spacesState.error}
                      </div>
                    ) : null}
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
                    {catalogState.status === "ready" &&
                    catalogState.data.entries.length > 0 &&
                    filteredEntries.length === 0 ? (
                      <div className="rounded-md border border-dashed border-cc-border p-4 text-sm text-cc-muted">
                        No memory records match this filter.
                      </div>
                    ) : null}
                    {catalogState.status === "ready" && filteredEntries.length > 0 ? (
                      <RecordTree
                        entriesByKind={entriesByKind}
                        pathIssues={pathIssues}
                        collapsedKinds={collapsedKinds}
                        selectedPath={selectedPath}
                        onToggleKind={toggleKind}
                        onSelectEntry={selectEntry}
                      />
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="min-h-0 flex-1" role="tabpanel" aria-label="Recent updates">
                  <RecentTimeline
                    catalog={catalog}
                    recentLimit={recentLimit}
                    selectedSha={selectedUpdateSha}
                    onSelectCommit={selectUpdate}
                    onLoadMore={() => setRecentLimit((current) => current + RECENT_INCREMENT)}
                  />
                </div>
              )}
            </section>

            <section className="hidden min-h-0 min-w-0 flex-col overflow-hidden lg:flex" aria-label="Memory detail">
              {detail}
            </section>
          </div>
        </main>

        <MobileRecordSheet
          open={mobileDetailOpen && (detailMode === "update" ? Boolean(selectedUpdateSha) : Boolean(selectedPath))}
          title={detailMode === "update" ? "Memory update" : "Memory record"}
          onClose={() => setMobileDetailOpen(false)}
        >
          {detail}
        </MobileRecordSheet>
      </div>
    </div>
  );
}
