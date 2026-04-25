import { useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type StreamGroupView, type StreamGroupsResponse } from "../api.js";
import type { StreamLink, StreamPinnedFact, StreamRecord, StreamTimelineEntry } from "../types.js";

interface StreamsPageProps {
  embedded?: boolean;
}

type LoadState =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: StreamGroupsResponse; error: null }
  | { status: "error"; data: null; error: string };

const RISK_ENTRY_TYPES = new Set(["alert", "contradiction"]);

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

function statusClass(status: StreamRecord["status"]): string {
  switch (status) {
    case "active":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-300";
    case "blocked":
      return "border-red-500/25 bg-red-500/10 text-red-300";
    case "paused":
      return "border-amber-500/25 bg-amber-500/10 text-amber-300";
    case "superseded":
      return "border-violet-500/25 bg-violet-500/10 text-violet-300";
    case "archived":
      return "border-cc-border bg-cc-hover text-cc-muted";
  }
}

function factClass(status: StreamPinnedFact["status"]): string {
  switch (status) {
    case "active":
      return "border-cc-border bg-cc-card text-cc-fg";
    case "superseded":
      return "border-violet-500/30 bg-violet-500/10 text-violet-200";
    case "disputed":
      return "border-red-500/30 bg-red-500/10 text-red-200";
    case "needs-verification":
      return "border-amber-500/30 bg-amber-500/10 text-amber-200";
  }
}

function streamRiskCount(stream: StreamRecord): number {
  let count = 0;
  if (stream.status === "blocked" || stream.current.blockedOn) count += 1;
  count += stream.current.knownStaleFacts?.length ?? 0;
  count += stream.pinnedFacts?.filter((fact) => fact.status !== "active").length ?? 0;
  count += stream.timeline.filter((entry) => RISK_ENTRY_TYPES.has(entry.type)).length;
  return count;
}

function artifactsForStream(stream: StreamRecord): string[] {
  const artifacts = new Set<string>();
  for (const link of stream.links ?? []) {
    if (link.type === "artifact") artifacts.add(link.ref);
  }
  for (const entry of stream.timeline) {
    for (const artifact of entry.artifacts ?? []) artifacts.add(artifact);
    for (const link of entry.links ?? []) {
      if (link.type === "artifact") artifacts.add(link.ref);
    }
  }
  return Array.from(artifacts);
}

function newestFirst(entries: StreamTimelineEntry[]): StreamTimelineEntry[] {
  return [...entries].sort((a, b) => b.ts - a.ts);
}

function sourceHref(source: string): string | undefined {
  const ref = source.trim();
  if (!ref) return undefined;
  if (/^https?:\/\//.test(ref)) return ref;

  const sessionMatch = /^session:([^:\s]+)(?::([^:\s]+))?$/i.exec(ref);
  if (sessionMatch) {
    const [, sessionId, messageId] = sessionMatch;
    if (messageId) {
      return `#/session/${encodeURIComponent(sessionId)}/msg/${encodeURIComponent(messageId)}`;
    }
    return `#/session/${encodeURIComponent(sessionId)}`;
  }

  const messageMatch = /^message:([^:\s]+):([^:\s]+)$/i.exec(ref);
  if (messageMatch) {
    const [, sessionId, messageId] = messageMatch;
    return `#/session/${encodeURIComponent(sessionId)}/msg/${encodeURIComponent(messageId)}`;
  }

  const questMatch = /^(?:quest:)?(q-\d+)$/i.exec(ref);
  if (questMatch) {
    return `#/questmaster?quest=${encodeURIComponent(questMatch[1].toLowerCase())}`;
  }

  return undefined;
}

function linkHref(link: StreamLink): string | undefined {
  if (link.type === "quest" && /^q-\d+$/i.test(link.ref)) {
    return `#/questmaster?quest=${encodeURIComponent(link.ref.toLowerCase())}`;
  }
  if ((link.type === "session" || link.type === "worker") && link.ref.trim()) {
    return `#/session/${encodeURIComponent(link.ref.trim())}`;
  }
  if (link.type === "message") {
    const [sessionId, messageId] = link.ref.split(":");
    if (sessionId && messageId) {
      return `#/session/${encodeURIComponent(sessionId)}/msg/${encodeURIComponent(messageId)}`;
    }
  }
  if (link.type === "source") return sourceHref(link.ref);
  return undefined;
}

function SourceRef({ source }: { source: string }) {
  const href = sourceHref(source);
  if (!href) return <span>{source}</span>;
  return (
    <a href={href} className="text-cc-primary hover:underline">
      {source}
    </a>
  );
}

function StreamLinks({ links }: { links: StreamLink[] | undefined }) {
  if (!links?.length) return <span className="text-cc-muted">none</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {links.map((link, index) => {
        const href = linkHref(link);
        const label = link.label || `${link.type}:${link.ref}`;
        const className =
          "inline-flex items-center gap-1 rounded border border-cc-border bg-cc-hover px-1.5 py-0.5 text-[11px] text-cc-fg hover:border-cc-primary/40";
        return href ? (
          <a key={`${link.type}-${link.ref}-${index}`} href={href} className={className}>
            <span className="text-cc-muted">{link.type}</span>
            <span>{label === `${link.type}:${link.ref}` ? link.ref : label}</span>
          </a>
        ) : (
          <span key={`${link.type}-${link.ref}-${index}`} className={className}>
            <span className="text-cc-muted">{link.type}</span>
            <span>{label === `${link.type}:${link.ref}` ? link.ref : label}</span>
          </span>
        );
      })}
    </div>
  );
}

