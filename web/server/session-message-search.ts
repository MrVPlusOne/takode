import { topicThreadLabel } from "./topic-views.js";
import type { BrowserIncomingMessage, ContentBlock, StarredMessageRecord } from "./session-types.js";
import { authoritativeMessageOwner } from "./authoritative-message-owner.js";
import { isRootAgentHistoryMessage } from "./root-agent-feed-message.js";
import { isActualHumanUserMessage } from "./user-message-classification.js";
import {
  ALL_THREADS_KEY,
  MAIN_THREAD_KEY,
  buildProjectedThreadEntries,
  normalizeSelectedFeedThreadKey,
} from "../shared/thread-window.js";
import { prepareSearchQuery, type PreparedSearchQuery } from "../shared/search-utils.js";
import { buildMessageSnippet, matchMessageText, userWrittenText } from "./message-search-match.js";

export type MessageSearchScopeKind = "session" | "current_thread" | "leader_all_tabs";
export type MessageSearchCategory = "user" | "assistant" | "event";

export interface MessageSearchFilters {
  user: boolean;
  assistant: boolean;
  event: boolean;
  starredOnly?: boolean;
}

export type MessageSearchScope =
  | { kind: "session"; label: string }
  | { kind: "current_thread"; threadKey: string; label: string }
  | { kind: "leader_all_tabs"; label: string };

export interface MessageSearchResult {
  id: string;
  sessionId: string;
  sessionNum: number | null;
  messageId: string;
  historyIndex: number;
  role: "user" | "assistant" | "system";
  category: MessageSearchCategory;
  timestamp: number;
  snippet: string;
  fullText?: string;
  matchRanges?: Array<{ start: number; end: number }>;
  matchedText?: string;
  routeThreadKey?: string;
  sourceThreadKey?: string;
  sourceLabel?: string;
  questId?: string;
  starred: boolean;
}

export interface MessageSearchResponse {
  sessionId: string;
  sessionNum: number | null;
  query: string;
  scope: MessageSearchScope;
  filters: MessageSearchFilters;
  totalMatches: number;
  results: MessageSearchResult[];
  nextOffset: number | null;
  hasMore: boolean;
  tookMs: number;
}

export interface SearchSessionMessagesInput {
  sessionId: string;
  sessionNum: number | null;
  isLeaderSession: boolean;
  messageHistory: ReadonlyArray<BrowserIncomingMessage>;
  query?: string;
  scope?: MessageSearchScopeKind;
  threadKey?: string | null;
  filters?: Partial<MessageSearchFilters>;
  limit?: number;
  offset?: number;
  starredMessages?: Record<string, StarredMessageRecord>;
}

interface CandidateMessage {
  message: BrowserIncomingMessage;
  messageId: string;
  historyIndex: number;
  role: MessageSearchResult["role"];
  category: MessageSearchCategory;
  timestamp: number;
  text: string;
  sourceThreadKey: string;
  sourceLabel: string;
  routeThreadKey?: string;
  questId?: string;
}

const DEFAULT_FILTERS: MessageSearchFilters = {
  user: true,
  assistant: false,
  event: false,
};

/** Resolve one root-feed message's authoritative destination without returning history or payload text. */
export function resolveSessionMessageTarget(
  history: ReadonlyArray<BrowserIncomingMessage>,
  messageId: string,
  isLeaderSession: boolean,
): { messageId: string; threadKey: string } | null {
  const entries = buildProjectedThreadEntries(history, ALL_THREADS_KEY, { includeMessage: isRootAgentHistoryMessage });
  const matches = entries.filter((entry) => rawMessageId(entry.message, entry.history_index) === messageId);
  if (
    matches.length !== 1 ||
    (matches[0].message.type !== "assistant" && matches[0].message.type !== "markdown_report")
  )
    return null;
  return {
    messageId,
    threadKey: isLeaderSession ? authoritativeMessageOwner(matches[0].message).threadKey : MAIN_THREAD_KEY,
  };
}

