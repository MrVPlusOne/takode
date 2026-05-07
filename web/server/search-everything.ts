import type { BrowserIncomingMessage, SessionTaskEntry } from "./session-types.js";
import type { SearchExcerpt } from "./session-store.js";
import type { QuestFeedbackEntry, QuestmasterTask } from "./quest-types.js";
import { normalizeForSearch } from "../shared/search-utils.js";

export type SearchEverythingCategory = "quests" | "sessions" | "messages";

export type SearchEverythingResultType = "quest" | "session";

export type SearchEverythingChildType =
  | "quest_field"
  | "quest_feedback"
  | "quest_debrief"
  | "quest_history"
  | "session_field"
  | "message";

export type SearchEverythingRoute =
  | { kind: "quest"; questId: string }
  | { kind: "session"; sessionId: string }
  | { kind: "message"; sessionId: string; messageId?: string; timestamp?: number; threadKey?: string };

export interface SearchEverythingChildMatch {
  id: string;
  type: SearchEverythingChildType;
  title: string;
  snippet: string;
  matchedField: string;
  score: number;
  timestamp?: number;
  route?: SearchEverythingRoute;
}

export interface SearchEverythingResult {
  id: string;
  type: SearchEverythingResultType;
  title: string;
  subtitle?: string;
  score: number;
  matchedFields: string[];
  childMatches: SearchEverythingChildMatch[];
  totalChildMatches: number;
  remainingChildMatches: number;
  route: SearchEverythingRoute;
  meta: {
    questId?: string;
    status?: string;
    sessionId?: string;
    sessionNum?: number | null;
    archived?: boolean;
    reviewerOf?: number;
    lastActivityAt?: number;
    createdAt?: number;
    cwd?: string;
    gitBranch?: string;
    repoRoot?: string;
  };
}

export interface SearchEverythingSessionDocument {
  sessionId: string;
  sessionNum?: number | null;
  archived: boolean;
  reviewerOf?: number;
  createdAt: number;
  lastActivityAt?: number;
  name?: string;
  taskHistory?: SessionTaskEntry[];
  keywords?: string[];
  gitBranch?: string;
  cwd?: string;
  repoRoot?: string;
  messageHistory?: BrowserIncomingMessage[] | null;
  searchExcerpts?: SearchExcerpt[];
}

export interface SearchEverythingQuestDocument {
  quest: QuestmasterTask;
  history?: QuestmasterTask[];
}

export type SearchEverythingQuestInput = QuestmasterTask | SearchEverythingQuestDocument;

export interface SearchEverythingOptions {
  query: string;
  categories?: SearchEverythingCategory[];
  currentSessionId?: string | null;
  includeArchived?: boolean;
  includeReviewers?: boolean;
  limit?: number;
  childPreviewLimit?: number;
  messageLimitPerSession?: number;
  limits?: Partial<SearchEverythingLimits>;
}

export interface SearchEverythingOutput {
  query: string;
  totalMatches: number;
  results: SearchEverythingResult[];
  degraded: boolean;
  warnings: string[];
  limits: SearchEverythingLimits;
}

export interface SearchEverythingLimits {
  maxQuestDocuments: number;
  maxQuestFeedbackEntriesPerQuest: number;
  maxQuestHistoryVersionsPerQuest: number;
  maxQuestHistoryFeedbackEntriesPerVersion: number;
  maxQuestChildrenPerParent: number;
  maxSessionDocuments: number;
  maxSessionChildrenPerParent: number;
  maxFieldChars: number;
}

interface QueryMatcher {
  raw: string;
  normalized: string;
  words: string[];
  matches: (text: string | undefined | null) => boolean;
}

interface CandidateChildMatch extends Omit<SearchEverythingChildMatch, "snippet"> {
  parentScore: number;
  snippetText: string;
}

interface SearchBudget {
  limits: SearchEverythingLimits;
  warnings: Set<string>;
}

const DEFAULT_CATEGORIES: SearchEverythingCategory[] = ["quests", "sessions", "messages"];
const QUEST_RESULT_CAP = 30;
const SESSION_RESULT_CAP = 30;
const DEFAULT_LIMITS: SearchEverythingLimits = {
  maxQuestDocuments: 500,
  maxQuestFeedbackEntriesPerQuest: 80,
  maxQuestHistoryVersionsPerQuest: 8,
  maxQuestHistoryFeedbackEntriesPerVersion: 25,
  maxQuestChildrenPerParent: 80,
  maxSessionDocuments: 200,
  maxSessionChildrenPerParent: 80,
  maxFieldChars: 8_000,
};

