/**
 * Find's Recent mode: the user's latest messages to this leader, newest first, each with
 * the tab it belongs to. Tabs are grouped by status, so a conversation from a few
 * exchanges ago can sit in any group; this list finds it by when it happened instead.
 */
import { useEffect, useState } from "react";
import type { MessageSearchResult } from "../api/session-message-search.js";
import { MAIN_THREAD_KEY, normalizeThreadKey } from "../utils/thread-projection.js";
import { timeAgo } from "../utils/quest-helpers.js";
import type { PrimaryThreadChip } from "./WorkBoardThreadTabs.js";

/** Loads the user's messages to this leader, newest first, or the best matches for `query`. */
export type LoadRecentMessages = (query: string, signal: AbortSignal) => Promise<MessageSearchResult[]>;

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
    { kind: "loading" } | { kind: "error" } | { kind: "loaded"; results: MessageSearchResult[] }
  >({ kind: "loading" });
  const trimmed = query.trim();

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        load(trimmed, controller.signal)
          .then((results) => setState({ kind: "loaded", results }))
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
    };
  }, [load, trimmed]);

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
  // A long quest title gives way first, so the state and time stay readable.
  const detail = [main ? null : tab?.stateLabel, timeAgo(result.timestamp)].filter(Boolean).join(" · ");
  const barColor = main ? "var(--color-cc-fg)" : (tab?.accentColor ?? tab?.titleColor ?? "var(--color-cc-muted)");
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-cc-hover/40"
      data-testid="thread-tab-recent-row"
      data-thread-key={threadKey}
      data-message-id={result.messageId}
    >
      <span className="w-1 self-stretch shrink-0 rounded-full" style={{ backgroundColor: barColor }} />
      <span className="flex min-w-0 flex-1 flex-col leading-snug">
        <span className="line-clamp-2 text-[14px] text-cc-fg">
          <Snippet text={result.snippet} ranges={result.matchRanges} />
        </span>
        <span
          className="mt-0.5 flex min-w-0 whitespace-pre text-[11.5px]"
          style={{ color: main ? "var(--color-cc-muted)" : (tab?.titleColor ?? "var(--color-cc-muted)") }}
          data-testid="thread-tab-recent-row-meta"
        >
          <span className="truncate">{place}</span>
          <span className="shrink-0"> · {detail}</span>
        </span>
      </span>
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