export function searchSessionMessages(input: SearchSessionMessagesInput): MessageSearchResponse {
  const startedAt = Date.now();
  const query = (input.query ?? "").trim();
  const limit = clampInteger(input.limit, 20, 1, 200);
  const offset = clampInteger(input.offset, 0, 0, Number.MAX_SAFE_INTEGER);
  const filters = { ...DEFAULT_FILTERS, ...input.filters };
  const scope = resolveMessageSearchScope({
    requestedScope: input.scope,
    requestedThreadKey: input.threadKey,
    isLeaderSession: input.isLeaderSession,
    sessionNum: input.sessionNum,
  });
  const candidates = scopeCandidates(input.sessionId, input.messageHistory, scope)
    .filter((candidate) => filters[candidate.category])
    .filter((candidate) => !filters.starredOnly || Boolean(input.starredMessages?.[candidate.messageId]));

  // A query orders matches by how well they match, then newest first (see MessageMatchStrength);
  // no query lists every candidate newest first.
  const words = prepareSearchQuery(query);
  const matched: CandidateMessage[] = words
    ? candidates
        .flatMap((candidate) => {
          const match = matchMessageText(candidate.text, words);
          return match ? [{ candidate, strength: match.strength }] : [];
        })
        .sort((left, right) => left.strength - right.strength || compareNewestFirst(left.candidate, right.candidate))
        .map((match) => match.candidate)
    : [...candidates].sort(compareNewestFirst);

  const page = matched.slice(offset, offset + limit);
  const results = page.map((candidate) =>
    candidateToResult(input.sessionId, input.sessionNum, candidate, words, input.starredMessages),
  );
  const nextOffset = offset + results.length < matched.length ? offset + results.length : null;

  return {
    sessionId: input.sessionId,
    sessionNum: input.sessionNum,
    query,
    scope,
    filters,
    totalMatches: matched.length,
    results,
    nextOffset,
    hasMore: nextOffset !== null,
    tookMs: Date.now() - startedAt,
  };
}

/**
 * The user-message navigator pages through a leader thread with up to five
 * requests in a row, and projecting a leader's whole history took about 370 ms
 * per request, holding the server each time. A scope's candidates are reused
 * while the history has neither grown nor changed its last entry. Older entries
 * are occasionally edited in place (a thread handoff adds a reference), so reuse
 * is also limited to a few seconds, which covers one round of paging.
 */
const CANDIDATE_REUSE_MS = 5_000;
type CandidateCacheEntry = { length: number; tail: unknown; at: number; candidates: CandidateMessage[] };
const candidateCache = new WeakMap<ReadonlyArray<BrowserIncomingMessage>, Map<string, CandidateCacheEntry>>();

function scopeCandidates(
  sessionId: string,
  history: ReadonlyArray<BrowserIncomingMessage>,
  scope: MessageSearchScope,
): CandidateMessage[] {
  const projectionKey = scope.kind === "current_thread" ? scope.threadKey : ALL_THREADS_KEY;
  const key = `${sessionId}\u0000${scope.kind}\u0000${projectionKey}`;
  const now = Date.now();
  let byScope = candidateCache.get(history);
  const cached = byScope?.get(key);
  if (
    cached &&
    cached.length === history.length &&
    cached.tail === history.at(-1) &&
    now - cached.at < CANDIDATE_REUSE_MS
  ) {
    return cached.candidates;
  }
  const candidates = buildProjectedThreadEntries(history, projectionKey, {
    includeMessage: (message) => isRootAgentHistoryMessage(message),
  })
    .map((entry) =>
      buildCandidate({ sessionId, entryMessage: entry.message, historyIndex: entry.history_index, scope }),
    )
    .filter((candidate): candidate is CandidateMessage => candidate !== null);
  if (!byScope) {
    byScope = new Map();
    candidateCache.set(history, byScope);
  }
  byScope.set(key, { length: history.length, tail: history.at(-1), at: now, candidates });
  return candidates;
}