export function searchEverything(
  quests: SearchEverythingQuestInput[],
  sessions: SearchEverythingSessionDocument[],
  options: SearchEverythingOptions,
): SearchEverythingOutput {
  const limits = normalizeLimits(options.limits);
  const budget: SearchBudget = { limits, warnings: new Set() };
  const matcher = buildQueryMatcher(options.query);
  if (!matcher) {
    return {
      query: options.query.trim(),
      totalMatches: 0,
      results: [],
      degraded: false,
      warnings: [],
      limits,
    };
  }

  const categories = new Set(
    options.categories && options.categories.length > 0 ? options.categories : DEFAULT_CATEGORIES,
  );
  const includeArchived = options.includeArchived === true;
  const includeReviewers = options.includeReviewers === true;
  const childPreviewLimit = clampInt(Math.floor(options.childPreviewLimit ?? 3), 1, 8);
  const messageLimitPerSession = clampInt(Math.floor(options.messageLimitPerSession ?? 400), 50, 2000);
  const limit = clampInt(Math.floor(options.limit ?? 30), 1, 100);

  const results: SearchEverythingResult[] = [];
  if (categories.has("quests")) {
    const boundedQuests = quests.slice(0, limits.maxQuestDocuments);
    if (quests.length > boundedQuests.length) {
      budget.warnings.add(`Quest search limited to ${boundedQuests.length} quests.`);
    }
    results.push(...searchQuestParents(boundedQuests, matcher, childPreviewLimit, budget).slice(0, QUEST_RESULT_CAP));
  }
  if (categories.has("sessions") || categories.has("messages")) {
    const boundedSessions = sessions.slice(0, limits.maxSessionDocuments);
    if (sessions.length > boundedSessions.length) {
      budget.warnings.add(`Session search limited to ${boundedSessions.length} sessions.`);
    }
    results.push(
      ...searchSessionParents(boundedSessions, matcher, budget, {
        includeMetadata: categories.has("sessions"),
        includeMessages: categories.has("messages"),
        includeArchived,
        includeReviewers,
        childPreviewLimit,
        messageLimitPerSession,
        currentSessionId: options.currentSessionId ?? null,
      }).slice(0, SESSION_RESULT_CAP),
    );
  }

  results.sort(compareResults);
  return {
    query: matcher.raw,
    totalMatches: results.length,
    results: results.slice(0, limit),
    degraded: budget.warnings.size > 0,
    warnings: Array.from(budget.warnings),
    limits,
  };
}

function searchQuestParents(
  quests: SearchEverythingQuestInput[],
  matcher: QueryMatcher,
  childPreviewLimit: number,
  budget: SearchBudget,
): SearchEverythingResult[] {
  const results: SearchEverythingResult[] = [];
  for (const questInput of quests) {
    const questDocument = normalizeQuestInput(questInput);
    const quest = questDocument.quest;
    const children = collectQuestMatches(questDocument, matcher, budget);
    if (children.length === 0) continue;

    results.push(
      buildParentResult({
        id: `quest:${quest.questId}`,
        type: "quest",
        title: `${quest.questId} ${quest.title}`,
        subtitle: quest.status,
        route: { kind: "quest", questId: quest.questId },
        children,
        childPreviewLimit,
        queryWords: matcher.words,
        recencyTs: questRecencyTs(quest),
        meta: {
          questId: quest.questId,
          status: quest.status,
          createdAt: quest.createdAt,
          lastActivityAt: questRecencyTs(quest),
        },
      }),
    );
  }
  results.sort(compareResults);
  return results;
}

