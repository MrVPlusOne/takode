import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ARTIFACT_KIND_PLURALS,
  ARTIFACT_KINDS,
  type ArtifactKind,
  type ArtifactSummary,
} from "../../../shared/artifact-library.js";
import { artifactApi } from "../../api/artifacts.js";
import { useStore } from "../../store.js";
import { setLibraryLeader, showLibraryArtifact, useLibraryNav } from "../../utils/library-nav.js";
import { ArtifactViewer } from "./ArtifactViewer.js";
import { ArtifactCard } from "./ArtifactThumbnail.js";
import { StarIcon } from "../ArtifactInline.js";
import {
  ArtifactFilterButton,
  EMPTY_FILTERS,
  filtersActive,
  sinceFor,
  type ArtifactFilters,
} from "./ArtifactFilters.js";

/**
 * The Library: the gallery of everything agents made for the user, opened when wanted (from a
 * leader's topic panel for that leader's artifacts, from an artifact link, or from a message's
 * Library line); the scope menu switches to a whole space or all of them.
 *
 * Artifacts are a gallery of large thumbnails, one kind at a time (Figures by default, All last),
 * newest first under day headings, loading more as you scroll. Search and the other filters sit
 * behind one button at the top right. Opening an artifact shows it large in place of the gallery.
 */

const PAGE_SIZE = 60;
const KIND_KEY = "cc-library-kind";
type KindTab = ArtifactKind | "all";
const KIND_TABS: readonly KindTab[] = [...ARTIFACT_KINDS, "all"];