function resolveMessageSearchScope(input: {
  requestedScope: MessageSearchScopeKind | undefined;
  requestedThreadKey: string | null | undefined;
  isLeaderSession: boolean;
  sessionNum: number | null;
}): MessageSearchScope {
  const sessionLabel = formatSessionNumber(input.sessionNum);
  if (!input.isLeaderSession) {
    return {
      kind: "session",
      label:
        typeof input.sessionNum === "number" ? `Searching in session ${sessionLabel}` : "Searching in current session",
    };
  }
  const requestedThreadKey = normalizeSelectedFeedThreadKey(input.requestedThreadKey || MAIN_THREAD_KEY);
  if (input.requestedScope === "leader_all_tabs" || requestedThreadKey === ALL_THREADS_KEY) {
    return { kind: "leader_all_tabs", label: `Searching in ${sessionLabel} across tabs` };
  }
  const threadKey = requestedThreadKey;
  return {
    kind: "current_thread",
    threadKey,
    label:
      threadKey === MAIN_THREAD_KEY
        ? `Searching in ${sessionLabel} Main`
        : `Searching in ${sessionLabel} ${topicThreadLabel(threadKey) ?? `thread ${threadKey}`}`,
  };
}

function buildCandidate(input: {
  sessionId: string;
  entryMessage: BrowserIncomingMessage;
  historyIndex: number;
  scope: MessageSearchScope;
}): CandidateMessage | null {
  const normalized = normalizeRawMessage(input.entryMessage, input.historyIndex, input.sessionId);
  if (!normalized || !normalized.text.trim()) return null;
  const route = inferResultRoute(input.entryMessage, input.scope);
  return {
    ...normalized,
    sourceThreadKey: route.sourceThreadKey,
    sourceLabel: formatThreadSourceLabel(route.sourceThreadKey),
    routeThreadKey: route.routeThreadKey,
    ...(route.questId ? { questId: route.questId } : {}),
  };
}

function normalizeRawMessage(
  message: BrowserIncomingMessage,
  historyIndex: number,
  sessionId: string,
): Omit<CandidateMessage, "sourceThreadKey" | "sourceLabel" | "routeThreadKey" | "questId"> | null {
  if (message.type === "user_message") {
    const sourceId = message.agentSource?.sessionId;
    return {
      message,
      messageId: rawMessageId(message, historyIndex),
      historyIndex,
      role: "user",
      // Takode's own prompts (compaction recovery, leader kickoff) carry no agent source but
      // are not the user's words, so the user filter and the leader's Recent list skip them.
      category: isActualHumanUserMessage(message) || sourceId === sessionId ? "user" : "event",
      timestamp: timestampForRawMessage(message),
      // A comment on an answer is stored apart from the message text, which is often empty.
      text: userWrittenText(message.content, message.annotations),
    };
  }
  if (message.type === "leader_user_message" || message.type === "markdown_report") {
    return {
      message,
      messageId: rawMessageId(message, historyIndex),
      historyIndex,
      role: "assistant",
      category: "assistant",
      timestamp: timestampForRawMessage(message),
      text: message.content,
    };
  }
  if (message.type === "assistant") {
    return {
      message,
      messageId: rawMessageId(message, historyIndex),
      historyIndex,
      role: "assistant",
      category: "assistant",
      timestamp: timestampForRawMessage(message),
      text: textFromContentBlocks(message.message.content),
    };
  }
  const eventText = eventTextForMessage(message);
  if (!eventText) return null;
  return {
    message,
    messageId: rawMessageId(message, historyIndex),
    historyIndex,
    role: "system",
    category: "event",
    timestamp: timestampForRawMessage(message),
    text: eventText,
  };
}