function searchSessionParents(
  sessions: SearchEverythingSessionDocument[],
  matcher: QueryMatcher,
  budget: SearchBudget,
  options: {
    includeMetadata: boolean;
    includeMessages: boolean;
    includeArchived: boolean;
    includeReviewers: boolean;
    childPreviewLimit: number;
    messageLimitPerSession: number;
    currentSessionId: string | null;
  },
): SearchEverythingResult[] {
  const results: SearchEverythingResult[] = [];
  for (const session of sessions) {
    if (!options.includeArchived && session.archived) continue;
    if (!options.includeReviewers && session.reviewerOf !== undefined) continue;

    const children: CandidateChildMatch[] = [];
    if (options.includeMetadata) {
      children.push(...collectSessionMetadataMatches(session, matcher, budget));
    }
    if (options.includeMessages) {
      children.push(...collectSessionMessageMatches(session, matcher, budget, options.messageLimitPerSession));
    }
    if (children.length === 0) continue;

    const recencyTs = session.lastActivityAt ?? session.createdAt ?? 0;
    const currentBoost = options.currentSessionId === session.sessionId ? 90 : 0;
    results.push(
      buildParentResult({
        id: `session:${session.sessionId}`,
        type: "session",
        title: formatSessionTitle(session),
        subtitle: formatSessionSubtitle(session),
        route: { kind: "session", sessionId: session.sessionId },
        children,
        childPreviewLimit: options.childPreviewLimit,
        queryWords: matcher.words,
        recencyTs,
        extraScore: currentBoost,
        meta: {
          sessionId: session.sessionId,
          sessionNum: session.sessionNum ?? null,
          archived: session.archived,
          reviewerOf: session.reviewerOf,
          lastActivityAt: session.lastActivityAt,
          createdAt: session.createdAt,
          cwd: session.cwd,
          gitBranch: session.gitBranch,
          repoRoot: session.repoRoot,
        },
      }),
    );
  }
  results.sort(compareResults);
  return results;
}

function buildParentResult(input: {
  id: string;
  type: SearchEverythingResultType;
  title: string;
  subtitle?: string;
  route: SearchEverythingRoute;
  children: CandidateChildMatch[];
  childPreviewLimit: number;
  queryWords: string[];
  recencyTs: number;
  extraScore?: number;
  meta: SearchEverythingResult["meta"];
}): SearchEverythingResult {
  const sortedChildren = [...input.children].sort(compareChildren);
  const score = parentScore(sortedChildren, input.recencyTs, input.extraScore ?? 0);
  const childMatches = sortedChildren
    .slice(0, input.childPreviewLimit)
    .map(({ parentScore: _parentScore, snippetText, ...child }) => ({
      ...child,
      snippet: buildSnippet(snippetText, input.queryWords),
    }));
  const matchedFields = Array.from(new Set(sortedChildren.map((child) => child.matchedField)));
  return {
    id: input.id,
    type: input.type,
    title: input.title,
    subtitle: input.subtitle,
    score,
    matchedFields,
    childMatches,
    totalChildMatches: sortedChildren.length,
    remainingChildMatches: Math.max(0, sortedChildren.length - childMatches.length),
    route: chooseParentRoute(input.type, input.route, sortedChildren),
    meta: input.meta,
  };
}

function chooseParentRoute(
  type: SearchEverythingResultType,
  parentRoute: SearchEverythingRoute,
  sortedChildren: CandidateChildMatch[],
): SearchEverythingRoute {
  if (type !== "session") return parentRoute;
  const childRoute = sortedChildren.find((child) => child.type === "message" && child.route?.kind === "message")?.route;
  return childRoute ?? parentRoute;
}

function normalizeQuestInput(input: SearchEverythingQuestInput): SearchEverythingQuestDocument {
  if ("quest" in input) return input;
  return { quest: input };
}