export function LibraryPage() {
  const { artifactId, leaderId, topic: requestedTopic } = useLibraryNav();
  const currentSpace = useCurrentSessionSpace();
  const leaderLabel = useSessionLabel(leaderId);
  const [space, setSpace] = useState<string | null>(null);
  const [kind, setKindState] = useState<KindTab>(storedKind);
  const [filters, setFilters] = useState<ArtifactFilters>(EMPTY_FILTERS);
  const [items, setItems] = useState<ArtifactSummary[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [knownSpaces, setKnownSpaces] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestRef = useRef(0);
  // The last leader this Library was opened for, so the scope menu can switch back to it.
  const lastLeader = useRef<string | null>(leaderId);
  if (leaderId) lastLeader.current = leaderId;
  const lastLeaderLabel = useSessionLabel(lastLeader.current);

  // A space chosen in the menu; otherwise the current session's. "" means all spaces.
  const effectiveSpace = space ?? currentSpace ?? "";
  const scopeKey = leaderId ? `leader:${leaderId}` : `space:${effectiveSpace}`;

  const fetchPage = useCallback(
    (offset: number) => {
      const request = ++requestRef.current;
      setLoading(true);
      artifactApi
        .list({
          ...(leaderId ? { leader: leaderId } : { space: effectiveSpace || undefined }),
          kind: kind === "all" ? undefined : kind,
          since: sinceFor(filters.dateRange),
          starred: filters.starred,
          query: filters.query,
          threads: filters.topic?.questIds,
          offset,
          limit: PAGE_SIZE,
        })
        .then((next) => {
          if (request !== requestRef.current) return;
          setItems((previous) => (offset === 0 ? next.artifacts : [...previous, ...next.artifacts]));
          setTotal(next.total);
          setKnownSpaces(next.spaces);
          setError(null);
        })
        .catch((reason: Error) => request === requestRef.current && setError(reason.message))
        .finally(() => request === requestRef.current && setLoading(false));
    },
    [leaderId, effectiveSpace, kind, filters],
  );

  // Opened from a topic page: show everything made in that topic, then forget the request.
  useEffect(() => {
    if (!requestedTopic) return;
    setFilters({ ...EMPTY_FILTERS, topic: requestedTopic });
    setKindState("all");
    useLibraryNav.setState({ topic: null });
  }, [requestedTopic]);

  useEffect(() => {
    const timer = setTimeout(() => fetchPage(0), filters.query ? 200 : 0);
    return () => clearTimeout(timer);
  }, [fetchPage, filters.query]);

  // Applied when the server answers; with Starred on, an unstarred card stays until the next load,
  // so a mistaken tap can be undone in place.
  const toggleStar = (artifact: ArtifactSummary) => {
    artifactApi
      .setStarred(artifact.id, !artifact.starred)
      .then((detail) =>
        setItems((current) =>
          current.map((item) => (item.id === detail.id ? { ...item, starred: detail.starred } : item)),
        ),
      )
      .catch((reason: Error) => setError(reason.message));
  };

  const setKind = (next: KindTab) => {
    setKindState(next);
    localStorage.setItem(KIND_KEY, next);
  };

  const spaces = useMemo(() => {
    const known = new Set(knownSpaces);
    if (currentSpace) known.add(currentSpace);
    return [...known].sort();
  }, [knownSpaces, currentSpace]);

  const scopeSelect = (
    <select
      aria-label="Whose Library"
      value={leaderId ? "leader" : effectiveSpace}
      onChange={(event) => {
        const value = event.target.value;
        if (value === "leader") {
          setLibraryLeader(lastLeader.current);
          return;
        }
        setLibraryLeader(null);
        setSpace(value);
      }}
      className="takode-native-select min-w-0 max-w-[60vw] shrink rounded-lg border border-cc-border bg-cc-card px-2 py-1.5 text-[13px] text-cc-fg md:max-w-[260px]"
    >
      {lastLeader.current && <option value="leader">{lastLeaderLabel}</option>}
      {spaces.map((name) => (
        <option key={name} value={name}>
          {lastLeader.current ? `All of ${name}` : name}
        </option>
      ))}
      <option value="">All spaces</option>
    </select>
  );

  // Kind tabs, then whose artifacts and the filters; on phones the tabs take their own row below.
  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="order-2 w-full md:order-1 md:w-auto md:max-w-[620px] md:flex-1">
        <KindTabs kind={kind} onChange={setKind} />
      </div>
      <div className="order-1 ml-auto flex min-w-0 items-center gap-2 md:order-2">
        {scopeSelect}
        <button
          type="button"
          onClick={() => setFilters((current) => ({ ...current, starred: !current.starred }))}
          aria-pressed={filters.starred}
          aria-label="Starred only"
          title="Starred only"
          className={`flex h-[34px] items-center gap-1.5 rounded-lg border px-2.5 text-[13px] ${
            filters.starred
              ? "border-[var(--color-cc-phase-accent-amber)]/60 bg-[var(--color-cc-phase-accent-amber)]/10 text-cc-fg"
              : "border-cc-border bg-cc-card text-cc-muted hover:text-cc-fg"
          }`}
          data-testid="library-starred-toggle"
        >
          <StarIcon
            filled={filters.starred}
            className={`h-4 w-4 ${filters.starred ? "text-[var(--color-cc-phase-accent-amber)]" : ""}`}
          />
          <span className="hidden sm:inline">Starred</span>
        </button>
        <ArtifactFilterButton
          filters={filters}
          onChange={setFilters}
          topicSource={{ space: effectiveSpace, leaderId }}
        />
      </div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col bg-cc-bg" data-testid="library-page" data-scope={scopeKey}>
      {artifactId && (
        <div className="flex min-h-0 flex-1 flex-col">
          <ArtifactViewer id={artifactId} onBack={() => showLibraryArtifact(null)} onChanged={() => fetchPage(0)} />
        </div>
      )}
      {/* The gallery stays mounted under an open artifact, so going back keeps its scroll position. */}
      <div className={`${artifactId ? "hidden" : "flex"} min-h-0 flex-1 flex-col`}>
        <div className="shrink-0 space-y-2 px-3 pb-2 pt-3">
          {header}
          {filtersActive(filters) && (
            <ActiveFilters filters={filters} onClear={() => setFilters(EMPTY_FILTERS)} total={total} />
          )}
        </div>
        <Gallery
          items={items}
          total={total}
          loading={loading}
          error={error}
          kind={kind}
          showSpace={!leaderId && !effectiveSpace}
          filtered={filtersActive(filters)}
          onMore={() => !loading && total !== null && items.length < total && fetchPage(items.length)}
          onToggleStar={toggleStar}
        />
      </div>
    </div>
  );
}

/** One kind at a time; All is last, for when the kind is unknown. Equal cells, so the bar stays aligned. */
function KindTabs({ kind, onChange }: { kind: KindTab; onChange: (kind: KindTab) => void }) {
  return (
    <div
      className="grid grid-cols-7 overflow-hidden rounded-lg border border-cc-border bg-cc-card text-[12.5px]"
      role="tablist"
      aria-label="Kind"
    >
      {KIND_TABS.map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={kind === value}
          onClick={() => onChange(value)}
          className={`truncate px-0.5 py-1.5 ${kind === value ? "bg-cc-active text-cc-fg" : "text-cc-muted hover:text-cc-fg"}`}
          data-testid="library-kind-tab"
          data-kind={value}
        >
          {value === "all" ? "All" : ARTIFACT_KIND_PLURALS[value]}
        </button>
      ))}
    </div>
  );
}

