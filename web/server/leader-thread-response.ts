import { createHash } from "node:crypto";
import {
  leaderResponseAssociatedThreadKeys,
  leaderResponseExactAnswerThreadKey,
  leaderResponseOwnerThreadKey,
} from "../shared/leader-thread-response-routing.js";
import { normalizeSelectedFeedThreadKey } from "../shared/thread-window.js";
import {
  buildLeaderUserMessageIdentities,
  isCanonicalLeaderUserMessageId,
  type LeaderUserMessageIdentity,
} from "./leader-user-message-id.js";
import { isRootAgentHistoryMessage } from "./root-agent-feed-message.js";
import type {
  BrowserIncomingMessage,
  LeaderThreadAnswerMetadata,
  LeaderThreadResponseProjection,
  LeaderThreadResponseState,
  LegacyLeaderThreadResponseRevisionMetadata,
} from "./session-types.js";
import {
  LEADER_THREAD_RESPONSE_VERSION,
  LEGACY_LEADER_THREAD_RESPONSE_VERSION,
} from "./leader-thread-response-types.js";

type PendingLeaderAnswerInput = Pick<
  Extract<BrowserIncomingMessage, { type: "user_message" }>,
  "leaderResponseCoverageVersion" | "leaderUserMessageId" | "threadKey" | "questId" | "threadRefs"
>;

export type LeaderThreadResponseSession = {
  id: string;
  messageHistory: BrowserIncomingMessage[];
  pendingCodexInputs?: ReadonlyArray<PendingLeaderAnswerInput>;
};

export interface PendingLeaderAnswerInputState {
  count: number;
  userMessageIds: string[];
}

type DirectHumanMessage = LeaderUserMessageIdentity & {
  timestamp: number;
  threadKey: string;
  associatedThreadKeys: string[];
};

type ResponseHistoryMessage = Extract<BrowserIncomingMessage, { type: "assistant" | "leader_user_message" }>;

type LegacyRevision = {
  metadata: LegacyLeaderThreadResponseRevisionMetadata;
  threadKey: string;
  messageId: string;
  historyIndex: number;
  createdAt: number;
};

type LegacyChain = {
  threadKey: string;
  entries: LegacyRevision[];
};

type AnswerCandidate = {
  threadKey: string;
  answerUserMessageIds: string[];
  referencedUserMessageIds: string[];
  messageId: string;
  historyIndex: number;
  createdAt: number;
  source: "explicit" | "legacy";
};

type Evaluation = {
  directMessages: DirectHumanMessage[];
  currentAnswers: LeaderThreadResponseState[];
  coveredMessageIds: Set<string>;
};

type LegacyPendingBatch = {
  batchId: string;
  legacyBatchId: string;
  userMessageIds: string[];
};

type LegacyPendingBatchTokenPayload = {
  v: typeof LEGACY_LEADER_THREAD_RESPONSE_VERSION;
  t: string;
  h: number;
  ids: string[];
};