function collectQuestMatches(
  document: SearchEverythingQuestDocument,
  matcher: QueryMatcher,
  budget: SearchBudget,
): CandidateChildMatch[] {
  const quest = document.quest;
  const matches: CandidateChildMatch[] = [];
  const addField = (
    field: string,
    title: string,
    text: string | undefined,
    parentScore: number,
    type: SearchEverythingChildType,
  ) => {
    const boundedText = boundedSearchText(text, budget);
    if (!matcher.matches(boundedText)) return;
    pushBoundedMatch(matches, budget.limits.maxQuestChildrenPerParent, budget, "Quest child matches", {
      id: `quest:${quest.questId}:${field}`,
      type,
      title,
      snippetText: boundedText ?? "",
      matchedField: field,
      score: parentScore,
      parentScore,
      timestamp: questRecencyTs(quest),
      route: { kind: "quest", questId: quest.questId },
    });
  };

  addField("quest_id", "Quest ID", quest.questId, exactQuestIdScore(quest.questId, matcher.raw), "quest_field");
  addField("title", "Title", quest.title, 1100, "quest_field");
  addField("tldr", "TLDR", quest.tldr, 900, "quest_field");
  addField("description", "Description", "description" in quest ? quest.description : undefined, 760, "quest_field");
  addField("relationships", "Relationships", questRelationshipSearchText(quest), 730, "quest_field");
  if (quest.status === "done" && quest.cancelled !== true) {
    addField("debrief_tldr", "Debrief TLDR", quest.debriefTldr, 710, "quest_debrief");
    addField("debrief", "Debrief", quest.debrief, 680, "quest_debrief");
  }

  const feedbackEntries = boundedRecentEntries(quest.feedback ?? [], budget.limits.maxQuestFeedbackEntriesPerQuest);
  if ((quest.feedback ?? []).length > feedbackEntries.length) {
    budget.warnings.add(`Quest feedback search limited to ${feedbackEntries.length} entries per quest.`);
  }
  for (const { index, entry } of feedbackEntries) {
    const title = formatQuestFeedbackTitle(entry, index);
    addField(`feedback_${index}_tldr`, `${title} TLDR`, entry.tldr, 640, "quest_feedback");
    addField(`feedback_${index}_text`, title, entry.text, 590, "quest_feedback");
    const metadata = [entry.kind, entry.phaseId, entry.author].filter(Boolean).join(" ");
    addField(`feedback_${index}_metadata`, `${title} metadata`, metadata, 540, "quest_feedback");
  }

  const history = dedupeQuestHistory(quest, document.history ?? []);
  const boundedHistory = history.slice(0, budget.limits.maxQuestHistoryVersionsPerQuest);
  if (history.length > boundedHistory.length) {
    budget.warnings.add(`Quest history search limited to ${boundedHistory.length} versions per quest.`);
  }
  for (const [index, version] of boundedHistory.entries()) {
    const title = formatQuestHistoryTitle(version);
    addHistoricalQuestField(quest, version, matcher, matches, budget, {
      field: `history_${index}_title`,
      title: `${title} title`,
      text: version.title,
      parentScore: 690,
    });
    addHistoricalQuestField(quest, version, matcher, matches, budget, {
      field: `history_${index}_tldr`,
      title: `${title} TLDR`,
      text: version.tldr,
      parentScore: 650,
    });
    addHistoricalQuestField(quest, version, matcher, matches, budget, {
      field: `history_${index}_description`,
      title: `${title} description`,
      text: "description" in version ? version.description : undefined,
      parentScore: 620,
    });
    addHistoricalQuestField(quest, version, matcher, matches, budget, {
      field: `history_${index}_status`,
      title: `${title} status`,
      text: version.status,
      parentScore: 560,
    });
    if (version.status === "done" && version.cancelled !== true) {
      addHistoricalQuestField(quest, version, matcher, matches, budget, {
        field: `history_${index}_debrief_tldr`,
        title: `${title} debrief TLDR`,
        text: version.debriefTldr,
        parentScore: 600,
      });
      addHistoricalQuestField(quest, version, matcher, matches, budget, {
        field: `history_${index}_debrief`,
        title: `${title} debrief`,
        text: version.debrief,
        parentScore: 580,
      });
    }
    const versionFeedback = boundedRecentEntries(
      version.feedback ?? [],
      budget.limits.maxQuestHistoryFeedbackEntriesPerVersion,
    );
    if ((version.feedback ?? []).length > versionFeedback.length) {
      budget.warnings.add(`Quest history feedback search limited to ${versionFeedback.length} entries per version.`);
    }
    for (const { index: feedbackIndex, entry } of versionFeedback) {
      const feedbackTitle = `${title} ${formatQuestFeedbackTitle(entry, feedbackIndex)}`;
      addHistoricalQuestField(quest, version, matcher, matches, budget, {
        field: `history_${index}_feedback_${feedbackIndex}_tldr`,
        title: `${feedbackTitle} TLDR`,
        text: entry.tldr,
        parentScore: 570,
      });
      addHistoricalQuestField(quest, version, matcher, matches, budget, {
        field: `history_${index}_feedback_${feedbackIndex}_text`,
        title: feedbackTitle,
        text: entry.text,
        parentScore: 550,
      });
      const metadata = [entry.kind, entry.phaseId, entry.author].filter(Boolean).join(" ");
      addHistoricalQuestField(quest, version, matcher, matches, budget, {
        field: `history_${index}_feedback_${feedbackIndex}_metadata`,
        title: `${feedbackTitle} metadata`,
        text: metadata,
        parentScore: 520,
      });
    }
  }
  return matches;
}

