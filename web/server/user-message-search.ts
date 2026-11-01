import type { BrowserIncomingMessage } from "./session-types.js";
import type { SearchExcerpt } from "./session-store.js";
import type { SessionActivityRecord } from "./activity-stream.js";
import { authoritativeMessageOwner } from "./authoritative-message-owner.js";
import { isRootAgentHistoryMessage } from "./root-agent-feed-message.js";
import { isActualHumanUserMessage } from "./user-message-classification.js";
import { topicThreadLabel } from "./topic-views.js";
import { buildMessageSnippet, matchMessageText, userWrittenText } from "./message-search-match.js";
import { MAIN_THREAD_KEY } from "../shared/thread-window.js";
import { prepareSearchQuery, type PreparedSearchQuery } from "../shared/search-utils.js";

/**
 * One session as the search of the user's own messages reads it: its live history, or, for a
 * session archived before this server started (only its search excerpts are in memory), the
 * activity record saved when it was archived, which holds every message the user wrote in it.
 */
export interface UserMessageSearchSource {
  sessionId: string;
  sessionNum: number | null;
  sessionName: string;
  archived: boolean;
  isOrchestrator: boolean;
  history?: ReadonlyArray<BrowserIncomingMessage>;
  record?: SessionActivityRecord;
  /** An archived session's excerpts, which give its record's messages their IDs to open them by. */
  excerpts?: ReadonlyArray<SearchExcerpt>;
}

export interface UserMessageSearchResult {
  id: string;
  sessionId: string;
  sessionNum: number | null;
  sessionName: string;
  archived: boolean;
  messageId: string;
  historyIndex: number;
  role: "user";
  category: "user";
  timestamp: number;
  snippet: string;
  fullText?: string;
  matchRanges?: Array<{ start: number; end: number }>;
  matchedText?: string;
  routeThreadKey: string;
  sourceThreadKey: string;
  sourceLabel: string;
  questId?: string;
}

export interface UserMessageSearchResponse {
  query: string;
  totalMatches: number;
  results: UserMessageSearchResult[];
  nextOffset: number | null;
  hasMore: boolean;
  tookMs: number;
}

/**
 * Search the messages the user wrote, in every session given: leaders, workers and their own
 * sessions alike. Ordered like every message search: match strength, then newest first (with no
 * query, newest first). Only messages a person typed count; leader instructions, herd events and
 * Takode's own prompts are not the user's words.
 *
 * Fast on large histories because each history's messages are found once and then only extended as
 * it grows (`historyAsks`), an archived session's record is read from disk once, and a query reads
 * only the user's messages, a small part of any history, skipping those missing a query word before
 * matching words.
 */