const THREAD_ROUTE_DIRECTIVE_RE = /^\s*\[thread:/i;
const SHELL_THREAD_ROUTE_DIRECTIVE_RE = /^\s*#\s*thread:/i;
const THREAD_STATUS_DIRECTIVE_RE = /^\s*\{\[\(Thread (?:Waiting|Ready):/i;
const QUEST_QUIZ_DIRECTIVE_RE = /^\s*\{\[\(Quest Quiz:\s*q-\d+\)\]\}\s*$/i;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

export function leaderThreadResponseContentHash(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex");
}

function normalizeLeaderThreadAnswerMarkdown(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n").trim();
}

function stripQuestQuizDirectives(markdown: string): string {
  let fence: { marker: string; length: number } | null = null;
  const retained: string[] = [];
  for (const line of markdown.split("\n")) {
    const token = line.match(FENCE_RE)?.[1];
    if (fence) {
      retained.push(line);
      if (token && token[0] === fence.marker && token.length >= fence.length) fence = null;
      continue;
    }
    if (token) {
      fence = { marker: token[0]!, length: token.length };
      retained.push(line);
      continue;
    }
    if (!QUEST_QUIZ_DIRECTIVE_RE.test(line)) retained.push(line);
  }
  return retained.join("\n");
}

function isSubstantiveLeaderThreadAnswer(markdown: string): boolean {
  const readable = stripQuestQuizDirectives(normalizeLeaderThreadAnswerMarkdown(markdown))
    .replace(/<!--[^]*?-->/g, "")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_>#~|\-+=:[\](){}.!?,;\\/]/g, " ");
  return /[\p{L}\p{N}]/u.test(readable);
}

function hasThreadControlDirectives(markdown: string): boolean {
  let fence: { marker: string; length: number } | null = null;
  for (const line of markdown.split("\n")) {
    const token = line.match(FENCE_RE)?.[1];
    if (fence) {
      if (token && token[0] === fence.marker && token.length >= fence.length) fence = null;
      continue;
    }
    if (token) {
      fence = { marker: token[0]!, length: token.length };
      continue;
    }
    if (
      THREAD_ROUTE_DIRECTIVE_RE.test(line) ||
      SHELL_THREAD_ROUTE_DIRECTIVE_RE.test(line) ||
      THREAD_STATUS_DIRECTIVE_RE.test(line)
    ) {
      return true;
    }
  }
  return false;
}

function normalizeThreadKey(value: string): string {
  const threadKey = normalizeSelectedFeedThreadKey(value);
  if (threadKey !== "main" && !/^q-\d+$/.test(threadKey)) throw new Error("threadKey must be main or q-N.");
  return threadKey;
}

export function pendingLeaderAnswerInputsForThread(
  session: Pick<LeaderThreadResponseSession, "pendingCodexInputs">,
  requestedThreadKey: string,
): PendingLeaderAnswerInputState {
  const threadKey = normalizeThreadKey(requestedThreadKey);
  const matching = (session.pendingCodexInputs ?? []).filter(
    (input) => input.leaderResponseCoverageVersion === 1 && leaderResponseOwnerThreadKey(input) === threadKey,
  );
  return {
    count: matching.length,
    userMessageIds: [
      ...new Set(
        matching.flatMap((input) =>
          isCanonicalLeaderUserMessageId(input.leaderUserMessageId) ? [input.leaderUserMessageId] : [],
        ),
      ),
    ],
  };
}

function exactResponseThreadKey(message: ResponseHistoryMessage): string | null {
  return leaderResponseExactAnswerThreadKey(message);
}

function responseMessageId(message: ResponseHistoryMessage): string | null {
  const value = message.type === "assistant" ? message.message.id : message.id;
  return typeof value === "string" && value.trim() ? value : null;
}

function responseMessageMarkdown(message: ResponseHistoryMessage): string {
  if (message.type === "leader_user_message") return normalizeLeaderThreadAnswerMarkdown(message.content);
  return normalizeLeaderThreadAnswerMarkdown(
    message.message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n"),
  );
}

function responseMessageTimestamp(message: ResponseHistoryMessage): number | null {
  return typeof message.timestamp === "number" && Number.isFinite(message.timestamp) ? message.timestamp : null;
}

function eligibleAssistantAnswer(message: Extract<BrowserIncomingMessage, { type: "assistant" }>): boolean {
  return (
    message.parent_tool_use_id === null &&
    !message.message.content.some((block) => block.type === "tool_use" || block.type === "tool_result")
  );
}

function collectDirectMessages(
  history: ReadonlyArray<BrowserIncomingMessage>,
  historyLimit: number,
): DirectHumanMessage[] {
  return buildLeaderUserMessageIdentities(history)
    .filter((entry) => entry.historyIndex < historyLimit)
    .flatMap((entry) => {
      const threadKey = leaderResponseThreadKeyForUserMessage(entry.message);
      if (!threadKey) return [];
      return [
        {
          ...entry,
          timestamp:
            typeof entry.message.timestamp === "number" && Number.isFinite(entry.message.timestamp)
              ? entry.message.timestamp
              : 0,
          threadKey,
          associatedThreadKeys: leaderResponseAssociatedThreadKeys(entry.message),
        },
      ];
    });
}

export function leaderResponseThreadKeyForUserMessage(
  message: Extract<BrowserIncomingMessage, { type: "user_message" }>,
): string | null {
  return leaderResponseOwnerThreadKey(message);
}

function validLegacyRevisionMetadata(value: unknown): value is LegacyLeaderThreadResponseRevisionMetadata {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LegacyLeaderThreadResponseRevisionMetadata>;
  return (
    typeof candidate.logicalResponseId === "string" &&
    candidate.logicalResponseId.length > 0 &&
    typeof candidate.revisionId === "string" &&
    candidate.revisionId.length > 0 &&
    Number.isInteger(candidate.revisionNumber) &&
    (candidate.revisionNumber ?? 0) > 0 &&
    typeof candidate.batchId === "string" &&
    candidate.batchId.length > 0 &&
    Number.isInteger(candidate.batchObservedHistoryLength) &&
    (candidate.batchObservedHistoryLength ?? -1) >= 0 &&
    Array.isArray(candidate.coveredUserMessageIds) &&
    candidate.coveredUserMessageIds.length > 0 &&
    candidate.coveredUserMessageIds.every((id) => typeof id === "string" && id.length > 0) &&
    new Set(candidate.coveredUserMessageIds).size === candidate.coveredUserMessageIds.length &&
    typeof candidate.contentHash === "string" &&
    /^[0-9a-f]{64}$/.test(candidate.contentHash)
  );
}

function parsedLegacyRevision(message: BrowserIncomingMessage, historyIndex: number): LegacyRevision | null {
  if (
    (message.type !== "leader_user_message" && message.type !== "assistant") ||
    !isRootAgentHistoryMessage(message) ||
    !validLegacyRevisionMetadata(message.threadResponse)
  ) {
    return null;
  }
  if (message.type === "assistant" && (message.leaderThreadRole !== "response" || !eligibleAssistantAnswer(message))) {
    return null;
  }
  const threadKey = exactResponseThreadKey(message);
  const markdown = responseMessageMarkdown(message);
  const messageId = responseMessageId(message);
  const createdAt = responseMessageTimestamp(message);
  if (
    !threadKey ||
    !messageId ||
    !isSubstantiveLeaderThreadAnswer(markdown) ||
    message.threadResponse.contentHash !== leaderThreadResponseContentHash(markdown) ||
    createdAt === null ||
    createdAt < 0
  ) {
    return null;
  }
  return { metadata: message.threadResponse, threadKey, messageId, historyIndex, createdAt };
}

function legacyChains(parsed: LegacyRevision[]): LegacyChain[] {
  const byResponseId = new Map<string, LegacyRevision[]>();
  for (const entry of parsed) {
    const existing = byResponseId.get(entry.metadata.logicalResponseId);
    if (existing) existing.push(entry);
    else byResponseId.set(entry.metadata.logicalResponseId, [entry]);
  }
  const chains: LegacyChain[] = [];
  for (const candidates of byResponseId.values()) {
    const entries: LegacyRevision[] = [];
    for (const candidate of candidates) {
      const previous = entries.at(-1);
      if (!previous) {
        if (candidate.metadata.revisionNumber !== 1 || candidate.metadata.parentRevisionId) continue;
      } else if (
        candidate.threadKey !== previous.threadKey ||
        candidate.metadata.batchId !== previous.metadata.batchId ||
        candidate.metadata.batchObservedHistoryLength !== previous.metadata.batchObservedHistoryLength ||
        !sameIds(candidate.metadata.coveredUserMessageIds, previous.metadata.coveredUserMessageIds) ||
        candidate.metadata.revisionNumber !== previous.metadata.revisionNumber + 1 ||
        candidate.metadata.parentRevisionId !== previous.metadata.revisionId
      ) {
        break;
      }
      entries.push(candidate);
    }
    if (entries.length > 0) chains.push({ threadKey: entries[0]!.threadKey, entries });
  }
  return chains.sort((left, right) => left.entries[0]!.historyIndex - right.entries[0]!.historyIndex);
}

function encodeLegacyPendingBatchId(sessionId: string, payload: LegacyPendingBatchTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const checksum = leaderThreadResponseContentHash(`${sessionId}\n${encoded}`).slice(0, 24);
  return `response-batch-v1.${encoded}.${checksum}`;
}

function legacyPendingBatchId(
  sessionId: string,
  threadKey: string,
  observedHistoryLength: number,
  messageIds: readonly string[],
): string {
  return encodeLegacyPendingBatchId(sessionId, {
    v: LEGACY_LEADER_THREAD_RESPONSE_VERSION,
    t: threadKey,
    h: observedHistoryLength,
    ids: [...messageIds],
  });
}

function routedLegacyPendingBatchId(
  sessionId: string,
  threadKey: string,
  observedHistoryLength: number,
  messageIds: readonly string[],
): string {
  const digest = leaderThreadResponseContentHash(
    JSON.stringify({
      v: LEGACY_LEADER_THREAD_RESPONSE_VERSION,
      sessionId,
      threadKey,
      observedHistoryLength,
      messageIds,
    }),
  ).slice(0, 32);
  return `routed-response-batch-v1.${digest}`;
}

function legacyPendingBatches(
  sessionId: string,
  threadKey: string,
  directMessages: readonly DirectHumanMessage[],
  coveredMessageIds: ReadonlySet<string>,
  observedHistoryLength: number,
): LegacyPendingBatch[] {
  const eligible = directMessages.filter((message) => message.threadKey === threadKey);
  const batches: DirectHumanMessage[][] = [];
  let current: DirectHumanMessage[] = [];
  for (const message of eligible) {
    if (coveredMessageIds.has(message.historyMessageId)) {
      if (current.length > 0) batches.push(current);
      current = [];
    } else {
      current.push(message);
    }
  }
  if (current.length > 0) batches.push(current);
  return batches.map((members) => {
    const ids = members.map((member) => member.historyMessageId);
    return {
      batchId: routedLegacyPendingBatchId(sessionId, threadKey, observedHistoryLength, ids),
      legacyBatchId: legacyPendingBatchId(sessionId, threadKey, observedHistoryLength, ids),
      userMessageIds: ids,
    };
  });
}

function evaluateLegacyCandidates(
  session: Pick<LeaderThreadResponseSession, "id" | "messageHistory">,
  directMessages: DirectHumanMessage[],
  boundedLimit: number,
): AnswerCandidate[] {
  const parsed = session.messageHistory.slice(0, boundedLimit).flatMap((message, historyIndex) => {
    const revision = parsedLegacyRevision(message, historyIndex);
    return revision ? [revision] : [];
  });
  const accepted: LegacyChain[] = [];
  const covered = new Set<string>();
  for (const chain of legacyChains(parsed)) {
    const first = chain.entries[0]!;
    const observedLength = first.metadata.batchObservedHistoryLength;
    if (observedLength > first.historyIndex || observedLength > boundedLimit) continue;
    const observedDirect = directMessages.filter((message) => message.historyIndex < observedLength);
    const observedCovered = new Set<string>();
    for (const prior of accepted) {
      if (prior.entries[0]!.historyIndex >= observedLength) continue;
      prior.entries[0]!.metadata.coveredUserMessageIds.forEach((id) => observedCovered.add(id));
    }
    const batch = legacyPendingBatches(
      session.id,
      chain.threadKey,
      observedDirect,
      observedCovered,
      observedLength,
    ).find(
      (candidate) =>
        (candidate.batchId === first.metadata.batchId || candidate.legacyBatchId === first.metadata.batchId) &&
        sameIds(candidate.userMessageIds, first.metadata.coveredUserMessageIds),
    );
    if (!batch || first.metadata.coveredUserMessageIds.some((id) => covered.has(id))) continue;
    first.metadata.coveredUserMessageIds.forEach((id) => covered.add(id));
    accepted.push(chain);
  }

  const conciseByHistoryId = new Map(
    directMessages.map((message) => [message.historyMessageId, message.userMessageId]),
  );
  return accepted.flatMap((chain) => {
    const first = chain.entries[0]!;
    const latest = chain.entries.at(-1)!;
    const answerUserMessageIds = first.metadata.coveredUserMessageIds.map((id) => conciseByHistoryId.get(id));
    if (answerUserMessageIds.some((id) => !id)) return [];
    return [
      {
        threadKey: chain.threadKey,
        answerUserMessageIds: answerUserMessageIds as string[],
        referencedUserMessageIds: [...first.metadata.coveredUserMessageIds],
        messageId: latest.messageId,
        historyIndex: latest.historyIndex,
        createdAt: latest.createdAt,
        source: "legacy" as const,
      },
    ];
  });
}

function validAnswerMetadata(value: unknown): value is LeaderThreadAnswerMetadata {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LeaderThreadAnswerMetadata>;
  return (
    candidate.version === LEADER_THREAD_RESPONSE_VERSION &&
    Array.isArray(candidate.answerUserMessageIds) &&
    candidate.answerUserMessageIds.length > 0 &&
    candidate.answerUserMessageIds.every(isCanonicalLeaderUserMessageId) &&
    new Set(candidate.answerUserMessageIds).size === candidate.answerUserMessageIds.length &&
    Number.isInteger(candidate.observedHistoryLength) &&
    (candidate.observedHistoryLength ?? -1) >= 0
  );
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function resolveExplicitAnswerMessages(
  directMessages: readonly DirectHumanMessage[],
  answerUserMessageIds: readonly string[],
  observedHistoryLength: number,
  threadKey: string,
): DirectHumanMessage[] | null {
  const byId = new Map(directMessages.map((message) => [message.userMessageId, message]));
  const referenced = answerUserMessageIds.map((id) => byId.get(id));
  if (
    referenced.some(
      (message) => !message || message.historyIndex >= observedHistoryLength || message.threadKey !== threadKey,
    )
  ) {
    return null;
  }
  const resolved = referenced as DirectHumanMessage[];
  const threadMessages = directMessages.filter(
    (message) => message.threadKey === threadKey && message.historyIndex < observedHistoryLength,
  );
  const positions = resolved.map((message) =>
    threadMessages.findIndex((candidate) => candidate.historyMessageId === message.historyMessageId),
  );
  if (positions.some((position) => position < 0)) return null;
  for (let index = 1; index < positions.length; index += 1) {
    if (positions[index] !== positions[index - 1]! + 1) return null;
  }
  return resolved;
}

function parsedExplicitCandidate(
  message: BrowserIncomingMessage,
  historyIndex: number,
  directMessages: readonly DirectHumanMessage[],
  boundedLimit: number,
): AnswerCandidate | null {
  if (
    message.type !== "assistant" ||
    !isRootAgentHistoryMessage(message) ||
    message.leaderThreadRole !== "answer" ||
    !eligibleAssistantAnswer(message) ||
    !validAnswerMetadata(message.threadAnswer)
  ) {
    return null;
  }
  const threadKey = exactResponseThreadKey(message);
  const markdown = responseMessageMarkdown(message);
  const messageId = responseMessageId(message);
  const createdAt = responseMessageTimestamp(message);
  const metadata = message.threadAnswer;
  if (
    !threadKey ||
    !messageId ||
    metadata.observedHistoryLength > historyIndex ||
    metadata.observedHistoryLength > boundedLimit ||
    !isSubstantiveLeaderThreadAnswer(markdown) ||
    createdAt === null ||
    createdAt < 0
  ) {
    return null;
  }
  const referenced = resolveExplicitAnswerMessages(
    directMessages,
    metadata.answerUserMessageIds,
    metadata.observedHistoryLength,
    threadKey,
  );
  if (!referenced) return null;
  return {
    threadKey,
    answerUserMessageIds: [...metadata.answerUserMessageIds],
    referencedUserMessageIds: referenced.map((entry) => entry.historyMessageId),
    messageId,
    historyIndex,
    createdAt,
    source: "explicit",
  };
}

function projectCurrentAnswers(
  candidates: AnswerCandidate[],
  directMessages: readonly DirectHumanMessage[],
): LeaderThreadResponseState[] {
  const uniqueCandidates: AnswerCandidate[] = [];
  const seenMessageIds = new Set<string>();
  for (const candidate of [...candidates].sort((left, right) => left.historyIndex - right.historyIndex)) {
    if (seenMessageIds.has(candidate.messageId)) continue;
    seenMessageIds.add(candidate.messageId);
    uniqueCandidates.push(candidate);
  }

  const latestByUserMessageId = new Map<string, AnswerCandidate>();
  for (const candidate of uniqueCandidates) {
    candidate.referencedUserMessageIds.forEach((messageId) => latestByUserMessageId.set(messageId, candidate));
  }
  const conciseByHistoryId = new Map(
    directMessages.map((message) => [message.historyMessageId, message.userMessageId]),
  );

  return uniqueCandidates.flatMap((candidate) => {
    const coveredUserMessageIds = candidate.referencedUserMessageIds.filter(
      (messageId) => latestByUserMessageId.get(messageId) === candidate,
    );
    // Current coverage remains last-answer-wins per user message. Explicit
    // answers are also presentation history, so retain a structurally valid
    // row even when a later answer owns every repeated ID. Legacy revisions
    // keep their historical current-only behavior.
    if (coveredUserMessageIds.length === 0 && candidate.source !== "explicit") return [];
    const coveredAnswerUserMessageIds = coveredUserMessageIds.map((messageId) => conciseByHistoryId.get(messageId));
    if (coveredAnswerUserMessageIds.some((id) => !id)) return [];
    return [
      {
        version: LEADER_THREAD_RESPONSE_VERSION,
        threadKey: candidate.threadKey,
        ...(candidate.threadKey === "main" ? {} : { questId: candidate.threadKey }),
        answerUserMessageIds: [...candidate.answerUserMessageIds],
        referencedUserMessageIds: [...candidate.referencedUserMessageIds],
        coveredAnswerUserMessageIds: coveredAnswerUserMessageIds as string[],
        coveredUserMessageIds,
        currentMessageId: candidate.messageId,
        currentHistoryIndex: candidate.historyIndex,
        createdAt: candidate.createdAt,
        updatedAt: candidate.createdAt,
        source: candidate.source,
      },
    ];
  });
}

function evaluateResponses(
  session: Pick<LeaderThreadResponseSession, "id" | "messageHistory">,
  historyLimit = session.messageHistory.length,
): Evaluation {
  const boundedLimit = Math.max(0, Math.min(Math.floor(historyLimit), session.messageHistory.length));
  const directMessages = collectDirectMessages(session.messageHistory, boundedLimit);
  const candidates = evaluateLegacyCandidates(session, directMessages, boundedLimit);
  for (let historyIndex = 0; historyIndex < boundedLimit; historyIndex += 1) {
    const candidate = parsedExplicitCandidate(
      session.messageHistory[historyIndex]!,
      historyIndex,
      directMessages,
      boundedLimit,
    );
    if (candidate) candidates.push(candidate);
  }
  const currentAnswers = projectCurrentAnswers(candidates, directMessages).sort(
    (left, right) => left.currentHistoryIndex - right.currentHistoryIndex,
  );
  return {
    directMessages,
    currentAnswers,
    coveredMessageIds: new Set(currentAnswers.flatMap((answer) => answer.coveredUserMessageIds)),
  };
}

function projectCurrentAnswerForThread(
  answer: LeaderThreadResponseState,
  directMessagesById: ReadonlyMap<string, DirectHumanMessage>,
  threadKey: string,
): LeaderThreadResponseState | null {
  if (
    answer.coveredUserMessageIds.length !== answer.coveredAnswerUserMessageIds.length ||
    (answer.coveredUserMessageIds.length === 0 && answer.source !== "explicit")
  ) {
    return null;
  }
  if (answer.threadKey === threadKey) return answer;
  if (answer.source !== "explicit") return null;

  const referencedMessages = answer.referencedUserMessageIds.map((messageId) => directMessagesById.get(messageId));
  if (
    referencedMessages.some(
      (message) =>
        !message || message.threadKey !== answer.threadKey || !message.associatedThreadKeys.includes(threadKey),
    )
  ) {
    return null;
  }

  // One answer is an indivisible prose row. Cross-projecting only a subset of
  // its original references could expose content for an unrelated prompt even
  // if the coverage chip were narrowed, so every original reference must be
  // associated with the selected thread. Per-ID supersession still controls
  // the unchanged effective covered subset.
  return answer;
}

function buildLeaderThreadResponseStateAt(
  session: Pick<LeaderThreadResponseSession, "id" | "messageHistory">,
  requestedThreadKey: string,
  historyLimit: number,
): { projection: LeaderThreadResponseProjection; responses: LeaderThreadResponseState[] } {
  const threadKey = normalizeThreadKey(requestedThreadKey);
  const boundedLimit = Math.max(0, Math.min(Math.floor(historyLimit), session.messageHistory.length));
  const evaluation = evaluateResponses(session, boundedLimit);
  const directMessagesById = new Map(
    evaluation.directMessages.map((message) => [message.historyMessageId, message] as const),
  );
  const currentAnswers = evaluation.currentAnswers.flatMap((answer) => {
    const projected = projectCurrentAnswerForThread(answer, directMessagesById, threadKey);
    return projected ? [projected] : [];
  });
  const ownedMessages = evaluation.directMessages.filter((message) => message.threadKey === threadKey);
  const supportingMessageIds = new Set(currentAnswers.flatMap((answer) => answer.referencedUserMessageIds));
  const projectedMessages = evaluation.directMessages.filter(
    (message) => message.threadKey === threadKey || supportingMessageIds.has(message.historyMessageId),
  );
  const pendingMessages = ownedMessages
    .filter((message) => !evaluation.coveredMessageIds.has(message.historyMessageId))
    .map((message) => ({
      userMessageId: message.userMessageId,
      historyMessageId: message.historyMessageId,
      historyIndex: message.historyIndex,
      askedAt: message.timestamp,
    }));
  const projection: LeaderThreadResponseProjection = {
    version: LEADER_THREAD_RESPONSE_VERSION,
    threadKey,
    cutoverHistoryIndex: projectedMessages[0]?.historyIndex ?? session.messageHistory.length,
    pendingMessageCount: pendingMessages.length,
    pendingMessages,
    currentAnswers,
    ready: pendingMessages.length === 0,
  };
  return { projection, responses: currentAnswers };
}

export function buildLeaderThreadResponseState(
  session: Pick<LeaderThreadResponseSession, "id" | "messageHistory">,
  requestedThreadKey: string,
): { projection: LeaderThreadResponseProjection; responses: LeaderThreadResponseState[] } {
  return buildLeaderThreadResponseStateAt(session, requestedThreadKey, session.messageHistory.length);
}

export type FinalizeRoutedLeaderResponseResult =
  | { finalized: true; answerId: string }
  | {
      finalized: false;
      reason: "not_answer" | "already_finalized" | "unproven_observation" | "invalid_message" | "stale";
    };

function otherStoredAnswerUsesMessageId(
  session: LeaderThreadResponseSession,
  current: Extract<BrowserIncomingMessage, { type: "assistant" }>,
  messageId: string,
): boolean {
  return session.messageHistory.some((entry) => {
    if (entry === current || (entry.type !== "assistant" && entry.type !== "leader_user_message")) return false;
    if (responseMessageId(entry) !== messageId) return false;
    return validAnswerMetadata(entry.threadAnswer) || validLegacyRevisionMetadata(entry.threadResponse);
  });
}

export function isCurrentValidRoutedLeaderResponseMessage(
  session: LeaderThreadResponseSession,
  message: Extract<BrowserIncomingMessage, { type: "assistant" }>,
): boolean {
  const historyIndex = session.messageHistory.indexOf(message);
  if (historyIndex < 0 || !validAnswerMetadata(message.threadAnswer)) return false;
  const threadKey = exactResponseThreadKey(message);
  if (!threadKey) return false;
  return buildLeaderThreadResponseState(session, threadKey).responses.some(
    (answer) =>
      answer.coveredUserMessageIds.length > 0 &&
      answer.currentHistoryIndex === historyIndex &&
      answer.currentMessageId === message.message.id,
  );
}

export function finalizeRoutedLeaderResponseMessage(
  session: LeaderThreadResponseSession,
  message: Extract<BrowserIncomingMessage, { type: "assistant" }>,
): FinalizeRoutedLeaderResponseResult {
  if (message.leaderThreadRole !== "answer") return { finalized: false, reason: "not_answer" };
  if (validAnswerMetadata(message.threadAnswer)) return { finalized: false, reason: "already_finalized" };
  const observedHistoryLength = message.leaderAnswerObservedHistoryLength;
  if (
    !Number.isInteger(observedHistoryLength) ||
    (observedHistoryLength ?? -1) < 0 ||
    (observedHistoryLength ?? 0) > session.messageHistory.length
  ) {
    return { finalized: false, reason: "unproven_observation" };
  }
  const threadKey = exactResponseThreadKey(message);
  const markdown = responseMessageMarkdown(message);
  const messageId = responseMessageId(message);
  const historyIndex = session.messageHistory.indexOf(message);
  const answerUserMessageIds = message.leaderAnswerUserMessageIds;
  if (
    !threadKey ||
    !messageId ||
    historyIndex < observedHistoryLength! ||
    !isRootAgentHistoryMessage(message) ||
    !eligibleAssistantAnswer(message) ||
    !isSubstantiveLeaderThreadAnswer(markdown) ||
    hasThreadControlDirectives(markdown) ||
    !Array.isArray(answerUserMessageIds) ||
    answerUserMessageIds.length === 0 ||
    answerUserMessageIds.some((id) => !isCanonicalLeaderUserMessageId(id)) ||
    new Set(answerUserMessageIds).size !== answerUserMessageIds.length ||
    message.threadAnswer !== undefined ||
    otherStoredAnswerUsesMessageId(session, message, messageId)
  ) {
    return { finalized: false, reason: "invalid_message" };
  }

  const directMessages = collectDirectMessages(session.messageHistory, session.messageHistory.length);
  if (!resolveExplicitAnswerMessages(directMessages, answerUserMessageIds, observedHistoryLength!, threadKey)) {
    return { finalized: false, reason: "invalid_message" };
  }

  message.threadAnswer = {
    version: LEADER_THREAD_RESPONSE_VERSION,
    answerUserMessageIds: [...answerUserMessageIds],
    observedHistoryLength: observedHistoryLength!,
  };
  if (!isCurrentValidRoutedLeaderResponseMessage(session, message)) {
    delete message.threadAnswer;
    return { finalized: false, reason: "stale" };
  }
  return { finalized: true, answerId: messageId };
}