function dedupeQuestHistory(currentQuest: QuestmasterTask, history: QuestmasterTask[]): QuestmasterTask[] {
  const currentVersionKey = `${currentQuest.id}:${currentQuest.version}`;
  return history.filter((entry) => {
    if (entry.questId !== currentQuest.questId) return false;
    if (`${entry.id}:${entry.version}` === currentVersionKey) return false;
    return !(entry.id === currentQuest.id || entry.version === currentQuest.version);
  });
}

function addHistoricalQuestField(
  currentQuest: QuestmasterTask,
  version: QuestmasterTask,
  matcher: QueryMatcher,
  matches: CandidateChildMatch[],
  budget: SearchBudget,
  input: {
    field: string;
    title: string;
    text: string | undefined;
    parentScore: number;
  },
) {
  const boundedText = boundedSearchText(input.text, budget);
  if (!matcher.matches(boundedText)) return;
  pushBoundedMatch(matches, budget.limits.maxQuestChildrenPerParent, budget, "Quest child matches", {
    id: `quest:${currentQuest.questId}:${input.field}`,
    type: "quest_history",
    title: input.title,
    snippetText: boundedText ?? "",
    matchedField: input.field,
    score: input.parentScore,
    parentScore: input.parentScore,
    timestamp: questRecencyTs(version),
    route: { kind: "quest", questId: currentQuest.questId },
  });
}

function collectSessionMetadataMatches(
  session: SearchEverythingSessionDocument,
  matcher: QueryMatcher,
  budget: SearchBudget,
): CandidateChildMatch[] {
  const matches: CandidateChildMatch[] = [];
  const addField = (
    field: string,
    title: string,
    text: string | undefined,
    parentScore: number,
    timestamp?: number,
  ) => {
    const boundedText = boundedSearchText(text, budget);
    if (!matcher.matches(boundedText)) return;
    pushBoundedMatch(matches, budget.limits.maxSessionChildrenPerParent, budget, "Session child matches", {
      id: `session:${session.sessionId}:${field}`,
      type: "session_field",
      title,
      snippetText: boundedText ?? "",
      matchedField: field,
      score: parentScore,
      parentScore,
      timestamp: timestamp ?? session.lastActivityAt ?? session.createdAt,
      route: { kind: "session", sessionId: session.sessionId },
    });
  };

  const sessionNumText = session.sessionNum == null ? undefined : `#${session.sessionNum}`;
  addField(
    "session_number",
    "Session number",
    sessionNumText,
    exactSessionNumberScore(session.sessionNum, matcher.raw),
  );
  addField("name", "Session name", session.name, 1060);
  for (const [index, task] of (session.taskHistory ?? []).entries()) {
    addField(`task_${index}`, "Task", task.title, 940, task.timestamp);
  }
  for (const [index, keyword] of (session.keywords ?? []).entries()) {
    addField(`keyword_${index}`, "Keyword", keyword, 890);
  }
  addField("branch", "Branch", session.gitBranch, 800);
  addField("cwd", "Directory", session.cwd, 770);
  addField("repo", "Repository", session.repoRoot, 760);
  return matches;
}

function collectSessionMessageMatches(
  session: SearchEverythingSessionDocument,
  matcher: QueryMatcher,
  budget: SearchBudget,
  messageLimitPerSession: number,
): CandidateChildMatch[] {
  const history = session.messageHistory;
  if ((!history || history.length === 0) && session.searchExcerpts && session.searchExcerpts.length > 0) {
    return collectSessionExcerptMatches(session, matcher, budget, messageLimitPerSession);
  }
  if (!history || history.length === 0) return [];

  const matches: CandidateChildMatch[] = [];
  let scanned = 0;
  for (let index = history.length - 1; index >= 0; index--) {
    if (scanned >= messageLimitPerSession) break;
    scanned++;
    const msg = history[index];
    const candidate = messageTextCandidate(session, msg, matcher, budget);
    if (candidate)
      pushBoundedMatch(matches, budget.limits.maxSessionChildrenPerParent, budget, "Session child matches", candidate);
    if (canStopCollectingMessages(matches, budget, messageScore("user_message"), index)) break;
  }
  if (history.length > scanned) {
    budget.warnings.add(`Message search limited to ${messageLimitPerSession} recent messages per session.`);
  }
  return matches;
}

