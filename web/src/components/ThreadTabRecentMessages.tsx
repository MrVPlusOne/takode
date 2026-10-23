/**
 * Find's Messages mode: the user's messages to this leader, newest first (when searching,
 * best match first and then newest), each with the tab it belongs to. Older pages load as the list scrolls to its end. Tabs are grouped by status, so a
 * conversation from a few exchanges ago can sit in any group; this list finds it by when
 * it happened instead.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { MessageSearchResult } from "../api/session-message-search.js";
import { MAIN_THREAD_KEY, normalizeThreadKey } from "../utils/thread-projection.js";
import { timeAgo } from "../utils/quest-helpers.js";
import { SEARCH_ROW_CLASS, SearchMeta, SearchRowContent } from "./SearchSheet.js";
import type { PrimaryThreadChip } from "./WorkBoardThreadTabs.js";

/** One page of the user's messages to this leader, and where the next older page starts. */
export interface RecentMessagesPage {
  results: MessageSearchResult[];
  /** Offset of the next page, or null once the session's first message has been listed. */
  nextOffset: number | null;
}

/**
 * Loads one page of the user's messages to this leader matching `query` (all when empty),
 * in the server's search order, starting `offset` matches in. The server searches the whole session.
 */
export type LoadRecentMessages = (query: string, offset: number, signal: AbortSignal) => Promise<RecentMessagesPage>;

/** Typing waits this long before searching, so each keystroke does not start a request. */
const SEARCH_DEBOUNCE_MS = 250;

export function ThreadTabRecentMessages({
  query,
  load,
  tabFor,
  onOpen,
}: {
  query: string;
  load: LoadRecentMessages;
  /** The open or closed tab for a thread, to name it and color its bar. */
  tabFor: (threadKey: string) => PrimaryThreadChip | undefined;
  onOpen: (threadKey: string, messageId: string) => void;
}) {
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "error" }
    | { kind: "loaded"; results: MessageSearchResult[]; nextOffset: number | null; more: "idle" | "loading" | "error" }
  >({ kind: "loading" });
  const trimmed = query.trim();
  // Aborts the page in flight when the query changes or the list unmounts.
  const moreRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        load(trimmed, 0, controller.signal)
          .then((page) => setState({ kind: "loaded", ...page, more: "idle" }))
          .catch((error) => {
            if (controller.signal.aborted) return;
            console.error("[thread-tabs] Recent messages failed to load:", error);
            setState({ kind: "error" });
          });
      },
      trimmed ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
      moreRef.current?.abort();
    };
  }, [load, trimmed]);

  const loadMore = useCallback(() => {
    if (state.kind !== "loaded" || state.nextOffset === null || state.more === "loading") return;
    const controller = new AbortController();
    moreRef.current = controller;
    setState({ ...state, more: "loading" });
    load(trimmed, state.nextOffset, controller.signal)
      .then((page) =>
        setState((current) => {
          if (current.kind !== "loaded" || controller.signal.aborted) return current;
          // Messages sent since the first page push older ones down, so a page can repeat a few.
          const seen = new Set(current.results.map((result) => result.id));
          const fresh = page.results.filter((result) => !seen.has(result.id));
          return { kind: "loaded", results: [...current.results, ...fresh], nextOffset: page.nextOffset, more: "idle" };
        }),
      )
      .catch((error) => {
        if (controller.signal.aborted) return;
        console.error("[thread-tabs] Older messages failed to load:", error);
        setState((current) => (current.kind === "loaded" ? { ...current, more: "error" } : current));
      });
  }, [load, state, trimmed]);

  if (state.kind !== "loaded") {
    return (
      <p className="px-4 py-6 text-[13px] text-cc-muted" data-testid="thread-tab-recent-status">
        {state.kind === "loading" ? "Loading your messages…" : "Couldn't load your messages."}
      </p>
    );
  }
  if (state.results.length === 0) {
    return (
      <p className="px-4 py-6 text-[13px] text-cc-muted" data-testid="thread-tab-recent-status">
        {trimmed ? `None of your messages match “${trimmed}”.` : "No messages to this leader yet."}
      </p>
    );
  }
  return (
    <div data-testid="thread-tab-recent-list">
      {state.results.map((result) => (
        <RecentMessageRow
          key={result.id}
          result={result}
          tab={tabFor(threadKeyOf(result))}
          onOpen={() => onOpen(threadKeyOf(result), result.messageId)}
        />
      ))}
      {state.nextOffset !== null && (
        <LoadMoreRow status={state.more} onVisible={state.more === "idle" ? loadMore : undefined} onRetry={loadMore} />
      )}
    </div>
  );
}

