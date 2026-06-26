import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { api } from "../api.js";
import { normalizeForSearch } from "../../shared/search-utils.js";
import { escapeSelectorValue } from "./message-feed-utils.js";
import type { UserNavigationTarget } from "./message-feed-user-navigation.js";

type ElementRef<T> = RefObject<T | null>;

interface UserMessageNavigatorProps {
  sessionId: string;
  currentThreadKey: string;
  isLeaderSession: boolean;
  useServerSearch: boolean;
  isTouch: boolean;
  containerRef: ElementRef<HTMLDivElement>;
  contentRootRef: ElementRef<HTMLDivElement>;
  targets: readonly UserNavigationTarget[];
  visibleWindowSignature: string;
  buttonClassName: string;
  defaultOpen?: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onSelectTarget: (target: UserNavigationTarget) => void;
}

interface SearchState {
  status: "idle" | "loading" | "error";
  ids: string[];
}

const SEARCH_LIMIT = 100;

export function UserMessageNavigator({
  sessionId,
  currentThreadKey,
  isLeaderSession,
  useServerSearch,
  isTouch,
  containerRef,
  contentRootRef,
  targets,
  visibleWindowSignature,
  buttonClassName,
  defaultOpen = false,
  onPrevious,
  onNext,
  onSelectTarget,
}: UserMessageNavigatorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const selectorListRef = useRef<HTMLDivElement>(null);
  const lastCenteredOpenTokenRef = useRef<number | null>(null);
  const [open, setOpen] = useState(defaultOpen);
  const [selectorOpenToken, setSelectorOpenToken] = useState(0);
  const [query, setQuery] = useState("");
  const [activeTargetKey, setActiveTargetKey] = useState<string | null>(null);
  const [searchState, setSearchState] = useState<SearchState>({ status: "idle", ids: [] });
  const uniqueTargets = useMemo(() => uniqueUserNavigationTargets(targets), [targets]);
  const activeIndex = uniqueTargets.findIndex((target) => target.key === activeTargetKey);
  const resolvedActiveTargetKey = activeIndex >= 0 ? activeTargetKey : (uniqueTargets.at(-1)?.key ?? null);
  const activePosition = uniqueTargets.length === 0 ? 0 : activeIndex >= 0 ? activeIndex + 1 : uniqueTargets.length;
  const trimmedQuery = query.trim();
  const displayedTargets = useMemo(() => {
    if (!trimmedQuery) return uniqueTargets;
    if (useServerSearch && searchState.status === "idle") {
      const byMessageId = new Map(uniqueTargets.map((target) => [target.messageId, target]));
      return searchState.ids.flatMap((id) => {
        const target = byMessageId.get(id);
        return target ? [target] : [];
      });
    }
    return filterTargetsLocally(uniqueTargets, trimmedQuery);
  }, [searchState.ids, searchState.status, trimmedQuery, uniqueTargets, useServerSearch]);

  const syncActiveTarget = useCallback(() => {
    const nextKey = resolveActiveTargetKey(containerRef.current, contentRootRef.current, uniqueTargets);
    setActiveTargetKey((current) => (current === nextKey ? current : nextKey));
  }, [containerRef, contentRootRef, uniqueTargets]);

  useEffect(() => {
    syncActiveTarget();
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener("scroll", syncActiveTarget, { passive: true });
    window.addEventListener("resize", syncActiveTarget);
    return () => {
      container.removeEventListener("scroll", syncActiveTarget);
      window.removeEventListener("resize", syncActiveTarget);
    };
  }, [containerRef, syncActiveTarget, visibleWindowSignature]);

  useEffect(() => {
    if (!trimmedQuery || !useServerSearch) {
      setSearchState({ status: "idle", ids: [] });
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      setSearchState((current) => ({ ...current, status: "loading" }));
      void api
        .searchSessionMessages(sessionId, {
          query: trimmedQuery,
          scope: isLeaderSession ? "current_thread" : "session",
          threadKey: isLeaderSession ? currentThreadKey || "main" : undefined,
          filters: { user: true, assistant: true, event: false },
          limit: SEARCH_LIMIT,
          signal: controller.signal,
        })
        .then((response) => {
          if (controller.signal.aborted) return;
          setSearchState({
            status: "idle",
            ids: response.results.map((result) => result.messageId),
          });
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          console.warn("[user-message-navigator] message search failed:", err);
          setSearchState({ status: "error", ids: [] });
        });
    }, 160);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [currentThreadKey, isLeaderSession, sessionId, trimmedQuery, useServerSearch]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    if (lastCenteredOpenTokenRef.current === selectorOpenToken) return;

    const targetKey = resolvedActiveTargetKey;
    if (!targetKey) {
      lastCenteredOpenTokenRef.current = selectorOpenToken;
      return;
    }

    const targetIsDisplayed = displayedTargets.some((target) => target.key === targetKey);
    if (!targetIsDisplayed) {
      if (trimmedQuery) lastCenteredOpenTokenRef.current = selectorOpenToken;
      return;
    }

    const selectorList = selectorListRef.current;
    const selectedRow = selectorList?.querySelector<HTMLElement>(
      `[data-user-message-target-key="${escapeSelectorValue(targetKey)}"]`,
    );
    if (!selectedRow) return;
    if (typeof selectedRow.scrollIntoView !== "function") return;

    selectedRow.scrollIntoView({ block: "center", inline: "nearest" });
    lastCenteredOpenTokenRef.current = selectorOpenToken;
  }, [displayedTargets, open, resolvedActiveTargetKey, selectorOpenToken, trimmedQuery]);

  const triggerClassName = isTouch
    ? "h-10 min-w-16 rounded-full border border-cc-border bg-cc-card px-2.5 text-[12px] font-medium text-cc-fg shadow-lg transition-colors hover:bg-cc-hover focus:outline-none focus:ring-2 focus:ring-cc-primary/40"
    : "h-8 min-w-14 rounded-full border border-cc-border bg-cc-card px-2 text-[11px] font-medium text-cc-fg shadow-lg transition-colors hover:bg-cc-hover focus:outline-none focus:ring-2 focus:ring-cc-primary/40";
  const hasTargets = uniqueTargets.length > 0;

  return (
    <div ref={rootRef} className="relative flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={onPrevious}
        className={buttonClassName}
        title="Previous user message"
        aria-label="Previous user message"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
          <path d="M4 7l4-4 4 4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8 3v10" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        onClick={() => {
          if (!hasTargets) return;
          if (!open) setSelectorOpenToken((token) => token + 1);
          setOpen((current) => !current);
        }}
        className={`${triggerClassName} ${hasTargets ? "" : "cursor-not-allowed opacity-60"}`}
        aria-haspopup="dialog"
        aria-expanded={hasTargets && open}
        aria-label={`User message navigator, ${activePosition} of ${uniqueTargets.length}`}
        title="User message navigator"
        disabled={!hasTargets}
      >
        {activePosition} / {uniqueTargets.length}
      </button>
      <button
        type="button"
        onClick={onNext}
        className={buttonClassName}
        title="Next user message"
        aria-label="Next user message"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-4 h-4">
          <path d="M4 9l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M8 3v10" strokeLinecap="round" />
        </svg>
      </button>
      {hasTargets && open && (
        <div
          role="dialog"
          aria-label="User message selector"
          className="absolute bottom-[calc(100%+0.5rem)] right-0 z-20 flex max-h-[min(420px,calc(100vh-12rem))] w-[min(360px,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-cc-border bg-cc-card shadow-xl sm:bottom-0 sm:right-[calc(100%+0.5rem)] sm:w-[360px]"
        >
          <div className="border-b border-cc-border p-2">
            <label className="sr-only" htmlFor={`user-message-navigator-search-${sessionId}`}>
              Search user messages
            </label>
            <input
              id={`user-message-navigator-search-${sessionId}`}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search user messages..."
              className="h-8 w-full rounded-md border border-cc-border bg-cc-bg px-2 text-xs text-cc-fg outline-none transition-colors placeholder:text-cc-muted focus:border-cc-primary/60"
            />
          </div>
          <div ref={selectorListRef} className="min-h-0 overflow-y-auto p-1.5">
            {searchState.status === "loading" && trimmedQuery && (
              <div className="px-2 py-1.5 text-[11px] text-cc-muted">Searching...</div>
            )}
            {displayedTargets.length === 0 ? (
              <div className="px-2 py-3 text-xs text-cc-muted">No matching user messages.</div>
            ) : (
              <div className="space-y-1">
                {displayedTargets.map((target) => {
                  const position = uniqueTargets.findIndex((candidate) => candidate.messageId === target.messageId) + 1;
                  const selected = target.key === resolvedActiveTargetKey;
                  return (
                    <button
                      key={target.key}
                      data-user-message-target-key={target.key}
                      type="button"
                      onClick={() => {
                        onSelectTarget(target);
                        setActiveTargetKey(target.key);
                        setOpen(false);
                      }}
                      className={`flex w-full min-w-0 items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                        selected ? "bg-cc-primary/15 text-cc-fg" : "text-cc-fg/90 hover:bg-cc-hover focus:bg-cc-hover"
                      } focus:outline-none focus:ring-2 focus:ring-cc-primary/35`}
                      aria-current={selected ? "location" : undefined}
                    >
                      <span className="mt-0.5 w-7 shrink-0 text-[10px] tabular-nums text-cc-muted">
                        {position || 1}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 break-words">{previewText(target.content)}</span>
                        <span className="mt-0.5 block text-[10px] text-cc-muted">
                          {formatNavigatorTime(target.timestamp)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function uniqueUserNavigationTargets(targets: readonly UserNavigationTarget[]): UserNavigationTarget[] {
  const seen = new Set<string>();
  const unique: UserNavigationTarget[] = [];
  for (const target of targets) {
    if (seen.has(target.messageId)) continue;
    seen.add(target.messageId);
    unique.push(target);
  }
  return unique;
}

function resolveActiveTargetKey(
  container: HTMLDivElement | null,
  contentRoot: HTMLDivElement | null,
  targets: readonly UserNavigationTarget[],
): string | null {
  if (!container || !contentRoot || targets.length === 0) return targets.at(-1)?.key ?? null;
  const containerRect = container.getBoundingClientRect();
  const anchorLine = containerRect.top + container.clientHeight * 0.35;
  let active: UserNavigationTarget | null = null;
  let firstVisible: UserNavigationTarget | null = null;
  for (const target of targets) {
    const element = contentRoot.querySelector<HTMLElement>(
      `[data-feed-block-id="${escapeSelectorValue(target.blockId)}"]`,
    );
    if (!element) continue;
    const rect = element.getBoundingClientRect();
    if (!firstVisible && rect.bottom > containerRect.top && rect.top < containerRect.bottom) {
      firstVisible = target;
    }
    if (rect.top <= anchorLine) {
      active = target;
    }
  }
  return (active ?? firstVisible ?? targets.at(-1) ?? null)?.key ?? null;
}

function filterTargetsLocally(targets: readonly UserNavigationTarget[], query: string): UserNavigationTarget[] {
  const normalizedQuery = normalizeForSearch(query);
  if (!normalizedQuery) return [...targets];
  const words = normalizedQuery.split(/\s+/).filter(Boolean);
  return targets.filter((target) => {
    const text = normalizeForSearch(target.content);
    return words.every((word) => text.includes(word));
  });
}

function previewText(content: string): string {
  const text = content.replace(/\s+/g, " ").trim();
  return text || "(empty message)";
}

function formatNavigatorTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