function collectSessionExcerptMatches(
  session: SearchEverythingSessionDocument,
  matcher: QueryMatcher,
  budget: SearchBudget,
  messageLimitPerSession: number,
): CandidateChildMatch[] {
  const matches: CandidateChildMatch[] = [];
  const excerpts = session.searchExcerpts ?? [];
  let scanned = 0;
  for (let index = excerpts.length - 1; index >= 0; index--) {
    if (scanned >= messageLimitPerSession) break;
    scanned++;
    const excerpt = excerpts[index];
    const boundedContent = boundedSearchText(excerpt.content, budget);
    if (!matcher.matches(boundedContent)) continue;
    const timestamp = excerpt.timestamp || session.lastActivityAt || session.createdAt;
    const field =
      excerpt.type === "user_message" ? "user_message" : excerpt.type === "assistant" ? "assistant" : "compact_marker";
    const title =
      excerpt.type === "user_message" ? "Message" : excerpt.type === "assistant" ? "Assistant" : "Compaction";
    pushBoundedMatch(matches, budget.limits.maxSessionChildrenPerParent, budget, "Session child matches", {
      id: `message:${session.sessionId}:${excerpt.id ?? `excerpt-${index}`}`,
      type: "message",
      title,
      snippetText: boundedContent ?? "",
      matchedField: field,
      score: messageScore(field),
      parentScore: messageScore(field),
      timestamp,
      route: { kind: "message", sessionId: session.sessionId, messageId: excerpt.id, timestamp },
    });
    if (canStopCollectingMessages(matches, budget, messageScore("user_message"), index)) break;
  }
  if (excerpts.length > scanned) {
    budget.warnings.add(`Archived message search limited to ${messageLimitPerSession} excerpts per session.`);
  }
  return matches;
}

function messageTextCandidate(
  session: SearchEverythingSessionDocument,
  msg: BrowserIncomingMessage,
  matcher: QueryMatcher,
  budget: SearchBudget,
): CandidateChildMatch | null {
  if (msg.type === "user_message" || msg.type === "leader_user_message") {
    return buildMessageCandidate(
      session,
      msg.content,
      matcher,
      "user_message",
      "Message",
      msg.timestamp,
      msg.id,
      msg.threadKey,
      budget,
    );
  }
  if (msg.type === "assistant") {
    const text = extractAssistantText(msg, budget);
    return buildMessageCandidate(
      session,
      text,
      matcher,
      "assistant",
      "Assistant",
      msg.timestamp,
      msg.message?.id,
      undefined,
      budget,
    );
  }
  if (msg.type === "compact_marker") {
    return buildMessageCandidate(
      session,
      msg.summary ?? "[Context compacted]",
      matcher,
      "compact_marker",
      "Compaction",
      msg.timestamp,
      msg.id,
      undefined,
      budget,
    );
  }
  return null;
}

function buildMessageCandidate(
  session: SearchEverythingSessionDocument,
  text: string,
  matcher: QueryMatcher,
  field: "user_message" | "assistant" | "compact_marker",
  title: string,
  timestamp?: number,
  messageId?: string,
  threadKey?: string,
  budget?: SearchBudget,
): CandidateChildMatch | null {
  const boundedText = budget ? boundedSearchText(text, budget) : text;
  if (!matcher.matches(boundedText)) return null;
  const matchedAt = timestamp ?? session.lastActivityAt ?? session.createdAt;
  const score = messageScore(field);
  return {
    id: `message:${session.sessionId}:${messageId ?? matchedAt}`,
    type: "message",
    title,
    snippetText: boundedText ?? "",
    matchedField: field,
    score,
    parentScore: score,
    timestamp: matchedAt,
    route: { kind: "message", sessionId: session.sessionId, messageId, timestamp: matchedAt, threadKey },
  };
}

function buildQueryMatcher(query: string): QueryMatcher | null {
  const raw = query.trim();
  const normalized = normalizeForSearch(raw);
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return {
    raw,
    normalized,
    words,
    matches: (text) => {
      if (!text) return false;
      if (words.every((word) => text.includes(word))) return true;
      if (!/[A-Z]/.test(text)) return false;
      const haystack = normalizeForSearch(text);
      return words.every((word) => haystack.includes(word));
    },
  };
}