/**
 * The end of a list with older messages still to load. It loads them when scrolled into view,
 * and offers a retry when that failed.
 */
function LoadMoreRow({
  status,
  onVisible,
  onRetry,
}: {
  status: "idle" | "loading" | "error";
  onVisible?: () => void;
  onRetry: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || !onVisible || typeof IntersectionObserver === "undefined") return;
    // Start a little before the end comes into view, so scrolling rarely stops at it.
    const observer = new IntersectionObserver(
      (entries) => entries.some((entry) => entry.isIntersecting) && onVisible(),
      {
        rootMargin: "0px 0px 400px 0px",
      },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [onVisible]);
  return (
    <div ref={ref} className="px-4 py-4 text-[13px] text-cc-muted" data-testid="thread-tab-recent-more">
      {status === "error" ? (
        <button type="button" onClick={onRetry} className="text-cc-primary hover:underline">
          Couldn't load older messages. Try again
        </button>
      ) : (
        "Loading older messages…"
      )}
    </div>
  );
}

function threadKeyOf(result: MessageSearchResult): string {
  return normalizeThreadKey(result.routeThreadKey ?? result.questId ?? MAIN_THREAD_KEY);
}

/** What the user said, then the tab it is in, its state and when. */
function RecentMessageRow({
  result,
  tab,
  onOpen,
}: {
  result: MessageSearchResult;
  tab: PrimaryThreadChip | undefined;
  onOpen: () => void;
}) {
  const threadKey = threadKeyOf(result);
  const main = threadKey === MAIN_THREAD_KEY;
  const place = main ? "Main" : (tab?.title ?? threadKey);
  const detail = [main ? null : tab?.stateLabel, timeAgo(result.timestamp)];
  const barColor = main ? "var(--color-cc-fg)" : (tab?.accentColor ?? tab?.titleColor ?? "var(--color-cc-muted)");
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`${SEARCH_ROW_CLASS} hover:bg-cc-hover/40`}
      data-testid="thread-tab-recent-row"
      data-thread-key={threadKey}
      data-message-id={result.messageId}
    >
      <SearchRowContent
        barColor={barColor}
        meta={<SearchMeta items={[place, ...detail]} />}
        metaStyle={{
          color: main ? "var(--color-cc-muted)" : (tab?.titleColor ?? "var(--color-cc-muted)"),
        }}
        metaTestId="thread-tab-recent-row-meta"
      >
        <span className="line-clamp-2 text-[14px] text-cc-fg">
          <Snippet text={result.snippet} ranges={result.matchRanges} />
        </span>
      </SearchRowContent>
    </button>
  );
}

function Snippet({ text, ranges = [] }: { text: string; ranges?: ReadonlyArray<{ start: number; end: number }> }) {
  if (ranges.length === 0) return <>{text}</>;
  const parts = [];
  let at = 0;
  for (const range of ranges) {
    if (range.start < at) continue;
    parts.push(text.slice(at, range.start));
    parts.push(
      <mark key={range.start} className="rounded-sm bg-cc-primary/25 text-inherit">
        {text.slice(range.start, range.end)}
      </mark>,
    );
    at = range.end;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}
