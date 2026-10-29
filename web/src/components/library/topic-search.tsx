import { useState } from "react";
import type { TopicSummary } from "../../../shared/library-topics.js";

/**
 * Finding a topic in a leader's topic lists (the Topics tab group and the topic panel on Main):
 * a small search box in the list's header that widens while in use. Topics whose name matches
 * come first, then those that match by their newest update line, each kept in the list's order.
 */

/** The line a topic row shows under its name: its newest update, or its description before one. */
export function topicRowLine(topic: TopicSummary): string | undefined {
  const line = topic.latestUpdate ?? topic.summary;
  // A History line starts with its date ("Oct 25 · …"); the row shows the time separately.
  return line?.replace(/^[A-Z][a-z]{2} \d{1,2}(?:\s*(?:-|to)\s*\d{1,2})?\s*·\s*/, "");
}

/**
 * The topics matching `query`, each of its words starting a word, in any order: name matches
 * first, then matches on the name and update line together. All topics, in order, for an empty query.
 */
export function searchTopics(topics: readonly TopicSummary[], query: string): TopicSummary[] {
  const words = searchWords(query);
  if (words.length === 0) return [...topics];
  const byName = topics.filter((topic) => matchesWords(topic.name, words));
  const byLine = topics.filter(
    (topic) =>
      !byName.includes(topic) &&
      // A topic is found by the names of threads filed under it too.
      matchesWords(
        `${topic.name} ${(topic.threads ?? []).map((thread) => thread.name).join(" ")} ${topicRowLine(topic) ?? ""}`,
        words,
      ),
  );
  return [...byName, ...byLine];
}

/** Whether every word of `query` starts a word of `text`; true for an empty query. */
export function matchesSearch(text: string, query: string): boolean {
  return matchesWords(text, searchWords(query));
}

/**
 * The search box. It sits small at the end of the list's heading, within reach of the right thumb,
 * and takes the row's remaining width while focused or holding a query. Escape clears a query and keeps the list open; with nothing
 * typed, Escape goes on to the list's host (the tab group closes its list).
 */
export function TopicSearchBox({
  query,
  onChange,
  label = "Search topics",
}: {
  query: string;
  onChange: (query: string) => void;
  label?: string;
}) {
  const [focused, setFocused] = useState(false);
  const wide = focused || query.length > 0;
  return (
    <label
      className={`relative ml-auto flex h-7 min-w-0 items-center rounded-md border bg-cc-input-bg transition-[flex-basis,border-color] duration-150 ${
        wide ? "flex-1 basis-40 border-cc-primary/50" : "basis-28 border-cc-border"
      }`}
      data-testid="topic-search"
      data-wide={wide ? "true" : "false"}
    >
      <svg
        viewBox="0 0 16 16"
        className="pointer-events-none absolute left-2 h-3.5 w-3.5 text-cc-muted"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden="true"
      >
        <circle cx="7" cy="7" r="4.25" />
        <path d="M10.25 10.25L13.5 13.5" strokeLinecap="round" />
      </svg>
      <input
        type="text"
        inputMode="search"
        enterKeyHint="search"
        aria-label={label}
        placeholder="Search"
        autoComplete="off"
        spellCheck={false}
        value={query}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key !== "Escape" || !query) return;
          event.stopPropagation();
          onChange("");
        }}
        className="h-full w-full min-w-0 bg-transparent pl-7 pr-6 text-[13px] text-cc-fg placeholder:text-cc-muted focus:outline-none"
      />
      {query && (
        <button
          type="button"
          aria-label="Clear search"
          // Keeps the keyboard up: the field stays focused while the query clears.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChange("")}
          className="absolute right-0.5 flex h-6 w-6 items-center justify-center rounded text-cc-muted hover:text-cc-fg"
          data-testid="topic-search-clear"
        >
          <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M3 3l6 6M9 3L3 9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </label>
  );
}

/** Shown in place of the list when nothing matches. */
export function NoTopicMatches({ query }: { query: string }) {
  return (
    <div className="px-4 py-3 text-[13px] text-cc-muted" data-testid="topic-search-empty">
      No topics match "{query.trim()}".
    </div>
  );
}

/** Letters and digits; anything else separates words ("q-2653" is "q" and "2653"). */
const WORD_SEPARATOR = /[^\p{L}\p{N}]+/u;

function searchWords(query: string): string[] {
  return query.toLowerCase().split(WORD_SEPARATOR).filter(Boolean);
}

/** Every query word starts a word of the text, so "lean" finds "Lean" but not "cleanup". */
function matchesWords(text: string, words: readonly string[]): boolean {
  const textWords = text.toLowerCase().split(WORD_SEPARATOR);
  return words.every((word) => textWords.some((textWord) => textWord.startsWith(word)));
}