function buildSnippet(content: string, qWords: string[], maxLen = 150): string {
  const text = content.replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxLen) return text;

  const lower = text.toLowerCase();
  let idx = -1;
  let matchLen = 1;
  for (const word of qWords) {
    const i = lower.indexOf(word);
    if (i >= 0) {
      idx = i;
      matchLen = word.length;
      break;
    }
  }
  if (idx < 0) return `${text.slice(0, maxLen).trimEnd()}...`;

  const contextRadius = Math.floor((maxLen - matchLen) / 2);
  const start = Math.max(0, idx - contextRadius);
  const end = Math.min(text.length, start + maxLen);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < text.length ? "..." : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}

function extractAssistantText(
  msg: Extract<BrowserIncomingMessage, { type: "assistant" }>,
  budget: SearchBudget,
): string {
  const blocks = msg.message?.content;
  if (!Array.isArray(blocks)) return "";
  const texts: string[] = [];
  for (const block of blocks) {
    if (block.type === "text" && typeof block.text === "string") {
      texts.push(boundedSearchText(block.text, budget) ?? "");
    }
  }
  return texts.join(" ").trim();
}

function parentScore(children: CandidateChildMatch[], recencyTs: number, extraScore: number): number {
  const best = children[0]?.parentScore ?? 0;
  const childBoost = Math.min(220, Math.max(0, children.length - 1) * 35);
  const recencyBoost = Math.min(40, Math.max(0, recencyTs) / 1_000_000_000_000);
  return best + childBoost + recencyBoost + extraScore;
}

function compareResults(left: SearchEverythingResult, right: SearchEverythingResult): number {
  if (left.score !== right.score) return right.score - left.score;
  const leftTs = left.meta.lastActivityAt ?? left.meta.createdAt ?? 0;
  const rightTs = right.meta.lastActivityAt ?? right.meta.createdAt ?? 0;
  if (leftTs !== rightTs) return rightTs - leftTs;
  return left.id.localeCompare(right.id, undefined, { numeric: true, sensitivity: "base" });
}

function compareChildren(left: CandidateChildMatch, right: CandidateChildMatch): number {
  if (left.parentScore !== right.parentScore) return right.parentScore - left.parentScore;
  const leftTs = left.timestamp ?? 0;
  const rightTs = right.timestamp ?? 0;
  if (leftTs !== rightTs) return rightTs - leftTs;
  return left.id.localeCompare(right.id, undefined, { numeric: true, sensitivity: "base" });
}

function normalizeLimits(overrides: Partial<SearchEverythingLimits> | undefined): SearchEverythingLimits {
  return {
    maxQuestDocuments: clampInt(Math.floor(overrides?.maxQuestDocuments ?? DEFAULT_LIMITS.maxQuestDocuments), 1, 5_000),
    maxQuestFeedbackEntriesPerQuest: clampInt(
      Math.floor(overrides?.maxQuestFeedbackEntriesPerQuest ?? DEFAULT_LIMITS.maxQuestFeedbackEntriesPerQuest),
      1,
      500,
    ),
    maxQuestHistoryVersionsPerQuest: clampInt(
      Math.floor(overrides?.maxQuestHistoryVersionsPerQuest ?? DEFAULT_LIMITS.maxQuestHistoryVersionsPerQuest),
      0,
      100,
    ),
    maxQuestHistoryFeedbackEntriesPerVersion: clampInt(
      Math.floor(
        overrides?.maxQuestHistoryFeedbackEntriesPerVersion ?? DEFAULT_LIMITS.maxQuestHistoryFeedbackEntriesPerVersion,
      ),
      1,
      500,
    ),
    maxQuestChildrenPerParent: clampInt(
      Math.floor(overrides?.maxQuestChildrenPerParent ?? DEFAULT_LIMITS.maxQuestChildrenPerParent),
      1,
      1_000,
    ),
    maxSessionDocuments: clampInt(
      Math.floor(overrides?.maxSessionDocuments ?? DEFAULT_LIMITS.maxSessionDocuments),
      1,
      5_000,
    ),
    maxSessionChildrenPerParent: clampInt(
      Math.floor(overrides?.maxSessionChildrenPerParent ?? DEFAULT_LIMITS.maxSessionChildrenPerParent),
      1,
      1_000,
    ),
    maxFieldChars: clampInt(Math.floor(overrides?.maxFieldChars ?? DEFAULT_LIMITS.maxFieldChars), 500, 200_000),
  };
}