export function searchUserMessages(input: {
  sources: ReadonlyArray<UserMessageSearchSource>;
  query?: string;
  limit?: number;
  offset?: number;
}): UserMessageSearchResponse {
  const startedAt = Date.now();
  const query = (input.query ?? "").trim();
  const limit = clampInteger(input.limit, 20, 1, 200);
  const offset = clampInteger(input.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const words = prepareSearchQuery(query);

  const candidates = input.sources.flatMap((source) => sourceAsks(source).map((ask) => ({ source, ask })));
  const matched = words
    ? candidates
        .flatMap((candidate) => {
          if (!words.every((word) => candidate.ask.lower.includes(word))) return [];
          const match = matchMessageText(candidate.ask.text, words);
          return match ? [{ candidate, strength: match.strength }] : [];
        })
        .sort((left, right) => left.strength - right.strength || compareNewestFirst(left.candidate, right.candidate))
        .map((match) => match.candidate)
    : [...candidates].sort(compareNewestFirst);

  const results = matched.slice(offset, offset + limit).map(({ source, ask }) => toResult(source, ask, words));
  const nextOffset = offset + limit < matched.length ? offset + limit : null;
  return {
    query,
    totalMatches: matched.length,
    results,
    nextOffset,
    hasMore: nextOffset !== null,
    tookMs: Date.now() - startedAt,
  };
}

/** A message the user wrote, as found once and kept for later searches. */
interface UserAsk {
  index: number;
  at: number;
  text: string;
  /** The text lowercased, to skip a message missing a query word before matching its words. */
  lower: string;
  /** Set for a record's messages; a live history's are read when shown, since a handoff can move them. */
  thread?: string;
  messageId?: string;
}

type CandidateAsk = { source: UserMessageSearchSource; ask: UserAsk };

function sourceAsks(source: UserMessageSearchSource): UserAsk[] {
  if (source.history) return historyAsks(source.history);
  return source.record ? recordAsks(source.record, source.excerpts ?? []) : [];
}

const historyAskCache = new WeakMap<
  ReadonlyArray<BrowserIncomingMessage>,
  { length: number; last: BrowserIncomingMessage | undefined; asks: UserAsk[] }
>();

/** A history's user messages, extended from where the last search left off while it only grows. */
function historyAsks(history: ReadonlyArray<BrowserIncomingMessage>): UserAsk[] {
  let cached = historyAskCache.get(history);
  if (!cached || cached.length > history.length || (cached.length > 0 && history[cached.length - 1] !== cached.last)) {
    cached = { length: 0, last: undefined, asks: [] };
    historyAskCache.set(history, cached);
  }
  for (let index = cached.length; index < history.length; index++) {
    const message = history[index]!;
    if (!isRootAgentHistoryMessage(message) || !isActualHumanUserMessage(message)) continue;
    const text = userWrittenText(message.content, message.annotations);
    if (!text.trim()) continue;
    cached.asks.push({ index, at: message.timestamp, text, lower: text.toLowerCase(), messageId: message.id });
  }
  cached.length = history.length;
  cached.last = history[history.length - 1];
  return cached.asks;
}

const recordAskCache = new WeakMap<SessionActivityRecord, UserAsk[]>();

/**
 * An archived session's user messages from its activity record. The record has no message IDs, so
 * each takes the ID of the excerpt of the same message (same time and opening text).
 */
function recordAsks(record: SessionActivityRecord, excerpts: ReadonlyArray<SearchExcerpt>): UserAsk[] {
  const cached = recordAskCache.get(record);
  if (cached) return cached;
  const excerptsAt = new Map<number, SearchExcerpt[]>();
  for (const excerpt of excerpts) {
    if (excerpt.type !== "user_message" || !excerpt.id) continue;
    excerptsAt.set(excerpt.timestamp, [...(excerptsAt.get(excerpt.timestamp) ?? []), excerpt]);
  }
  const asks = record.asks.flatMap((entry): UserAsk[] => {
    if (!entry.text.trim()) return [];
    const sameTime = excerptsAt.get(entry.at) ?? [];
    const excerpt =
      sameTime.length === 1 ? sameTime[0] : sameTime.find((candidate) => entry.text.startsWith(candidate.content));
    return [
      {
        index: entry.index,
        at: entry.at,
        text: entry.text,
        lower: entry.text.toLowerCase(),
        thread: entry.thread,
        messageId: excerpt?.id,
      },
    ];
  });
  recordAskCache.set(record, asks);
  return asks;
}

function toResult(
  source: UserMessageSearchSource,
  ask: UserAsk,
  words: PreparedSearchQuery | null,
): UserMessageSearchResult {
  const message = source.history?.[ask.index];
  const threadKey =
    ask.thread ?? (source.isOrchestrator && message ? authoritativeMessageOwner(message).threadKey : MAIN_THREAD_KEY);
  const snippet = buildMessageSnippet(ask.text, words);
  const messageId = ask.messageId ?? `history-${ask.index}`;
  return {
    id: `${source.sessionId}:${ask.index}:${messageId}`,
    sessionId: source.sessionId,
    sessionNum: source.sessionNum,
    sessionName: source.sessionName,
    archived: source.archived,
    messageId,
    historyIndex: ask.index,
    role: "user",
    category: "user",
    timestamp: ask.at,
    snippet: snippet.snippet,
    ...(ask.text.length > snippet.snippet.length ? { fullText: ask.text } : {}),
    ...(snippet.matchRanges.length > 0 ? { matchRanges: snippet.matchRanges } : {}),
    ...(snippet.matchedText ? { matchedText: snippet.matchedText } : {}),
    routeThreadKey: threadKey,
    sourceThreadKey: threadKey,
    sourceLabel: threadKey === MAIN_THREAD_KEY ? "Main" : (topicThreadLabel(threadKey) ?? threadKey),
    ...(/^q-\d+$/.test(threadKey) ? { questId: threadKey } : {}),
  };
}

function compareNewestFirst(left: CandidateAsk, right: CandidateAsk): number {
  return right.ask.at - left.ask.at || right.ask.index - left.ask.index;
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
