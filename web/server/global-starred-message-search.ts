import type { BrowserIncomingMessage, ContentBlock, StarredMessageRecord } from "./session-types.js";
import type { SearchExcerpt } from "./session-store.js";
import {
  compareSearchRanks,
  prepareSearchQuery,
  rankSearchFields,
  tokenizeSearchText,
  type SearchRank,
} from "../shared/search-utils.js";
import { MAIN_THREAD_KEY, normalizeSelectedFeedThreadKey } from "../shared/thread-window.js";

export interface GlobalStarredMessageSearchDocument {
  sessionId: string;
  sessionNum: number | null;
  state?: "starting" | "connected" | "running" | "exited";
  name?: string;
  archived: boolean;
  archivedAt?: number;
  reviewerOf?: number;
  starredMessages?: Record<string, StarredMessageRecord>;
  messageHistory?: ReadonlyArray<BrowserIncomingMessage>;
  searchExcerpts?: SearchExcerpt[];
}

export interface GlobalStarredMessageSearchResult {
  id: string;
  sessionId: string;
  sessionNum: number | null;
  sessionName?: string;
  sessionState?: "starting" | "connected" | "running" | "exited";
  archived: boolean;
  archivedAt?: number;
  reviewerOf?: number;
  messageId: string;
  historyIndex: number;
  role: "user" | "assistant";
  category: "user" | "assistant";
  timestamp: number;
  starred: true;
  starredAt: number;
  snippet: string;
  fullText?: string;
  matchRanges?: Array<{ start: number; end: number }>;
  matchedText?: string;
  routeThreadKey: string;
  sourceThreadKey: string;
  sourceLabel: string;
  questId?: string;
}

export interface GlobalStarredMessageSearchResponse {
  query: string;
  totalMatches: number;
  results: GlobalStarredMessageSearchResult[];
  nextOffset: number | null;
  hasMore: boolean;
  tookMs: number;
}

export interface SearchGlobalStarredMessagesInput {
  docs: GlobalStarredMessageSearchDocument[];
  query?: string;
  limit?: number;
  offset?: number;
}

interface StarredCandidate {
  doc: GlobalStarredMessageSearchDocument;
  record: StarredMessageRecord;
  text: string;
}

export function searchGlobalStarredMessages(
  input: SearchGlobalStarredMessagesInput,
): GlobalStarredMessageSearchResponse {
  const startedAt = Date.now();
  const query = (input.query ?? "").trim();
  const limit = clampInteger(input.limit, 20, 1, 200);
  const offset = clampInteger(input.offset, 0, 0, Number.MAX_SAFE_INTEGER);

  const candidates = input.docs.flatMap((doc) => collectStarredCandidates(doc));
  const matched: StarredCandidate[] = query
    ? candidates
        .map((candidate) => ({ candidate, rank: rankSearchFields([{ rank: 0, text: candidate.text }], query) }))
        .filter((match): match is { candidate: StarredCandidate; rank: SearchRank } => match.rank !== null)
        .sort(compareRankedCandidates)
        .map((match) => match.candidate)
    : [...candidates].sort(compareStarredRecency);

  const page = matched.slice(offset, offset + limit);
  const results = page.map((candidate) => candidateToResult(candidate, query));
  const nextOffset = offset + results.length < matched.length ? offset + results.length : null;

  return {
    query,
    totalMatches: matched.length,
    results,
    nextOffset,
    hasMore: nextOffset !== null,
    tookMs: Date.now() - startedAt,
  };
}

function collectStarredCandidates(doc: GlobalStarredMessageSearchDocument): StarredCandidate[] {
  const starredEntries = Object.values(doc.starredMessages ?? {});
  if (starredEntries.length === 0) return [];
  const history = doc.messageHistory ?? [];
  const excerptById = buildExcerptById(doc.searchExcerpts ?? []);
  const historyById = history.length > 0 ? buildHistoryById(history) : null;

  const candidates: StarredCandidate[] = [];
  for (const record of starredEntries) {
    if (!record.messageId || (record.role !== "user" && record.role !== "assistant")) continue;
    const text = resolveStarredText({ record, history, historyById, excerptById });
    if (!text.trim()) continue;
    candidates.push({ doc, record, text });
  }
  return candidates;
}

function resolveStarredText(input: {
  record: StarredMessageRecord;
  history: ReadonlyArray<BrowserIncomingMessage>;
  historyById: Map<string, BrowserIncomingMessage> | null;
  excerptById: Map<string, SearchExcerpt>;
}): string {
  const indexed = input.history[input.record.historyIndex];
  const indexedText = textForStableStarRecord(indexed, input.record);
  if (indexedText) return indexedText;

  const byId = input.historyById?.get(input.record.messageId);
  const byIdText = textForStableStarRecord(byId, input.record);
  if (byIdText) return byIdText;

  const excerpt = input.excerptById.get(input.record.messageId);
  if (!excerpt) return "";
  if (input.record.role === "user" && excerpt.type !== "user_message") return "";
  if (input.record.role === "assistant" && excerpt.type !== "assistant") return "";
  return excerpt.content;
}

function textForStableStarRecord(
  message: BrowserIncomingMessage | undefined,
  record: StarredMessageRecord,
): string | null {
  if (!message) return null;
  if (message.type === "user_message") {
    return record.role === "user" && message.id === record.messageId ? message.content : null;
  }
  if (message.type === "leader_user_message") {
    return record.role === "assistant" && message.id === record.messageId ? message.content : null;
  }
  if (message.type === "assistant") {
    return record.role === "assistant" && message.message.id === record.messageId
      ? textFromContentBlocks(message.message.content)
      : null;
  }
  return null;
}