function candidateToResult(
  sessionId: string,
  sessionNum: number | null,
  candidate: CandidateMessage,
  words: PreparedSearchQuery | null,
  starredMessages: Record<string, StarredMessageRecord> | undefined,
): MessageSearchResult {
  const snippetInfo = buildMessageSnippet(candidate.text, words);
  return {
    id: `${sessionId}:${candidate.historyIndex}:${candidate.messageId}`,
    sessionId,
    sessionNum,
    messageId: candidate.messageId,
    historyIndex: candidate.historyIndex,
    role: candidate.role,
    category: candidate.category,
    starred: Boolean(starredMessages?.[candidate.messageId]),
    timestamp: candidate.timestamp,
    snippet: snippetInfo.snippet,
    ...(candidate.text.length > snippetInfo.snippet.length ? { fullText: candidate.text } : {}),
    ...(snippetInfo.matchRanges.length > 0 ? { matchRanges: snippetInfo.matchRanges } : {}),
    ...(snippetInfo.matchedText ? { matchedText: snippetInfo.matchedText } : {}),
    routeThreadKey: candidate.routeThreadKey,
    sourceThreadKey: candidate.sourceThreadKey,
    sourceLabel: candidate.sourceLabel,
    ...(candidate.questId ? { questId: candidate.questId } : {}),
  };
}

function compareNewestFirst(left: CandidateMessage, right: CandidateMessage): number {
  return right.timestamp - left.timestamp || right.historyIndex - left.historyIndex;
}

function inferResultRoute(
  message: BrowserIncomingMessage,
  scope: MessageSearchScope,
): {
  sourceThreadKey: string;
  routeThreadKey?: string;
  questId?: string;
} {
  if (scope.kind === "current_thread") {
    const questId = scope.threadKey !== MAIN_THREAD_KEY ? scope.threadKey : undefined;
    return {
      sourceThreadKey: scope.threadKey,
      routeThreadKey: scope.threadKey,
      ...(questId ? { questId } : {}),
    };
  }

  if (scope.kind === "session") {
    return { sourceThreadKey: MAIN_THREAD_KEY, routeThreadKey: MAIN_THREAD_KEY };
  }

  const owner = authoritativeMessageOwner(message);
  return {
    sourceThreadKey: owner.threadKey,
    routeThreadKey: owner.threadKey,
    ...(owner.questId ? { questId: owner.questId } : {}),
  };
}

function formatSessionNumber(sessionNum: number | null): string {
  return typeof sessionNum === "number" ? `#${sessionNum}` : "current session";
}

function formatThreadSourceLabel(threadKey: string): string {
  if (threadKey === MAIN_THREAD_KEY) return "Main";
  return topicThreadLabel(threadKey) ?? `Thread ${threadKey}`;
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

function eventTextForMessage(message: BrowserIncomingMessage): string | null {
  switch (message.type) {
    case "compact_marker":
      return (
        message.summary ?? (message.markerKind === "session_recycled" ? "Session recycled" : "Conversation compacted")
      );
    case "thread_attachment_marker":
      return `Thread attachment moved ${message.count} message${message.count === 1 ? "" : "s"} to thread ${
        message.questId ?? message.threadKey
      }`;
    case "cross_thread_activity_marker":
      return message.summary ?? `${message.count} activities in thread ${message.questId ?? message.threadKey}`;
    case "permission_denied":
    case "permission_approved":
      return message.summary;
    case "task_notification":
      return message.summary ?? null;
    case "result": {
      const data = message.data as { is_error?: boolean; result?: string; errors?: string[] };
      if (data.is_error) return data.errors?.join("\n") || data.result || "Turn failed";
      return data.result ?? null;
    }
    default:
      return null;
  }
}

function rawMessageId(message: BrowserIncomingMessage, fallbackIndex: number): string {
  if ("id" in message && typeof message.id === "string") return message.id;
  if (message.type === "assistant") return message.message.id;
  return `history-${fallbackIndex}`;
}

function timestampForRawMessage(message: BrowserIncomingMessage): number {
  if ("timestamp" in message && typeof message.timestamp === "number") return message.timestamp;
  return 0;
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
