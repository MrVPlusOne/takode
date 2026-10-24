import { useEffect, useRef, useState } from "react";
import type { TopicSummary } from "../../../shared/library-topics.js";
import { topicApi } from "../../api/topics.js";
import { useOutsidePress } from "../../hooks/useOutsidePress.js";
import { StarIcon } from "../ArtifactInline.js";

/**
 * The gallery's search and filters behind one button at the top right, so they take no room until
 * wanted: search, date, topic and starred. The button looks pressed while any filter is on, and a
 * line under the kind tabs says what is filtered.
 */

export const DATE_RANGES = [
  { value: "any", label: "Any time" },
  { value: "day", label: "Today" },
  { value: "week", label: "7 days" },
  { value: "month", label: "30 days" },
] as const;
export type DateRange = (typeof DATE_RANGES)[number]["value"];

export interface ArtifactFilters {
  query: string;
  dateRange: DateRange;
  starred: boolean;
  /** Only artifacts made in this topic's quests. */
  topic: { id: string; name: string; questIds: string[] } | null;
}

export const EMPTY_FILTERS: ArtifactFilters = { query: "", dateRange: "any", starred: false, topic: null };

export function filtersActive(filters: ArtifactFilters): boolean {
  return !!filters.query.trim() || filters.dateRange !== "any" || filters.starred || !!filters.topic;
}

export function sinceFor(range: DateRange): number | undefined {
  if (range === "any") return undefined;
  if (range === "day") {
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    return midnight.getTime();
  }
  return Date.now() - (range === "week" ? 7 : 30) * 24 * 3600_000;
}

export function ArtifactFilterButton({
  filters,
  onChange,
  topicSource,
}: {
  filters: ArtifactFilters;
  onChange: (filters: ArtifactFilters) => void;
  /** Where the topic choices come from: the leader's topics, or the space's. */
  topicSource: { space: string; leaderId: string | null };
}) {
  const [open, setOpen] = useState(false);
  const [topics, setTopics] = useState<TopicSummary[] | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  useOutsidePress([menuRef, buttonRef], () => setOpen(false), open);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    topicApi
      .list(topicSource.space, topicSource.leaderId)
      .then((response) => !cancelled && setTopics(response.topics))
      .catch((error: Error) => {
        // Topics are optional here: without them the menu just has no topic choice.
        console.warn("[library] Could not load topics for the filter menu:", error.message);
        if (!cancelled) setTopics([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, topicSource.space, topicSource.leaderId]);

  const active = filtersActive(filters);
  const update = (patch: Partial<ArtifactFilters>) => onChange({ ...filters, ...patch });
  return (
    <div className="relative shrink-0">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label="Search and filter"
        title="Search and filter"
        className={`flex h-[34px] items-center gap-1.5 rounded-lg border px-2.5 text-[13px] ${
          active || open
            ? "border-cc-primary/50 bg-cc-primary/10 text-cc-fg"
            : "border-cc-border bg-cc-card text-cc-muted hover:text-cc-fg"
        }`}
        data-testid="library-filter-button"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="h-4 w-4"
          aria-hidden="true"
        >
          <circle cx="11" cy="11" r="6.5" />
          <path d="M16 16l4.5 4.5" strokeLinecap="round" />
        </svg>
        <span className="hidden sm:inline">Filter</span>
      </button>
      {open && (
        <div
          ref={menuRef}
          className="absolute right-0 top-full z-30 mt-1.5 w-[min(340px,calc(100vw-1.5rem))] space-y-3 rounded-xl border border-cc-border bg-cc-card p-3 shadow-xl"
          data-testid="library-filter-menu"
        >
          <input
            type="text"
            inputMode="search"
            value={filters.query}
            onChange={(event) => update({ query: event.target.value })}
            onKeyDown={(event) => event.key === "Enter" && setOpen(false)}
            placeholder="Search titles and text"
            aria-label="Search artifacts"
            className="w-full rounded-lg border border-cc-border bg-cc-bg px-3 py-2 text-base text-cc-fg outline-none placeholder:text-cc-muted focus:border-cc-primary/60 md:text-sm"
          />
          <div>
            <div className="mb-1 text-[11px] uppercase tracking-wide text-cc-muted">Changed</div>
            <div className="grid grid-cols-4 overflow-hidden rounded-lg border border-cc-border text-[12.5px]">
              {DATE_RANGES.map((range) => (
                <button
                  key={range.value}
                  type="button"
                  aria-pressed={filters.dateRange === range.value}
                  onClick={() => update({ dateRange: range.value })}
                  className={`py-1.5 ${filters.dateRange === range.value ? "bg-cc-active text-cc-fg" : "text-cc-muted hover:text-cc-fg"}`}
                >
                  {range.label}
                </button>
              ))}
            </div>
          </div>
          {topics && topics.length > 0 && (
            <label className="block">
              <span className="mb-1 block text-[11px] uppercase tracking-wide text-cc-muted">Topic</span>
              <select
                aria-label="Topic"
                value={filters.topic?.id ?? ""}
                onChange={(event) => {
                  const topic = topics.find((candidate) => candidate.id === event.target.value);
                  update({ topic: topic ? { id: topic.id, name: topic.name, questIds: topic.questIds } : null });
                }}
                className="takode-native-select w-full rounded-lg border border-cc-border bg-cc-bg px-2 py-1.5 text-[13px] text-cc-fg"
              >
                <option value="">Any topic</option>
                {topics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-pressed={filters.starred}
              onClick={() => update({ starred: !filters.starred })}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[13px] ${
                filters.starred ? "border-cc-primary/50 bg-cc-primary/10 text-cc-fg" : "border-cc-border text-cc-muted"
              }`}
            >
              <StarIcon filled={filters.starred} className="h-3.5 w-3.5" /> Starred only
            </button>
            {active && (
              <button
                type="button"
                onClick={() => onChange(EMPTY_FILTERS)}
                className="text-[13px] text-cc-primary hover:underline"
              >
                Clear all
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