function Owners({ stream }: { stream: StreamRecord }) {
  if (!stream.owners?.length) return <span className="text-cc-muted">none</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {stream.owners.map((owner) => (
        <a
          key={`${stream.id}-${owner.ref}-${owner.role ?? ""}`}
          href={`#/session/${encodeURIComponent(owner.ref)}`}
          className="rounded border border-cc-border bg-cc-hover px-1.5 py-0.5 text-[11px] text-cc-fg hover:border-cc-primary/40"
        >
          {owner.role ? `${owner.role}: ` : ""}
          {owner.ref}
          {owner.steeringMode ? <span className="text-cc-muted"> {owner.steeringMode}</span> : null}
        </a>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide text-cc-muted">{label}</div>
      <div className="mt-1 text-xs text-cc-fg break-words">{children}</div>
    </div>
  );
}

function StreamCard({ stream, selected, onSelect }: { stream: StreamRecord; selected: boolean; onSelect: () => void }) {
  const riskCount = streamRiskCount(stream);
  const artifacts = artifactsForStream(stream);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left rounded-md border p-3 transition-colors ${
        selected ? "border-cc-primary/60 bg-cc-active" : "border-cc-border bg-cc-card hover:bg-cc-hover"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-cc-fg">{stream.title}</div>
          <div className="mt-0.5 truncate text-[11px] text-cc-muted">{stream.slug}</div>
        </div>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${statusClass(stream.status)}`}>
          {stream.status}
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-cc-muted">
        {stream.current.summary || "No summary."}
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
        {stream.owners?.length ? (
          <span className="rounded bg-cc-hover px-1.5 py-0.5 text-cc-muted">{stream.owners.length} owners</span>
        ) : null}
        {artifacts.length ? (
          <span className="rounded bg-cc-hover px-1.5 py-0.5 text-cc-muted">{artifacts.length} artifacts</span>
        ) : null}
        {riskCount ? <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-red-300">{riskCount} risks</span> : null}
        {stream.timeline.length ? (
          <span className="rounded bg-cc-hover px-1.5 py-0.5 text-cc-muted">{stream.timeline.length} events</span>
        ) : null}
      </div>
      <div className="mt-2 text-[10px] text-cc-muted">Updated {formatDate(stream.updatedAt)}</div>
    </button>
  );
}

function GroupButton({
  group,
  selected,
  onSelect,
}: {
  group: StreamGroupView;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
        selected ? "border-cc-primary/60 bg-cc-active" : "border-cc-border bg-cc-card hover:bg-cc-hover"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 truncate text-sm font-semibold text-cc-fg">{group.group.name}</div>
        <div className="shrink-0 text-[11px] text-cc-muted">{group.counts.active} active</div>
      </div>
      <div className="mt-1 truncate text-[10px] text-cc-muted">{group.scope}</div>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
        <span className="rounded bg-cc-hover px-1.5 py-0.5 text-cc-muted">{group.counts.total} shown</span>
        {group.counts.risk ? (
          <span className="rounded bg-red-500/10 px-1.5 py-0.5 text-red-300">{group.counts.risk} risk</span>
        ) : null}
        {group.counts.handoffs ? (
          <span className="rounded bg-blue-500/10 px-1.5 py-0.5 text-blue-300">{group.counts.handoffs} handoffs</span>
        ) : null}
      </div>
    </button>
  );
}

function StreamDetail({ stream, children }: { stream: StreamRecord | null; children: StreamRecord[] }) {
  if (!stream) {
    return (
      <div className="flex h-full items-center justify-center rounded-md border border-dashed border-cc-border text-sm text-cc-muted">
        Select a stream to inspect current state, provenance, and timeline.
      </div>
    );
  }

  const artifacts = artifactsForStream(stream);
  const staleFacts = stream.pinnedFacts?.filter((fact) => fact.status !== "active") ?? [];
  const timeline = newestFirst(stream.timeline);

  return (
    <div className="h-full overflow-y-auto rounded-md border border-cc-border bg-cc-card">
      <div className="sticky top-0 z-10 border-b border-cc-border bg-cc-card/95 px-4 py-3 backdrop-blur">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-cc-fg">{stream.title}</h2>
            <div className="mt-1 text-[11px] text-cc-muted">
              {stream.id} / {stream.slug} / updated {formatDate(stream.updatedAt)}
            </div>
          </div>
          <span className={`shrink-0 rounded border px-2 py-1 text-[11px] ${statusClass(stream.status)}`}>
            {stream.status}
          </span>
        </div>
      </div>

      <div className="space-y-5 p-4">
        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-cc-muted">Current State</h3>
          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            <Field label="Summary">{stream.current.summary || "none"}</Field>
            <Field label="Health">{stream.current.health || "none"}</Field>
            <Field label="Operational">{stream.current.operationalStatus || "none"}</Field>
            <Field label="Paperwork">{stream.current.paperworkStatus || "none"}</Field>
            <Field label="Blocked On">{stream.current.blockedOn || "none"}</Field>
            <Field label="Next Check">{stream.current.nextCheckAt || "none"}</Field>
            <Field label="Last Verified">{stream.current.lastVerifiedAt || "none"}</Field>
            <Field label="Open Decisions">{stream.current.openDecisions?.join(", ") || "none"}</Field>
            <Field label="Known Stale">{stream.current.knownStaleFacts?.join(", ") || "none"}</Field>
            <Field label="Active Timers">{stream.current.activeTimers?.join(", ") || "none"}</Field>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-cc-muted">Owners</h3>
            <div className="mt-2">
              <Owners stream={stream} />
            </div>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-cc-muted">Links</h3>
            <div className="mt-2">
              <StreamLinks links={stream.links} />
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-cc-muted">Pinned Facts</h3>
            <div className="mt-2 space-y-2">
              {stream.pinnedFacts?.length ? (
                stream.pinnedFacts.map((fact) => (
                  <div key={fact.id} className={`rounded-md border p-2 text-xs ${factClass(fact.status)}`}>
                    <div>{fact.text}</div>
                    <div className="mt-1 text-[10px] opacity-75">
                      {fact.id} / {fact.status}
                      {fact.source ? (
                        <>
                          {" / "}
                          <SourceRef source={fact.source} />
                        </>
                      ) : null}
                      {fact.supersededBy ? ` / superseded by ${fact.supersededBy}` : ""}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-xs text-cc-muted">none</div>
              )}
            </div>
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-cc-muted">Artifacts And Risks</h3>
            <div className="mt-2 space-y-3 text-xs text-cc-fg">
              <Field label="Artifacts">{artifacts.length ? artifacts.join(", ") : "none"}</Field>
              <Field label="Stale/Superseded Facts">
                {staleFacts.length ? staleFacts.map((fact) => fact.id).join(", ") : "none"}
              </Field>
              <Field label="Child Streams">
                {children.length ? children.map((child) => child.title).join(", ") : "none"}
              </Field>
            </div>
          </div>
        </section>

        <section>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-cc-muted">Timeline</h3>
          <div className="mt-3 space-y-3">
            {timeline.length ? (
              timeline.map((entry) => (
                <div key={entry.id} className="rounded-md border border-cc-border bg-cc-bg/40 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-[11px] text-cc-muted">
                    <span className="rounded bg-cc-hover px-1.5 py-0.5 text-cc-fg">{entry.type}</span>
                    <span>{formatDate(entry.ts)}</span>
                    {entry.source ? <SourceRef source={entry.source} /> : null}
                    {entry.confidence ? <span>{entry.confidence}</span> : null}
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-cc-fg">{entry.text}</p>
                  {entry.links?.length ? (
                    <div className="mt-2">
                      <StreamLinks links={entry.links} />
                    </div>
                  ) : null}
                  {entry.artifacts?.length ? (
                    <div className="mt-2 text-[11px] text-cc-muted">Artifacts: {entry.artifacts.join(", ")}</div>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="rounded-md border border-dashed border-cc-border p-4 text-center text-xs text-cc-muted">
                No timeline entries yet.
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

export function StreamsPage({ embedded = false }: StreamsPageProps) {
  const [includeArchived, setIncludeArchived] = useState(false);
  const [query, setQuery] = useState("");
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading", data: null, error: null });
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [selectedStreamRef, setSelectedStreamRef] = useState<string | null>(null);
  const [detailChildren, setDetailChildren] = useState<StreamRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading", data: null, error: null });
    api
      .listStreamGroups({ includeArchived, query })
      .then((data) => {
        if (cancelled) return;
        setLoadState({ status: "ready", data, error: null });
        const firstGroup = data.groups[0]?.group.id ?? null;
        setSelectedGroupId((current) =>
          current && data.groups.some((group) => group.group.id === current) ? current : firstGroup,
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadState({
          status: "error",
          data: null,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [includeArchived, query]);

  const groups = loadState.data?.groups ?? [];
  const selectedGroup = useMemo(
    () => groups.find((group) => group.group.id === selectedGroupId) ?? groups[0] ?? null,
    [groups, selectedGroupId],
  );
  const streams = selectedGroup?.streams ?? [];
  const selectedStream = useMemo(
    () =>
      streams.find((stream) => stream.id === selectedStreamRef || stream.slug === selectedStreamRef) ??
      streams[0] ??
      null,
    [streams, selectedStreamRef],
  );

  useEffect(() => {
    if (!selectedGroup || !selectedStream) {
      setDetailChildren([]);
      return;
    }
    let cancelled = false;
    api
      .getStreamDetail(selectedGroup.scope, selectedStream.slug)
      .then((detail) => {
        if (!cancelled) setDetailChildren(detail.children);
      })
      .catch(() => {
        if (!cancelled) setDetailChildren([]);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedGroup?.scope, selectedStream?.slug]);

  const totals = useMemo(
    () =>
      groups.reduce(
        (acc, group) => ({
          total: acc.total + group.counts.total,
          active: acc.active + group.counts.active,
          risk: acc.risk + group.counts.risk,
          alerts: acc.alerts + group.counts.alerts,
          contradictions: acc.contradictions + group.counts.contradictions,
        }),
        { total: 0, active: 0, risk: 0, alerts: 0, contradictions: 0 },
      ),
    [groups],
  );

  return (
    <div className={`${embedded ? "h-full" : "min-h-screen"} bg-cc-bg text-cc-fg`}>
      <div className="flex h-full flex-col">
        <header className="border-b border-cc-border px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-lg font-semibold text-cc-fg">Streams</h1>
              <p className="mt-1 text-xs text-cc-muted">
                Session-group stream state, timeline, and provenance for debugging agent coordination.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search streams..."
                aria-label="Search streams"
                className="w-56 rounded-md border border-cc-border bg-cc-input-bg px-2.5 py-1.5 text-xs text-cc-fg outline-none placeholder:text-cc-muted focus:border-cc-primary/60"
              />
              <label className="inline-flex items-center gap-2 rounded-md border border-cc-border bg-cc-card px-2.5 py-1.5 text-xs text-cc-muted">
                <input
                  type="checkbox"
                  checked={includeArchived}
                  onChange={(event) => setIncludeArchived(event.target.checked)}
                  className="accent-cc-primary"
                />
                Include archived
              </label>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
            <span className="rounded bg-cc-hover px-2 py-1 text-cc-muted">{totals.total} shown</span>
            <span className="rounded bg-cc-hover px-2 py-1 text-cc-muted">{totals.active} active</span>
            <span className="rounded bg-red-500/10 px-2 py-1 text-red-300">{totals.risk} risk</span>
            <span className="rounded bg-amber-500/10 px-2 py-1 text-amber-300">{totals.alerts} alerts</span>
            <span className="rounded bg-violet-500/10 px-2 py-1 text-violet-300">
              {totals.contradictions} contradictions
            </span>
          </div>
        </header>

        <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[260px_minmax(280px,360px)_1fr]">
          {loadState.status === "error" ? (
            <div className="col-span-full rounded-md border border-red-500/25 bg-red-500/10 p-4 text-sm text-red-200">
              Failed to load streams: {loadState.error}
            </div>
          ) : null}

          <aside className="min-h-0 overflow-y-auto space-y-2">
            {loadState.status === "loading" ? (
              <div className="rounded-md border border-cc-border bg-cc-card p-4 text-sm text-cc-muted">
                Loading streams...
              </div>
            ) : groups.length ? (
              groups.map((group) => (
                <GroupButton
                  key={group.group.id}
                  group={group}
                  selected={selectedGroup?.group.id === group.group.id}
                  onSelect={() => {
                    setSelectedGroupId(group.group.id);
                    setSelectedStreamRef(group.streams[0]?.slug ?? null);
                  }}
                />
              ))
            ) : (
              <div className="rounded-md border border-dashed border-cc-border p-4 text-sm text-cc-muted">
                No session groups found.
              </div>
            )}
          </aside>

          <section className="min-h-0 overflow-y-auto space-y-2">
            {streams.length ? (
              streams.map((stream) => (
                <StreamCard
                  key={stream.id}
                  stream={stream}
                  selected={selectedStream?.id === stream.id}
                  onSelect={() => setSelectedStreamRef(stream.slug)}
                />
              ))
            ) : (
              <div className="rounded-md border border-dashed border-cc-border p-4 text-sm text-cc-muted">
                No streams found for {selectedGroup?.group.name ?? "this group"}.
              </div>
            )}
          </section>

          <section className="min-h-0">
            <StreamDetail stream={selectedStream} children={detailChildren} />
          </section>
        </main>
      </div>
    </div>
  );
}