function ActiveFilters({
  filters,
  total,
  onClear,
}: {
  filters: ArtifactFilters;
  total: number | null;
  onClear: () => void;
}) {
  const parts = [
    filters.query.trim() ? `“${filters.query.trim()}”` : null,
    filters.topic ? filters.topic.name : null,
    filters.dateRange !== "any"
      ? { day: "Today", week: "Last 7 days", month: "Last 30 days" }[filters.dateRange]
      : null,
    filters.starred ? "Starred" : null,
  ].filter(Boolean);
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-cc-muted" data-testid="library-active-filters">
      <span className="min-w-0 flex-1 truncate">
        {total === null ? "" : `${total} matching `}
        {parts.join(" · ")}
      </span>
      <button type="button" onClick={onClear} className="shrink-0 text-cc-primary hover:underline">
        Clear
      </button>
    </div>
  );
}

function Gallery({
  items,
  total,
  loading,
  error,
  kind,
  showSpace,
  filtered,
  onMore,
  onToggleStar,
}: {
  items: ArtifactSummary[];
  total: number | null;
  loading: boolean;
  error: string | null;
  kind: KindTab;
  showSpace: boolean;
  filtered: boolean;
  onMore: () => void;
  onToggleStar: (artifact: ArtifactSummary) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const onMoreRef = useRef(onMore);
  onMoreRef.current = onMore;
  const groups = useMemo(() => groupByDay(items), [items]);

  // Load the next page while the end of the gallery is still a screen away.
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => entries[0]?.isIntersecting && onMoreRef.current(), {
      root: scrollRef.current,
      rootMargin: "0px 0px 800px 0px",
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-6" data-testid="library-gallery">
      {error ? (
        <div className="py-6 text-[13px] text-cc-error">{error}</div>
      ) : total === null ? (
        <div className="py-6 text-[13px] text-cc-muted">Loading…</div>
      ) : items.length === 0 ? (
        <div className="py-10 text-center text-[13px] text-cc-muted">
          {filtered
            ? "Nothing matches."
            : kind === "all"
              ? "Drafts, reports, figures, visuals, tables and guided reviews agents make show up here."
              : `No ${ARTIFACT_KIND_PLURALS[kind].toLowerCase()} yet.`}
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.label}>
            <h3 className="pb-1.5 pt-3 text-[11px] uppercase tracking-wide text-cc-muted">{group.label}</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(210px,1fr))] sm:gap-3">
              {group.artifacts.map((artifact) => (
                <ArtifactCard
                  key={artifact.id}
                  artifact={artifact}
                  showKind={kind === "all"}
                  showSpace={showSpace}
                  onOpen={() => showLibraryArtifact(artifact.id)}
                  onToggleStar={() => onToggleStar(artifact)}
                />
              ))}
            </div>
          </section>
        ))
      )}
      <div ref={sentinelRef} className="h-px" />
      {loading && items.length > 0 && <div className="py-3 text-center text-[12px] text-cc-muted">Loading more…</div>}
    </div>
  );
}

function storedKind(): KindTab {
  const stored = typeof localStorage === "undefined" ? null : localStorage.getItem(KIND_KEY);
  return KIND_TABS.includes(stored as KindTab) ? (stored as KindTab) : "figure";
}

/** The session space of the session on screen, so the Library starts there. */
function useCurrentSessionSpace(): string | null {
  return useStore((state) => {
    const id = state.currentSessionId;
    const session = id ? state.sdkSessions.find((candidate) => candidate.sessionId === id) : undefined;
    return (session as { memorySessionSpaceSlug?: string } | undefined)?.memorySessionSpaceSlug ?? null;
  });
}

/** "#2957 Daily Leader" for a session ID. */
function useSessionLabel(sessionId: string | null): string {
  return useStore((state) => {
    if (!sessionId) return "";
    const session = state.sdkSessions.find((candidate) => candidate.sessionId === sessionId);
    const name = session?.name ?? "";
    return `${session?.sessionNum != null ? `#${session.sessionNum} ` : ""}${name}`.trim() || sessionId.slice(0, 8);
  });
}

/** Artifacts under Today, Yesterday, then dates, by when each last changed. */
export function groupByDay(
  artifacts: ArtifactSummary[],
  now = Date.now(),
): Array<{ label: string; artifacts: ArtifactSummary[] }> {
  const groups: Array<{ label: string; artifacts: ArtifactSummary[] }> = [];
  for (const artifact of artifacts) {
    const label = dayLabel(artifact.updatedAt, now);
    const last = groups.at(-1);
    if (last?.label === label) last.artifacts.push(artifact);
    else groups.push({ label, artifacts: [artifact] });
  }
  return groups;
}

function dayLabel(at: number, now: number): string {
  const day = (time: number) => new Date(time).toDateString();
  if (day(at) === day(now)) return "Today";
  if (day(at) === day(now - 24 * 3600_000)) return "Yesterday";
  return new Date(at).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
