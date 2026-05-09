import type { QuestmasterTask } from "./quest-types.js";
import { hasQuestReviewMetadata, isQuestReviewInboxUnread } from "./quest-types.js";
import { prepareSearchQuery, type PreparedSearchQuery, tokenizeSearchText } from "../shared/search-utils.js";
import { questRelationshipSearchText } from "./quest-relationships.js";

export interface QuestListFilterOptions {
  status?: string;
  tags?: string;
  tag?: string;
  excludeTags?: string;
  session?: string;
  text?: string;
  verification?: string;
}

export type QuestListSortColumn =
  | "cards"
  | "quest"
  | "title"
  | "owner"
  | "leader"
  | "status"
  | "verify"
  | "feedback"
  | "updated";
export type QuestListSortDirection = "asc" | "desc";

export interface QuestListPageOptions extends QuestListFilterOptions {
  offset?: number;
  limit?: number;
  sortColumn?: QuestListSortColumn;
  sortDirection?: QuestListSortDirection;
}

export interface QuestListPageResult {
  quests: QuestmasterTask[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
  nextOffset: number | null;
  previousOffset: number | null;
  counts: Record<QuestStatusOrAll, number>;
  allTags: string[];
}

type QuestStatusOrAll = QuestmasterTask["status"] | "all";
type QuestListEntry = { quest: QuestmasterTask; searchDocument?: QuestSearchDocument; matchesText?: boolean };
type QuestSearchDocument = {
  termFrequency: Map<string, number>;
  tokenCount: number;
  recencyTs: number;
};
type RankedQuestSearchEntry = {
  quest: QuestmasterTask;
  textScore: number;
  finalScore: number;
};

type QuestListFilterResult = {
  beforeStatusFilter: QuestmasterTask[];
  filtered: QuestmasterTask[];
  filteredEntries: QuestListEntry[];
  searchCorpusEntries: QuestListEntry[];
};

type ParsedQuestListFilters = {
  statuses: Set<string>;
  wantsReviewStatusAlias: boolean;
  tagTokens: Set<string>;
  excludedTagTokens: Set<string>;
  verificationScopes: Set<string>;
  sessionId: string;
  hasTextQuery: boolean;
  preparedSearchQuery: PreparedSearchQuery | null;
};

const STATUS_DISPLAY_ORDER: Record<QuestmasterTask["status"], number> = {
  in_progress: 0,
  refined: 1,
  idea: 2,
  done: 3,
};

const STATUS_SORT_RANK: Record<QuestmasterTask["status"], number> = {
  idea: 0,
  refined: 1,
  in_progress: 2,
  done: 3,
};
const MAX_PAGE_LIMIT = 150;
const TEXT_SEARCH_YIELD_INTERVAL = 25;
const PRIMARY_FIELD_DUPLICATION = 2;
const BODY_FIELD_DUPLICATION = 1;
const BM25_K1 = 1.2;
const BM25_B = 0.75;
const QUEST_SEARCH_RECENCY_SHARE = 0.2;

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function applyQuestListFilters(quests: QuestmasterTask[], filters: QuestListFilterOptions): QuestmasterTask[] {
  return filterQuestList(quests, filters).filtered;
}

export function getQuestListPage(quests: QuestmasterTask[], options: QuestListPageOptions): QuestListPageResult {
  const result = filterQuestList(quests, options);
  return buildQuestListPage(
    quests,
    options,
    result.beforeStatusFilter,
    result.filteredEntries,
    result.searchCorpusEntries,
  );
}

export async function getQuestListPageAsync(
  quests: QuestmasterTask[],
  options: QuestListPageOptions,
): Promise<QuestListPageResult> {
  const hasTextQuery = (options.text ?? "").trim().length > 0;
  if (!hasTextQuery) return getQuestListPage(quests, options);
  const result = await filterQuestListAsync(quests, options);
  return buildQuestListPage(
    quests,
    options,
    result.beforeStatusFilter,
    result.filteredEntries,
    result.searchCorpusEntries,
  );
}

function buildQuestListPage(
  quests: QuestmasterTask[],
  options: QuestListPageOptions,
  beforeStatusFilter: QuestmasterTask[],
  filteredEntries: QuestListEntry[],
  searchCorpusEntries: QuestListEntry[],
): QuestListPageResult {
  const sorted = sortQuestList(filteredEntries, options, searchCorpusEntries);
  const limit = normalizeLimit(options.limit);
  const offset = normalizeOffset(options.offset, sorted.length);
  const pageQuests = sorted.slice(offset, offset + limit);
  const nextOffset = offset + limit < sorted.length ? offset + limit : null;
  const previousOffset = offset > 0 ? Math.max(0, offset - limit) : null;

  return {
    quests: pageQuests,
    total: sorted.length,
    offset,
    limit,
    hasMore: nextOffset !== null,
    nextOffset,
    previousOffset,
    counts: countByStatus(beforeStatusFilter),
    allTags: listAllTags(quests),
  };
}

function filterQuestList(quests: QuestmasterTask[], filters: QuestListFilterOptions): QuestListFilterResult {
  const parsed = parseQuestListFilters(filters);
  if (parsed.hasTextQuery && !parsed.preparedSearchQuery) return finishQuestListFilter(parsed, []);

  const beforeStatusEntries: QuestListEntry[] = [];
  for (const quest of quests) {
    const entry = buildQuestListEntry(quest, parsed);
    if (entry) beforeStatusEntries.push(entry);
  }

  return finishQuestListFilter(parsed, beforeStatusEntries);
}

async function filterQuestListAsync(
  quests: QuestmasterTask[],
  filters: QuestListFilterOptions,
): Promise<QuestListFilterResult> {
  const parsed = parseQuestListFilters(filters);
  if (parsed.hasTextQuery && !parsed.preparedSearchQuery) return finishQuestListFilter(parsed, []);

  const beforeStatusEntries: QuestListEntry[] = [];
  for (const [index, quest] of quests.entries()) {
    if (index > 0 && index % TEXT_SEARCH_YIELD_INTERVAL === 0) await yieldToEventLoop();
    const entry = buildQuestListEntry(quest, parsed);
    if (entry) beforeStatusEntries.push(entry);
  }

  return finishQuestListFilter(parsed, beforeStatusEntries);
}

function parseQuestListFilters(filters: QuestListFilterOptions): ParsedQuestListFilters {
  const requestedStatuses = parseCsv(filters.status);
  const statuses = new Set(requestedStatuses.filter((status) => status !== "needs_verification"));
  const wantsReviewStatusAlias = requestedStatuses.includes("needs_verification");
  const tagTokens = new Set([...parseCsv(filters.tags), ...parseCsv(filters.tag)].map((tag) => tag.toLowerCase()));
  const excludedTagTokens = new Set(parseCsv(filters.excludeTags).map((tag) => tag.toLowerCase()));
  const verificationScopes = new Set(parseCsv(filters.verification).map((scope) => scope.toLowerCase()));
  const sessionId = filters.session?.trim() || "";
  const textQuery = (filters.text ?? "").trim();
  const hasTextQuery = textQuery.length > 0;
  const preparedSearchQuery = hasTextQuery ? prepareSearchQuery(textQuery) : null;

  return {
    statuses,
    wantsReviewStatusAlias,
    tagTokens,
    excludedTagTokens,
    verificationScopes,
    sessionId,
    hasTextQuery,
    preparedSearchQuery,
  };
}

function buildQuestListEntry(quest: QuestmasterTask, filters: ParsedQuestListFilters): QuestListEntry | null {
  if (!matchesVerificationFilter(quest, filters.verificationScopes)) return null;
  if (!matchesTagFilters(quest, filters.tagTokens, filters.excludedTagTokens)) return null;
  if (!matchesSessionFilter(quest, filters.sessionId)) return null;

  if (!filters.hasTextQuery) return { quest };
  if (!filters.preparedSearchQuery) return null;
  const searchDocument = buildQuestSearchDocument(quest);
  return { quest, searchDocument, matchesText: matchesAllQueryTokens(searchDocument, filters.preparedSearchQuery) };
}

function finishQuestListFilter(
  filters: ParsedQuestListFilters,
  beforeStatusEntries: QuestListEntry[],
): QuestListFilterResult {
  const textFilteredEntries = filters.hasTextQuery
    ? beforeStatusEntries.filter((entry) => entry.matchesText === true)
    : beforeStatusEntries;
  const matchesStatus = (entry: QuestListEntry) =>
    filters.statuses.has(entry.quest.status) || (filters.wantsReviewStatusAlias && hasQuestReviewMetadata(entry.quest));
  const filteredEntries =
    filters.statuses.size > 0 || filters.wantsReviewStatusAlias
      ? textFilteredEntries.filter(matchesStatus)
      : textFilteredEntries;
  const searchCorpusEntries =
    filters.hasTextQuery && (filters.statuses.size > 0 || filters.wantsReviewStatusAlias)
      ? beforeStatusEntries.filter(matchesStatus)
      : beforeStatusEntries;
  return {
    beforeStatusFilter: textFilteredEntries.map((entry) => entry.quest),
    filtered: filteredEntries.map((entry) => entry.quest),
    filteredEntries,
    searchCorpusEntries,
  };
}

function matchesVerificationFilter(quest: QuestmasterTask, verificationScopes: Set<string>): boolean {
  if (verificationScopes.size === 0) return true;
  const isReview = hasQuestReviewMetadata(quest);
  const inInbox = isQuestReviewInboxUnread(quest);
  const wantsAnyVerification =
    verificationScopes.has("all") ||
    verificationScopes.has("verification") ||
    verificationScopes.has("needs_verification");
  const wantsInbox =
    verificationScopes.has("inbox") || verificationScopes.has("unread") || verificationScopes.has("new");
  const wantsReviewed =
    verificationScopes.has("reviewed") ||
    verificationScopes.has("non-inbox") ||
    verificationScopes.has("non_inbox") ||
    verificationScopes.has("read") ||
    verificationScopes.has("acknowledged");

  if (wantsAnyVerification && isReview) return true;
  if (wantsInbox && inInbox) return true;
  return wantsReviewed && isReview && !inInbox;
}

function matchesTagFilters(quest: QuestmasterTask, tagTokens: Set<string>, excludedTagTokens: Set<string>): boolean {
  if (tagTokens.size === 0 && excludedTagTokens.size === 0) return true;
  const questTags = new Set((quest.tags || []).map((tag) => tag.toLowerCase()));

  if (tagTokens.size > 0) {
    let hasAnyTag = false;
    for (const tag of tagTokens) {
      if (!questTags.has(tag)) continue;
      hasAnyTag = true;
      break;
    }
    if (!hasAnyTag) return false;
  }

  for (const tag of excludedTagTokens) {
    if (questTags.has(tag)) return false;
  }
  return true;
}

function matchesSessionFilter(quest: QuestmasterTask, sessionId: string): boolean {
  if (!sessionId) return true;
  const owner = "sessionId" in quest ? (quest as { sessionId?: string }).sessionId : undefined;
  const previousOwners = Array.isArray(quest.previousOwnerSessionIds) ? quest.previousOwnerSessionIds : [];
  return owner === sessionId || previousOwners.includes(sessionId);
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function sortQuestList(
  entries: QuestListEntry[],
  options: QuestListPageOptions,
  searchCorpusEntries: QuestListEntry[],
): QuestmasterTask[] {
  const textQuery = (options.text ?? "").trim();
  if (textQuery) {
    const query = prepareSearchQuery(textQuery);
    if (!query) return [];
    return rankQuestSearchEntries(entries, searchCorpusEntries, query).map((entry) => entry.quest);
  }

  const column = options.sortColumn ?? "cards";
  const direction = options.sortDirection ?? (column === "cards" ? "asc" : "desc");
  return entries
    .map((entry) => entry.quest)
    .sort((left, right) => {
      const columnResult = compareSortColumn(left, right, column);
      const directed = direction === "asc" ? columnResult : -columnResult;
      if (directed !== 0) return directed;
      return questRecencyTs(right) - questRecencyTs(left) || compareQuestIds(left, right);
    });
}

function compareSortColumn(left: QuestmasterTask, right: QuestmasterTask, column: QuestListSortColumn): number {
  switch (column) {
    case "cards": {
      const statusResult = STATUS_DISPLAY_ORDER[left.status] - STATUS_DISPLAY_ORDER[right.status];
      if (statusResult !== 0) return statusResult;
      return questRecencyTs(right) - questRecencyTs(left);
    }
    case "quest":
      return compareQuestIds(left, right);
    case "title":
      return compareText(left.title, right.title);
    case "owner":
      return compareText(getQuestOwnerSessionId(left) ?? "", getQuestOwnerSessionId(right) ?? "");
    case "leader":
      return compareText(left.leaderSessionId ?? "", right.leaderSessionId ?? "");
    case "status":
      return STATUS_SORT_RANK[left.status] - STATUS_SORT_RANK[right.status];
    case "verify":
      return compareNumberTuple(verificationSortTuple(left), verificationSortTuple(right));
    case "feedback":
      return compareNumberTuple(feedbackSortTuple(left), feedbackSortTuple(right));
    case "updated":
      return questRecencyTs(left) - questRecencyTs(right);
  }
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return 50;
  return Math.min(MAX_PAGE_LIMIT, Math.max(1, Math.trunc(limit)));
}

function normalizeOffset(offset: number | undefined, total: number): number {
  if (offset === undefined || !Number.isFinite(offset)) return 0;
  const normalized = Math.max(0, Math.trunc(offset));
  return Math.min(normalized, Math.max(0, total));
}

function countByStatus(quests: QuestmasterTask[]): Record<QuestStatusOrAll, number> {
  const counts: Record<QuestStatusOrAll, number> = { all: quests.length, idea: 0, refined: 0, in_progress: 0, done: 0 };
  for (const quest of quests) counts[quest.status] += 1;
  return counts;
}

function listAllTags(quests: QuestmasterTask[]): string[] {
  const tags = new Set<string>();
  for (const quest of quests) {
    for (const tag of quest.tags ?? []) tags.add(tag.toLowerCase());
  }
  return Array.from(tags).sort((a, b) => a.localeCompare(b));
}

function rankQuestSearchEntries(
  entries: QuestListEntry[],
  searchCorpusEntries: QuestListEntry[],
  query: PreparedSearchQuery,
): RankedQuestSearchEntry[] {
  const searchEntries = entries.filter(
    (entry): entry is { quest: QuestmasterTask; searchDocument: QuestSearchDocument } =>
      entry.searchDocument !== undefined,
  );
  if (searchEntries.length === 0) return [];

  const corpusEntries = searchCorpusEntries.filter(
    (entry): entry is { quest: QuestmasterTask; searchDocument: QuestSearchDocument } =>
      entry.searchDocument !== undefined,
  );
  const scoringCorpus = corpusEntries.length > 0 ? corpusEntries : searchEntries;
  const documentCount = scoringCorpus.length;
  const averageDocumentLength =
    scoringCorpus.reduce((sum, entry) => sum + entry.searchDocument.tokenCount, 0) / documentCount || 1;
  const queryStats = query.map((word) => ({
    word,
    idf: bm25InverseDocumentFrequency(
      documentCount,
      scoringCorpus.filter((entry) => matchingTermFrequency(entry.searchDocument, word) > 0).length,
    ),
  }));

  const textRanked = searchEntries.map((entry) => ({
    quest: entry.quest,
    searchDocument: entry.searchDocument,
    textScore: bm25DocumentScore(entry.searchDocument, queryStats, averageDocumentLength),
  }));
  const maxTextScore = Math.max(...textRanked.map((entry) => entry.textScore), 0);
  const now = Date.now();
  const recencies = textRanked.map((entry) => normalizedRecencyTs(entry.searchDocument, now));
  const minRecency = Math.min(...recencies);
  const maxRecency = Math.max(...recencies);

  return textRanked
    .map((entry) => {
      const freshness = freshnessScore(normalizedRecencyTs(entry.searchDocument, now), minRecency, maxRecency);
      return {
        quest: entry.quest,
        textScore: entry.textScore,
        finalScore: entry.textScore + QUEST_SEARCH_RECENCY_SHARE * maxTextScore * freshness,
      };
    })
    .sort(compareRankedQuestSearchEntries);
}

function buildQuestSearchDocument(quest: QuestmasterTask): QuestSearchDocument {
  const tokens = [
    ...questSearchTokens(getQuestPrimarySearchFields(quest), PRIMARY_FIELD_DUPLICATION),
    ...questSearchTokens(getQuestBodySearchFields(quest), BODY_FIELD_DUPLICATION),
  ];
  const termFrequency = new Map<string, number>();
  for (const token of tokens) termFrequency.set(token, (termFrequency.get(token) ?? 0) + 1);
  return {
    termFrequency,
    tokenCount: Math.max(1, tokens.length),
    recencyTs: questRecencyTs(quest),
  };
}

function getQuestPrimarySearchFields(quest: QuestmasterTask): Array<string | undefined> {
  return [quest.questId, quest.title, (quest.tags ?? []).join(" ")];
}

function getQuestBodySearchFields(quest: QuestmasterTask): Array<string | undefined> {
  return [
    quest.tldr,
    "description" in quest ? quest.description : undefined,
    questRelationshipSearchText(quest),
    quest.status === "done" && quest.cancelled !== true ? quest.debriefTldr : undefined,
    quest.status === "done" && quest.cancelled !== true ? quest.debrief : undefined,
    ...("feedback" in quest ? (quest.feedback ?? []).flatMap((entry) => [entry.tldr, entry.text]) : []),
  ];
}

function questSearchTokens(fields: Array<string | undefined>, duplication: number): string[] {
  const tokens: string[] = [];
  for (const field of fields) {
    if (!field) continue;
    const fieldTokens = tokenizeSearchText(field).map((token) => token.value);
    for (let count = 0; count < duplication; count += 1) tokens.push(...fieldTokens);
  }
  return tokens;
}

function matchesAllQueryTokens(document: QuestSearchDocument, query: PreparedSearchQuery): boolean {
  return query.every((word) => matchingTermFrequency(document, word) > 0);
}

function bm25InverseDocumentFrequency(documentCount: number, documentFrequency: number): number {
  return Math.log(1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5));
}

function bm25DocumentScore(
  document: QuestSearchDocument,
  queryStats: Array<{ word: string; idf: number }>,
  averageDocumentLength: number,
): number {
  return queryStats.reduce((score, query) => {
    const frequency = matchingTermFrequency(document, query.word);
    if (frequency <= 0) return score;
    const lengthRatio = document.tokenCount / averageDocumentLength;
    const denominator = frequency + BM25_K1 * (1 - BM25_B + BM25_B * lengthRatio);
    return score + query.idf * ((frequency * (BM25_K1 + 1)) / denominator);
  }, 0);
}

function matchingTermFrequency(document: QuestSearchDocument, word: string): number {
  const exactFrequency = document.termFrequency.get(word);
  if (exactFrequency !== undefined) return exactFrequency;

  let bestPrefixFrequency = 0;
  for (const [term, frequency] of document.termFrequency) {
    if (term.startsWith(word)) bestPrefixFrequency = Math.max(bestPrefixFrequency, frequency);
  }
  return bestPrefixFrequency;
}

function normalizedRecencyTs(document: QuestSearchDocument, now: number): number {
  return Math.min(document.recencyTs, now);
}

function freshnessScore(recencyTs: number, minRecency: number, maxRecency: number): number {
  const range = maxRecency - minRecency;
  if (range <= 0) return 0;
  return (recencyTs - minRecency) / range;
}

function compareRankedQuestSearchEntries(left: RankedQuestSearchEntry, right: RankedQuestSearchEntry): number {
  return (
    right.finalScore - left.finalScore ||
    right.textScore - left.textScore ||
    questRecencyTs(right.quest) - questRecencyTs(left.quest) ||
    compareQuestIds(left.quest, right.quest)
  );
}

function compareQuestIds(left: QuestmasterTask, right: QuestmasterTask): number {
  return left.questId.localeCompare(right.questId, undefined, { numeric: true, sensitivity: "base" });
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function questRecencyTs(quest: QuestmasterTask): number {
  return Math.max(quest.createdAt, quest.updatedAt ?? 0, quest.statusChangedAt ?? 0);
}

function getQuestOwnerSessionId(quest: QuestmasterTask): string | undefined {
  return "sessionId" in quest ? quest.sessionId : undefined;
}

function verificationSortTuple(quest: QuestmasterTask): [number, number, number] {
  if (!("verificationItems" in quest) || quest.verificationItems.length === 0) return [0, 0, 0];
  const total = quest.verificationItems.length;
  const checked = quest.verificationItems.filter((item) => item.checked).length;
  return [1, checked, total];
}

function feedbackSortTuple(quest: QuestmasterTask): [number, number] {
  const feedback = "feedback" in quest ? (quest.feedback ?? []).filter((entry) => entry.author === "human") : [];
  const open = feedback.filter((entry) => !entry.addressed).length;
  return [open, feedback.length];
}

function compareNumberTuple(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
