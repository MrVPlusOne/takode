import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  api,
  type SearchEverythingCategory,
  type SearchEverythingChildMatch,
  type SearchEverythingResult,
  type SearchEverythingRoute,
} from "../api.js";
import { useStore } from "../store.js";
import {
  navigateToSession,
  navigateToSessionMessageId,
  withQuestIdInHash,
  withThreadKeyInHash,
} from "../utils/routing.js";
import { getHighlightParts } from "../utils/highlight.js";

const CATEGORY_OPTIONS: Array<{ id: SearchEverythingCategory; label: string }> = [
  { id: "quests", label: "Quests" },
  { id: "sessions", label: "Sessions" },
  { id: "messages", label: "Messages" },
];

const DEFAULT_CATEGORIES = new Set<SearchEverythingCategory>(["quests", "sessions", "messages"]);

export function SearchEverythingOverlay({
  open,
  currentSessionId,
  onClose,
}: {
  open: boolean;
  currentSessionId: string | null;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [categories, setCategories] = useState<Set<SearchEverythingCategory>>(() => new Set(DEFAULT_CATEGORIES));
  const [results, setResults] = useState<SearchEverythingResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const selectedResult = results[selectedIndex] ?? null;
  const categoryList = useMemo(() => Array.from(categories), [categories]);
  const trimmedQuery = query.trim();

  useEffect(() => {
    if (!open) return;
    setSelectedIndex(0);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (!trimmedQuery) {
      setResults([]);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      api
        .searchEverything(trimmedQuery, {
          types: categoryList,
          currentSessionId,
          limit: 30,
          childPreviewLimit: 3,
          includeArchived: false,
          includeReviewers: false,
          messageLimitPerSession: 400,
          signal: controller.signal,
        })
        .then((response) => {
          setResults(response.results);
          setSelectedIndex(0);
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return;
          setResults([]);
          setError(err instanceof Error ? err.message : "Search failed");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [categoryList, currentSessionId, open, trimmedQuery]);

  const runResult = useCallback(
    (result: SearchEverythingResult) => {
      navigateSearchRoute(result.route, result.meta.sessionNum ?? undefined);
      onClose();
    },
    [onClose],
  );

  if (!open) return null;

  function toggleCategory(category: SearchEverythingCategory) {
    setCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        if (next.size > 1) next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      onClose();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "ArrowDown") {
      setSelectedIndex((index) => Math.min(results.length - 1, index + 1));
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowUp") {
      setSelectedIndex((index) => Math.max(0, index - 1));
      event.preventDefault();
      return;
    }
    if (event.key === "Enter" && selectedResult) {
      runResult(selectedResult);
      event.preventDefault();
    }
  }

  return (
    <div
      className="fixed inset-0 z-[90] bg-cc-bg/65 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Search Everything"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
    >
      <div className="mx-auto mt-[8vh] flex h-[min(720px,84vh)] w-[min(920px,calc(100vw-24px))] flex-col overflow-hidden rounded-lg border border-cc-border bg-cc-card shadow-2xl">
        <div className="flex items-center gap-3 border-b border-cc-border px-4 py-3">
          <SearchIcon className="h-4 w-4 shrink-0 text-cc-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search quests, sessions, and messages..."
            className="min-w-0 flex-1 bg-transparent text-sm text-cc-fg placeholder:text-cc-muted outline-none"
            aria-label="Search everything query"
          />
          {loading && <span className="text-[11px] text-cc-muted">Searching</span>}
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
            aria-label="Close search"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-cc-border/70 px-4 py-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-cc-muted">Categories</span>
          <div className="flex items-center gap-1 rounded-lg border border-cc-border/70 bg-cc-bg/60 p-0.5">
            {CATEGORY_OPTIONS.map((option) => {
              const active = categories.has(option.id);
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => toggleCategory(option.id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                    active ? "bg-cc-primary/18 text-cc-primary" : "text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
                  }`}
                  aria-pressed={active}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
          <span className="ml-auto text-[11px] text-cc-muted">
            {results.length > 0 ? `${results.length} grouped results` : "App-wide active search"}
          </span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {error ? (
            <SearchState title="Search failed" detail={error} />
          ) : !trimmedQuery ? (
            <SearchState
              title="Search everything"
              detail="Type to search active sessions, messages, quests, and quest history."
            />
          ) : loading && results.length === 0 ? (
            <SearchState title="Searching" detail="Scanning active session evidence and Questmaster records." />
          ) : results.length === 0 ? (
            <SearchState
              title="No results"
              detail="Try a quest ID, session number, title, branch, or message phrase."
            />
          ) : (
            <div className="space-y-1" role="listbox" aria-label="Search results">
              {results.map((result, index) => (
                <SearchResultRow
                  key={result.id}
                  result={result}
                  query={trimmedQuery}
                  selected={index === selectedIndex}
                  onMouseEnter={() => setSelectedIndex(index)}
                  onRun={() => runResult(result)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function SearchEverythingDemoPanel({
  query,
  results,
  state,
}: {
  query: string;
  results: SearchEverythingResult[];
  state: "results" | "loading" | "empty" | "error";
}) {
  return (
    <div className="flex h-[520px] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-cc-border bg-cc-card shadow-xl">
      <div className="flex items-center gap-3 border-b border-cc-border px-4 py-3">
        <SearchIcon className="h-4 w-4 shrink-0 text-cc-muted" />
        <div className="min-w-0 flex-1 text-sm text-cc-fg">{query || "Search quests, sessions, and messages..."}</div>
        {state === "loading" && <span className="text-[11px] text-cc-muted">Searching</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-cc-border/70 px-4 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wide text-cc-muted">Categories</span>
        <div className="flex items-center gap-1 rounded-lg border border-cc-border/70 bg-cc-bg/60 p-0.5">
          {CATEGORY_OPTIONS.map((option) => (
            <span
              key={option.id}
              className="rounded-md bg-cc-primary/18 px-2.5 py-1 text-xs font-medium text-cc-primary"
            >
              {option.label}
            </span>
          ))}
        </div>
        <span className="ml-auto text-[11px] text-cc-muted">
          {results.length > 0 ? `${results.length} grouped results` : "App-wide active search"}
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {state === "error" ? (
          <SearchState title="Search failed" detail="Server returned a scoped search error." />
        ) : state === "loading" ? (
          <SearchState title="Searching" detail="Scanning active session evidence and Questmaster records." />
        ) : state === "empty" ? (
          <SearchState title="No results" detail="Try a quest ID, session number, title, branch, or message phrase." />
        ) : (
          <div className="space-y-1" role="listbox" aria-label="Search results demo">
            {results.map((result, index) => (
              <SearchResultRow
                key={result.id}
                result={result}
                query={query}
                selected={index === 0}
                onMouseEnter={() => undefined}
                onRun={() => undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SearchResultRow({
  result,
  query,
  selected,
  onMouseEnter,
  onRun,
}: {
  result: SearchEverythingResult;
  query: string;
  selected: boolean;
  onMouseEnter: () => void;
  onRun: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onMouseEnter={onMouseEnter}
      onClick={onRun}
      className={`block w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
        selected
          ? "border-cc-primary/35 bg-cc-primary/10"
          : "border-transparent bg-transparent hover:border-cc-border hover:bg-cc-hover/60"
      }`}
    >
      <div className="flex items-start gap-3">
        <ResultBadge type={result.type} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium text-cc-fg">
              <HighlightedInline text={result.title} query={query} />
            </span>
            {result.totalChildMatches > 0 && (
              <span className="shrink-0 rounded-md bg-cc-hover px-1.5 py-0.5 text-[10px] text-cc-muted">
                {result.totalChildMatches} matches
              </span>
            )}
          </div>
          {result.subtitle && <div className="mt-0.5 truncate text-[11px] text-cc-muted">{result.subtitle}</div>}
          {result.childMatches.length > 0 && (
            <div className="mt-2 space-y-1">
              {result.childMatches.map((match) => (
                <ChildMatchRow key={match.id} match={match} query={query} />
              ))}
              {result.remainingChildMatches > 0 && (
                <div className="pl-3 text-[11px] text-cc-muted">+{result.remainingChildMatches} more matches</div>
              )}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

function ChildMatchRow({ match, query }: { match: SearchEverythingChildMatch; query: string }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-2 text-[11px]">
      <span className="truncate text-cc-muted">{match.title}</span>
      <span className="min-w-0 truncate text-cc-fg/80">
        <HighlightedInline text={match.snippet} query={query} />
      </span>
    </div>
  );
}

function HighlightedInline({ text, query }: { text: string; query: string }) {
  return (
    <>
      {getHighlightParts(text, query).map((part, index) =>
        part.matched ? (
          <mark key={`${part.text}-${index}`} className="rounded-[2px] bg-amber-300/25 px-0.5 text-amber-100">
            {part.text}
          </mark>
        ) : (
          <span key={`${part.text}-${index}`}>{part.text}</span>
        ),
      )}
    </>
  );
}

function SearchState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="flex h-full min-h-[220px] flex-col items-center justify-center px-6 text-center">
      <div className="text-sm font-medium text-cc-fg">{title}</div>
      <div className="mt-1 max-w-md text-xs text-cc-muted">{detail}</div>
    </div>
  );
}

function ResultBadge({ type }: { type: SearchEverythingResult["type"] }) {
  const label = type === "quest" ? "Quest" : "Session";
  return (
    <span className="mt-0.5 inline-flex w-16 shrink-0 items-center justify-center rounded-md border border-cc-border bg-cc-bg px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-cc-muted">
      {label}
    </span>
  );
}

function navigateSearchRoute(route: SearchEverythingRoute, routeSessionNum?: number | null) {
  if (route.kind === "quest") {
    window.location.hash = withQuestIdInHash(window.location.hash || "#/", route.questId);
    useStore.getState().openQuestOverlay(route.questId);
    return;
  }

  if (route.kind === "message") {
    if (route.messageId) {
      const routeSessionId = routeSessionNum ?? route.sessionId;
      navigateToSessionMessageId(route.sessionId, route.messageId, {
        routeSessionId,
        threadKey: route.threadKey,
      });
      return;
    }
    const hash = route.threadKey ? withThreadKeyInHash(`#/session/${route.sessionId}`, route.threadKey) : null;
    if (hash) {
      window.location.hash = hash.startsWith("#") ? hash.slice(1) : hash;
    } else {
      navigateToSession(route.sessionId);
    }
    return;
  }

  navigateToSession(route.sessionId);
}

function SearchIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
      <path d="M11.742 10.344a6.5 6.5 0 10-1.397 1.398h-.001l3.85 3.85a1 1 0 001.415-1.414l-3.85-3.85-.017.016zm-5.442.156a5 5 0 110-10 5 5 0 010 10z" />
    </svg>
  );
}

function CloseIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
      <path d="M3.72 3.72a.75.75 0 011.06 0L8 6.94l3.22-3.22a.75.75 0 111.06 1.06L9.06 8l3.22 3.22a.75.75 0 11-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 01-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 010-1.06z" />
    </svg>
  );
}