function candidateToResult(candidate: StarredCandidate, query: string): GlobalStarredMessageSearchResult {
  const { doc, record } = candidate;
  const snippetInfo = buildSnippet(candidate.text, query);
  const sourceThreadKey = normalizeStarredThreadKey(record.sourceThreadKey);
  const routeThreadKey = normalizeStarredThreadKey(record.routeThreadKey || record.sourceThreadKey);
  return {
    id: `${doc.sessionId}:${record.historyIndex}:${record.messageId}`,
    sessionId: doc.sessionId,
    sessionNum: doc.sessionNum,
    ...(doc.name ? { sessionName: doc.name } : {}),
    ...(doc.state ? { sessionState: doc.state } : {}),
    archived: doc.archived,
    ...(typeof doc.archivedAt === "number" ? { archivedAt: doc.archivedAt } : {}),
    ...(typeof doc.reviewerOf === "number" ? { reviewerOf: doc.reviewerOf } : {}),
    messageId: record.messageId,
    historyIndex: record.historyIndex,
    role: record.role,
    category: record.role,
    timestamp: record.timestamp,
    starred: true,
    starredAt: record.starredAt,
    snippet: snippetInfo.snippet,
    ...(candidate.text.length > snippetInfo.snippet.length ? { fullText: candidate.text } : {}),
    ...(snippetInfo.matchRanges.length > 0 ? { matchRanges: snippetInfo.matchRanges } : {}),
    ...(snippetInfo.matchedText ? { matchedText: snippetInfo.matchedText } : {}),
    routeThreadKey,
    sourceThreadKey,
    sourceLabel: formatThreadSourceLabel(sourceThreadKey),
    ...(record.questId ? { questId: record.questId } : {}),
  };
}

function compareRankedCandidates(
  left: { candidate: StarredCandidate; rank: SearchRank },
  right: { candidate: StarredCandidate; rank: SearchRank },
): number {
  return compareSearchRanks(left.rank, right.rank) || compareStarredRecency(left.candidate, right.candidate);
}

function compareStarredRecency(left: StarredCandidate, right: StarredCandidate): number {
  return (
    right.record.starredAt - left.record.starredAt ||
    right.record.timestamp - left.record.timestamp ||
    right.record.historyIndex - left.record.historyIndex
  );
}

function buildHistoryById(history: ReadonlyArray<BrowserIncomingMessage>): Map<string, BrowserIncomingMessage> {
  const byId = new Map<string, BrowserIncomingMessage>();
  for (const message of history) {
    const id = rawMessageId(message);
    if (id) byId.set(id, message);
  }
  return byId;
}

function buildExcerptById(excerpts: SearchExcerpt[]): Map<string, SearchExcerpt> {
  const byId = new Map<string, SearchExcerpt>();
  for (const excerpt of excerpts) {
    if (excerpt.id) byId.set(excerpt.id, excerpt);
  }
  return byId;
}

function rawMessageId(message: BrowserIncomingMessage): string | null {
  if ("id" in message && typeof message.id === "string") return message.id;
  if (message.type === "assistant") return message.message.id;
  return null;
}

function normalizeStarredThreadKey(value: string | undefined): string {
  if (!value) return MAIN_THREAD_KEY;
  return normalizeSelectedFeedThreadKey(value) || MAIN_THREAD_KEY;
}

function formatThreadSourceLabel(threadKey: string): string {
  return threadKey === MAIN_THREAD_KEY ? "Main" : `Thread ${threadKey}`;
}

function buildSnippet(
  text: string,
  query: string,
): {
  snippet: string;
  matchRanges: Array<{ start: number; end: number }>;
  matchedText?: string;
} {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (!query.trim()) return { snippet: truncateSnippet(collapsed), matchRanges: [] };

  const queryTokens = prepareSearchQuery(query) ?? [];
  const haystackTokens = tokenizeSearchText(collapsed);
  const firstMatch = haystackTokens.find((token) =>
    queryTokens.some((queryToken) => token.value === queryToken || token.value.startsWith(queryToken)),
  );
  if (!firstMatch) return { snippet: truncateSnippet(collapsed), matchRanges: [] };

  const desiredContext = 70;
  const start = Math.max(0, firstMatch.start - desiredContext);
  const end = Math.min(collapsed.length, firstMatch.end + desiredContext);
  const snippetStart = start > 0 ? nextWordBoundary(collapsed, start) : 0;
  const snippetEnd = end < collapsed.length ? previousWordBoundary(collapsed, end) : collapsed.length;
  const prefix = snippetStart > 0 ? "..." : "";
  const suffix = snippetEnd < collapsed.length ? "..." : "";
  const body = collapsed.slice(snippetStart, snippetEnd).trim();
  const snippet = `${prefix}${body}${suffix}`;
  const bodyOffset = prefix.length - snippetStart;
  const matchRanges = haystackTokens
    .filter((token) => token.start >= snippetStart && token.end <= snippetEnd)
    .filter((token) =>
      queryTokens.some((queryToken) => token.value === queryToken || token.value.startsWith(queryToken)),
    )
    .map((token) => ({ start: token.start + bodyOffset, end: token.end + bodyOffset }));
  return {
    snippet,
    matchRanges,
    matchedText: collapsed.slice(firstMatch.start, firstMatch.end),
  };
}

function truncateSnippet(text: string, limit = 180): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1).trimEnd()}...`;
}

function nextWordBoundary(text: string, index: number): number {
  const nextSpace = text.indexOf(" ", index);
  return nextSpace === -1 ? index : nextSpace + 1;
}

function previousWordBoundary(text: string, index: number): number {
  const previousSpace = text.lastIndexOf(" ", index);
  return previousSpace === -1 ? index : previousSpace;
}

function textFromContentBlocks(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => {
      if (block.type === "text") return block.text;
      if (block.type === "thinking") return block.thinking;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
