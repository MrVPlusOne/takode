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
import { isRootAgentHistoryMessage } from "./root-agent-feed-message.js";

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
  const candidates: StarredCandidate[] = [];
  const unresolved: StarredMessageRecord[] = [];

  for (const record of starredEntries) {
    if (!record.messageId || (record.role !== "user" && record.role !== "assistant")) continue;
    const indexedMessage = history[record.historyIndex];
    if (
      indexedMessage &&
      rawMessageId(indexedMessage) === record.messageId &&
      !isRootAgentHistoryMessage(indexedMessage)
    ) {
      continue;
    }
    const indexedText = textForStableStarRecord(indexedMessage, record);
    if (addCandidateIfText(candidates, doc, record, indexedText)) continue;
    unresolved.push(record);
  }

  const unresolvedAfterHistory =
    unresolved.length > 0 && history.length > 0
      ? resolveFromHistoryByStarIds(history, unresolved, doc, candidates)
      : unresolved;
  if (unresolvedAfterHistory.length > 0) {
    resolveFromExcerptsByStarIds(doc.searchExcerpts ?? [], unresolvedAfterHistory, doc, candidates);
  }

  return candidates;
}

function addCandidateIfText(
  candidates: StarredCandidate[],
  doc: GlobalStarredMessageSearchDocument,
  record: StarredMessageRecord,
  text: string | null | undefined,
): boolean {
  if (!text?.trim()) return false;
  candidates.push({ doc, record, text });
  return true;
}

function resolveFromHistoryByStarIds(
  history: ReadonlyArray<BrowserIncomingMessage>,
  records: StarredMessageRecord[],
  doc: GlobalStarredMessageSearchDocument,
  candidates: StarredCandidate[],
): StarredMessageRecord[] {
  const unresolvedById = recordsByMessageId(records);
  for (let index = 0; index < history.length && unresolvedById.size > 0; index++) {
    const message = history[index];
    const id = rawMessageId(message);
    if (!id) continue;
    const matches = unresolvedById.get(id);
    if (!matches) continue;
    if (isRootAgentHistoryMessage(message)) {
      for (const record of matches) {
        addCandidateIfText(candidates, doc, record, textForStableStarRecord(message, record));
      }
    }
    unresolvedById.delete(id);
  }
  return [...unresolvedById.values()].flat();
}

function resolveFromExcerptsByStarIds(
  excerpts: SearchExcerpt[],
  records: StarredMessageRecord[],
  doc: GlobalStarredMessageSearchDocument,
  candidates: StarredCandidate[],
): void {
  const unresolvedById = recordsByMessageId(records);
  for (let index = 0; index < excerpts.length && unresolvedById.size > 0; index++) {
    const excerpt = excerpts[index];
    if (!excerpt.id) continue;
    const matches = unresolvedById.get(excerpt.id);
    if (!matches) continue;
    for (const record of matches) {
      addCandidateIfText(candidates, doc, record, textForExcerptRecord(excerpt, record));
    }
    unresolvedById.delete(excerpt.id);
  }
}

function recordsByMessageId(records: StarredMessageRecord[]): Map<string, StarredMessageRecord[]> {
  const byId = new Map<string, StarredMessageRecord[]>();
  for (const record of records) {
    const existing = byId.get(record.messageId);
    if (existing) {
      existing.push(record);
    } else {
      byId.set(record.messageId, [record]);
    }
  }
  return byId;
}

function textForExcerptRecord(excerpt: SearchExcerpt, record: StarredMessageRecord): string | null {
  if (record.role === "user" && excerpt.type !== "user_message") return null;
  if (record.role === "assistant" && excerpt.type !== "assistant") return null;
  return excerpt.content;
}

function textForStableStarRecord(
  message: BrowserIncomingMessage | undefined,
  record: StarredMessageRecord,
): string | null {
  if (!message || !isRootAgentHistoryMessage(message)) return null;
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