function boundedSearchText(text: string | undefined | null, budget: SearchBudget): string | undefined {
  if (!text) return text ?? undefined;
  if (text.length <= budget.limits.maxFieldChars) return text;
  budget.warnings.add(`Search text fields limited to ${budget.limits.maxFieldChars} characters.`);
  return text.slice(0, budget.limits.maxFieldChars);
}

function pushBoundedMatch(
  matches: CandidateChildMatch[],
  maxMatches: number,
  budget: SearchBudget,
  label: string,
  match: CandidateChildMatch,
) {
  if (matches.length < maxMatches) {
    matches.push(match);
    return;
  }
  budget.warnings.add(`${label} limited to ${maxMatches} matches per parent.`);
  const worstIndex = matches.reduce((worst, candidate, index) => {
    return compareChildren(candidate, matches[worst]) > 0 ? index : worst;
  }, 0);
  if (compareChildren(match, matches[worstIndex]) < 0) {
    matches[worstIndex] = match;
  }
}

function boundedRecentEntries<T>(entries: T[], maxEntries: number): Array<{ index: number; entry: T }> {
  const start = Math.max(0, entries.length - maxEntries);
  return entries.slice(start).map((entry, offset) => ({ index: start + offset, entry }));
}

function exactQuestIdScore(questId: string, query: string): number {
  return questId.toLowerCase() === query.trim().toLowerCase() ? 1400 : 1150;
}

function exactSessionNumberScore(sessionNum: number | null | undefined, query: string): number {
  const match = query.trim().match(/^#(\d+)$/);
  if (!match || sessionNum == null) return 900;
  return Number.parseInt(match[1], 10) === sessionNum ? 1400 : 900;
}

function messageScore(field: "user_message" | "assistant" | "compact_marker"): number {
  if (field === "user_message") return 660;
  if (field === "assistant") return 620;
  return 570;
}

function canStopCollectingMessages(
  matches: CandidateChildMatch[],
  budget: SearchBudget,
  maxFutureScore: number,
  remainingIndex: number,
): boolean {
  const maxMatches = budget.limits.maxSessionChildrenPerParent;
  if (remainingIndex <= 0 || matches.length < maxMatches) return false;
  const worst = matches.reduce((currentWorst, candidate) =>
    compareChildren(candidate, currentWorst) > 0 ? candidate : currentWorst,
  );
  if (worst.parentScore < maxFutureScore) return false;
  budget.warnings.add(`Session child matches limited to ${maxMatches} matches per parent.`);
  return true;
}

function questRecencyTs(quest: QuestmasterTask): number {
  return Math.max(quest.createdAt, quest.updatedAt ?? 0, quest.statusChangedAt ?? 0);
}

function questRelationshipSearchText(quest: QuestmasterTask): string | undefined {
  const explicit = quest.relationships?.followUpOf ?? [];
  const derived = quest.relatedQuests?.map((related) => `${related.kind} ${related.questId}`) ?? [];
  const combined = [...explicit, ...derived];
  return combined.length > 0 ? combined.join(" ") : undefined;
}

function formatQuestFeedbackTitle(entry: QuestFeedbackEntry, index: number): string {
  const label = entry.kind ? entry.kind.replace(/_/g, " ") : "comment";
  const phase = entry.phaseId ? `, ${entry.phaseId}` : "";
  return `Feedback ${index + 1} (${entry.author}, ${label}${phase})`;
}

function formatQuestHistoryTitle(version: QuestmasterTask): string {
  return `History v${version.version}`;
}

function formatSessionTitle(session: SearchEverythingSessionDocument): string {
  const prefix = session.sessionNum == null ? "Session" : `#${session.sessionNum}`;
  const name = session.name?.trim();
  return name ? `${prefix} ${name}` : prefix;
}

function formatSessionSubtitle(session: SearchEverythingSessionDocument): string {
  const parts: string[] = [];
  if (session.lastActivityAt) parts.push(`last active ${formatRelativeTime(session.lastActivityAt)}`);
  if (session.gitBranch) parts.push(session.gitBranch);
  if (session.cwd) parts.push(session.cwd);
  if (session.archived) parts.push("archived");
  if (session.reviewerOf !== undefined) parts.push(`reviewer of #${session.reviewerOf}`);
  return parts.join(" · ");
}

function formatRelativeTime(timestamp: number): string {
  const diffMs = Date.now() - timestamp;
  const absMs = Math.abs(diffMs);
  if (absMs < 60_000) return "just now";
  const minutes = Math.round(absMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
