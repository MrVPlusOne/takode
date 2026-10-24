import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ARTIFACT_KINDS,
  ARTIFACT_KIND_LABELS,
  type ArtifactKind,
  type ArtifactListResponse,
  type ArtifactSummary,
} from "../../../shared/artifact-library.js";
import { artifactApi } from "../../api/artifacts.js";
import { useStore } from "../../store.js";
import { setLibraryMode, showLibraryArtifact, useLibraryNav } from "../../utils/library-nav.js";
import { TopicsPanel } from "./TopicsPanel.js";
import { FigureImage, LibraryIcon, StarIcon } from "../ArtifactInline.js";
import { ArtifactViewer } from "./ArtifactViewer.js";

/**
 * The Library page: everything agents made for the user, across sessions, newest first, with
 * search, space, kind, date and star filters. Selecting an artifact opens it beside the list on
 * wide screens and in place of the list on phones. Topics come in a later step.
 */

const PAGE_SIZE = 100;
const DATE_RANGES = [
  { value: "any", label: "Any time", ms: 0 },
  { value: "day", label: "Today", ms: 0 },
  { value: "week", label: "Last 7 days", ms: 7 * 24 * 3600_000 },
  { value: "month", label: "Last 30 days", ms: 30 * 24 * 3600_000 },
] as const;
type DateRange = (typeof DATE_RANGES)[number]["value"];

export function LibraryPage() {
  const { artifactId, mode } = useLibraryNav();
  const currentSpace = useCurrentSessionSpace();
  const [space, setSpace] = useState<string | null>(null);
  const [kind, setKind] = useState<ArtifactKind | "">("");
  const [dateRange, setDateRange] = useState<DateRange>("any");
  const [starred, setStarred] = useState(false);
  const [query, setQuery] = useState("");
  const [response, setResponse] = useState<ArtifactListResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const requestRef = useRef(0);

  // Start in the current session's space; "" means all spaces.
  const effectiveSpace = space ?? currentSpace ?? "";

  const load = useCallback(() => {
    const request = ++requestRef.current;
    artifactApi
      .list({
        space: effectiveSpace || undefined,
        kind: kind || undefined,
        since: sinceFor(dateRange),
        starred,
        query,
        limit,
      })
      .then((next) => {
        if (request !== requestRef.current) return;
        setResponse(next);
        setError(null);
      })
      .catch((reason: Error) => request === requestRef.current && setError(reason.message));
  }, [effectiveSpace, kind, dateRange, starred, query, limit]);

  useEffect(() => {
    const timer = setTimeout(load, query ? 200 : 0);
    return () => clearTimeout(timer);
  }, [load, query]);

  const groups = useMemo(() => groupByDay(response?.artifacts ?? []), [response]);
  const spaces = useMemo(() => {
    const known = new Set(response?.spaces ?? []);
    if (currentSpace) known.add(currentSpace);
    return [...known].sort();
  }, [response, currentSpace]);

  const header = (
    <div className="flex items-center gap-2">
      <div
        className="grid flex-1 grid-cols-2 overflow-hidden rounded-lg border border-cc-border bg-cc-card text-[13px]"
        role="tablist"
      >
        {(["topics", "artifacts"] as const).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => setLibraryMode(value)}
            className={`py-1.5 ${mode === value ? "bg-cc-active text-cc-fg" : "text-cc-muted hover:text-cc-fg"}`}
          >
            {value === "topics" ? "Topics" : "Artifacts"}
          </button>
        ))}
      </div>
      {spaces.length > 1 && (
        <select
          aria-label="Space"
          value={effectiveSpace}
          onChange={(event) => setSpace(event.target.value)}
          className="takode-native-select max-w-[40%] rounded-lg border border-cc-border bg-cc-card px-2 py-1.5 text-[13px] text-cc-fg"
        >
          <option value="">All spaces</option>
          {spaces.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )}
    </div>
  );

  const list = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-col gap-2 px-3 pb-2 pt-3">
        {header}
        <input
          type="text"
          inputMode="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setLimit(PAGE_SIZE);
          }}
          placeholder="Search artifacts"
          aria-label="Search artifacts"
          className="w-full rounded-xl border border-cc-border bg-cc-card px-3 py-2 text-base text-cc-fg outline-none placeholder:text-cc-muted focus:border-cc-primary/60 md:text-sm"
        />
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <select
            aria-label="Kind"
            value={kind}
            onChange={(event) => setKind(event.target.value as ArtifactKind | "")}
            className="takode-native-select min-w-0 rounded-lg border border-cc-border bg-cc-card px-2 py-1.5 text-[13px] text-cc-fg"
          >
            <option value="">All kinds</option>
            {ARTIFACT_KINDS.map((value) => (
              <option key={value} value={value}>
                {ARTIFACT_KIND_LABELS[value]}s
              </option>
            ))}
          </select>
          <select
            aria-label="Date"
            value={dateRange}
            onChange={(event) => setDateRange(event.target.value as DateRange)}
            className="takode-native-select min-w-0 rounded-lg border border-cc-border bg-cc-card px-2 py-1.5 text-[13px] text-cc-fg"
          >
            {DATE_RANGES.map((range) => (
              <option key={range.value} value={range.value}>
                {range.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setStarred((value) => !value)}
            aria-pressed={starred}
            aria-label="Starred only"
            title="Starred only"
            className={`flex w-10 items-center justify-center rounded-lg border border-cc-border ${
              starred ? "bg-cc-active text-cc-fg" : "bg-cc-card text-cc-muted hover:text-cc-fg"
            }`}
          >
            <StarIcon filled={starred} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto border-t border-cc-border" data-testid="library-list">
        {error ? (
          <div className="px-4 py-6 text-[13px] text-cc-error">{error}</div>
        ) : !response ? (
          <div className="px-4 py-6 text-[13px] text-cc-muted">Loading…</div>
        ) : response.artifacts.length === 0 ? (
          <div className="px-4 py-8 text-center text-[13px] text-cc-muted">
            {query || kind || starred || dateRange !== "any"
              ? "No artifacts match."
              : "Drafts, reports, figures, visuals and guided reviews agents make show up here."}
          </div>
        ) : (
          <>
            {groups.map((group) => (
              <section key={group.label}>
                <div className="px-4 pb-1 pt-3 text-[11px] uppercase tracking-wide text-cc-muted">{group.label}</div>
                {group.artifacts.map((artifact) => (
                  <ArtifactRow
                    key={artifact.id}
                    artifact={artifact}
                    selected={artifact.id === artifactId}
                    showSpace={!effectiveSpace}
                    onOpen={() => showLibraryArtifact(artifact.id)}
                  />
                ))}
              </section>
            ))}
            {response.total > response.artifacts.length && (
              <button
                type="button"
                onClick={() => setLimit((value) => value + PAGE_SIZE)}
                className="w-full py-3 text-[13px] text-cc-primary hover:bg-cc-hover"
              >
                Show {Math.min(PAGE_SIZE, response.total - response.artifacts.length)} more
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );

  if (mode === "topics") {
    return (
      <div className="flex h-full min-h-0 flex-col bg-cc-bg" data-testid="library-page">
        <div className="shrink-0 px-3 pb-2 pt-3 md:w-[380px]">{header}</div>
        <TopicsPanel space={effectiveSpace} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 bg-cc-bg" data-testid="library-page">
      <div
        className={`${artifactId ? "hidden md:flex" : "flex"} min-h-0 w-full flex-col md:w-[380px] md:shrink-0 md:border-r md:border-cc-border`}
      >
        {list}
      </div>
      {artifactId ? (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ArtifactViewer id={artifactId} onBack={() => showLibraryArtifact(null)} onChanged={load} />
        </div>
      ) : (
        <div className="hidden min-w-0 flex-1 items-center justify-center text-[13px] text-cc-muted md:flex">
          <span className="flex items-center gap-2">
            <LibraryIcon className="h-4 w-4" /> Choose an artifact
          </span>
        </div>
      )}
    </div>
  );
}

function ArtifactRow({
  artifact,
  selected,
  showSpace,
  onOpen,
}: {
  artifact: ArtifactSummary;
  selected: boolean;
  /** Only when all spaces are listed; otherwise every row would repeat it. */
  showSpace: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full items-start gap-3 border-b border-cc-border px-4 py-2.5 text-left ${
        selected ? "bg-cc-active" : "hover:bg-cc-hover"
      }`}
      data-testid="library-artifact-row"
    >
      <ArtifactThumb artifact={artifact} />
      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[15px] text-cc-fg">
          {artifact.title}
          {artifact.starred && <StarIcon filled className="ml-1 inline h-3 w-3 text-cc-muted" />}
        </span>
        <span className="mt-0.5 block truncate text-[12.5px] text-cc-muted">
          {ARTIFACT_KIND_LABELS[artifact.kind]}
          {artifact.versionCount > 1 ? ` · v${artifact.versionCount}` : ""}
          {showSpace ? ` · ${artifact.space}` : ""} · {formatClock(artifact.updatedAt)}
        </span>
      </span>
    </button>
  );
}

function ArtifactThumb({ artifact }: { artifact: ArtifactSummary }) {
  const box =
    "flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-cc-border bg-cc-code-bg text-cc-muted";
  if (artifact.kind === "figure" && artifact.latest.kept) {
    return (
      <span className={box}>
        <FigureImage id={artifact.id} cover className="h-full border-0" />
      </span>
    );
  }
  if (artifact.kind === "post") {
    return (
      <span className={`${box} items-start justify-start p-1 text-[7px] leading-tight`} aria-hidden="true">
        {artifact.preview.slice(0, 60)}
      </span>
    );
  }
  return (
    <span className={box} aria-hidden="true">
      <KindIcon kind={artifact.kind} />
    </span>
  );
}

function KindIcon({ kind }: { kind: ArtifactKind }) {
  const paths: Record<ArtifactKind, string> = {
    post: "M4 5h16v11H9l-5 4z",
    report: "M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 17h6",
    review: "M8 6h12 M8 12h12 M8 18h12 M4 6h.01 M4 12h.01 M4 18h.01",
    visual: "M4 20V4 M4 20h16 M7 15l4-4 3 3 5-6",
    figure: "M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6",
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      className="h-5 w-5"
    >
      <path d={paths[kind]} />
    </svg>
  );
}

/** The session space of the session on screen, so the Library starts there. */
function useCurrentSessionSpace(): string | null {
  return useStore((state) => {
    const id = state.currentSessionId;
    const session = id ? state.sdkSessions.find((candidate) => candidate.sessionId === id) : undefined;
    return (session as { memorySessionSpaceSlug?: string } | undefined)?.memorySessionSpaceSlug ?? null;
  });
}

function sinceFor(range: DateRange): number | undefined {
  if (range === "any") return undefined;
  if (range === "day") {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    return midnight.getTime();
  }
  return Date.now() - DATE_RANGES.find((candidate) => candidate.value === range)!.ms;
}

/** Rows under Today, Yesterday, then dates, by when each artifact last changed. */
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
  return new Date(at).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatClock(at: number): string {
  const sameDay = new Date(at).toDateString() === new Date().toDateString();
  return sameDay
    ? new Date(at).toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      })
    : new Date(at).toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
      });
}
