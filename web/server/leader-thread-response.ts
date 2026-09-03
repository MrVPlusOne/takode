import { createHash } from "node:crypto";
import { leaderResponseOwnerThreadKey } from "../shared/leader-thread-response-routing.js";
import { normalizeSelectedFeedThreadKey } from "../shared/thread-window.js";
import { isRootAgentHistoryMessage } from "./root-agent-feed-message.js";
import { isActualHumanUserMessage } from "./user-message-classification.js";
import type {
  BrowserIncomingMessage,
  LeaderThreadPendingBatchProjection,
  LeaderThreadResponseDetail,
  LeaderThreadResponseProjection,
  LeaderThreadResponseRevision,
  LeaderThreadResponseRevisionMetadata,
  LeaderThreadResponseState,
} from "./session-types.js";
import { LEADER_THREAD_RESPONSE_VERSION } from "./leader-thread-response-types.js";

export type LeaderThreadResponseSession = {
  id: string;
  messageHistory: BrowserIncomingMessage[];
};

export interface LeaderThreadPendingBatchDetail extends LeaderThreadPendingBatchProjection {
  /** New routed-final identity. It is never accepted from a caller. */
  batchId: string;
  /** Recomputed only so already-persisted dedicated response rows remain verifiable. */
  legacyBatchId: string;
  members: Array<{
    messageId: string;
    historyIndex: number;
    timestamp: number;
    preview: string;
    truncated: boolean;
    imageCount: number;
  }>;
}

export interface LeaderThreadResponseStateDetail {
  projection: LeaderThreadResponseProjection;
  responses: LeaderThreadResponseDetail[];
  pendingBatches: LeaderThreadPendingBatchDetail[];
}

type DirectHumanMessage = {
  message: Extract<BrowserIncomingMessage, { type: "user_message" }>;
  messageId: string;
  historyIndex: number;
  timestamp: number;
  threadKey: string;
};

type ResponseHistoryMessage = Extract<BrowserIncomingMessage, { type: "assistant" | "leader_user_message" }>;

type ParsedRevision = {
  message: ResponseHistoryMessage;
  revision: LeaderThreadResponseRevision;
  metadata: LeaderThreadResponseRevisionMetadata;
  threadKey: string;
};

type CandidateResponseChain = {
  threadKey: string;
  entries: ParsedRevision[];
};

type ResponseEvaluation = {
  directMessages: DirectHumanMessage[];
  chains: CandidateResponseChain[];
  coveredMessageIds: Set<string>;
};

type PendingBatchTokenPayload = {
  v: typeof LEADER_THREAD_RESPONSE_VERSION;
  t: string;
  h: number;
  ids: string[];
};

const THREAD_ROUTE_DIRECTIVE_RE = /^\s*\[thread:/i;
const SHELL_THREAD_ROUTE_DIRECTIVE_RE = /^\s*#\s*thread:/i;
const THREAD_STATUS_DIRECTIVE_RE = /^\s*\{\[\(Thread (?:Waiting|Ready):/i;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const PREVIEW_LIMIT = 240;

export function leaderThreadResponseContentHash(markdown: string): string {
  return createHash("sha256").update(markdown).digest("hex");
}

export function normalizeLeaderThreadResponseMarkdown(markdown: string): string {
  return markdown.replace(/\r\n?/g, "\n").trim();
}

export function isSubstantiveLeaderThreadResponse(markdown: string): boolean {
  const readable = normalizeLeaderThreadResponseMarkdown(markdown)
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

function encodeLegacyPendingBatchId(sessionId: string, payload: PendingBatchTokenPayload): string {
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
    v: LEADER_THREAD_RESPONSE_VERSION,
    t: threadKey,
    h: observedHistoryLength,
    ids: [...messageIds],
  });
}

function routedPendingBatchId(
  sessionId: string,
  threadKey: string,
  observedHistoryLength: number,
  messageIds: readonly string[],
): string {
  const digest = leaderThreadResponseContentHash(
    JSON.stringify({
      v: LEADER_THREAD_RESPONSE_VERSION,
      sessionId,
      threadKey,
      observedHistoryLength,
      messageIds,
    }),
  ).slice(0, 32);
  return `routed-response-batch-v1.${digest}`;
}

function validRevisionMetadata(value: unknown): value is LeaderThreadResponseRevisionMetadata {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LeaderThreadResponseRevisionMetadata>;
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

function exactResponseThreadKey(message: ResponseHistoryMessage): string | null {
  if (typeof message.threadKey !== "string" || !message.threadKey.trim()) return null;
  const threadKey = normalizeSelectedFeedThreadKey(message.threadKey);
  if (threadKey === "main") {
    if (message.questId || (message.threadRefs?.length ?? 0) > 0) return null;
    return threadKey;
  }
  if (!/^q-\d+$/.test(threadKey) || normalizeSelectedFeedThreadKey(message.questId ?? "") !== threadKey) return null;
  if (
    message.threadRefs?.length !== 1 ||
    normalizeSelectedFeedThreadKey(message.threadRefs[0]?.threadKey ?? "") !== threadKey ||
    normalizeSelectedFeedThreadKey(message.threadRefs[0]?.questId ?? "") !== threadKey ||
    message.threadRefs[0]?.source !== "explicit"
  )
    return null;
  return threadKey;
}

function responseMessageId(message: ResponseHistoryMessage): string | null {
  const value = message.type === "assistant" ? message.message.id : message.id;
  return typeof value === "string" && value.trim() ? value : null;
}

function responseMessageMarkdown(message: ResponseHistoryMessage): string {
  if (message.type === "leader_user_message") return normalizeLeaderThreadResponseMarkdown(message.content);
  return normalizeLeaderThreadResponseMarkdown(
    message.message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n"),
  );
}

function responseMessageTimestamp(message: ResponseHistoryMessage): number | null {
  return typeof message.timestamp === "number" && Number.isFinite(message.timestamp) ? message.timestamp : null;
}

function isEligibleResponseHistoryMessage(message: ResponseHistoryMessage): boolean {
  if (message.type === "leader_user_message") return true;
  return (
    message.parent_tool_use_id === null &&
    message.leaderThreadRole === "response" &&
    !message.message.content.some((block) => block.type === "tool_use" || block.type === "tool_result")
  );
}

function parsedHistoryRevision(message: BrowserIncomingMessage, historyIndex: number): ParsedRevision | null {
  if (
    (message.type !== "leader_user_message" && message.type !== "assistant") ||
    !isRootAgentHistoryMessage(message) ||
    !isEligibleResponseHistoryMessage(message) ||
    !validRevisionMetadata(message.threadResponse)
  )
    return null;
  const threadKey = exactResponseThreadKey(message);
  const markdown = responseMessageMarkdown(message);
  const messageId = responseMessageId(message);
  const timestamp = responseMessageTimestamp(message);
  if (
    !threadKey ||
    !messageId ||
    !isSubstantiveLeaderThreadResponse(markdown) ||
    message.threadResponse.contentHash !== leaderThreadResponseContentHash(markdown) ||
    timestamp === null ||
    timestamp < 0
  )
    return null;
  const metadata = message.threadResponse;
  return {
    message,
    metadata,
    threadKey,
    revision: {
      revisionId: metadata.revisionId,
      ...(metadata.parentRevisionId ? { parentRevisionId: metadata.parentRevisionId } : {}),
      revisionNumber: metadata.revisionNumber,
      messageId,
      historyIndex,
      markdown,
      batchId: metadata.batchId,
      batchObservedHistoryLength: metadata.batchObservedHistoryLength,
      coveredUserMessageIds: [...metadata.coveredUserMessageIds],
      contentHash: metadata.contentHash,
      createdAt: timestamp,
    },
  };
}

export function leaderResponseThreadKeyForUserMessage(
  message: Extract<BrowserIncomingMessage, { type: "user_message" }>,
): string | null {
  return leaderResponseOwnerThreadKey(message);
}

function collectCoveredDirectMessages(
  history: ReadonlyArray<BrowserIncomingMessage>,
  historyLimit: number,
): DirectHumanMessage[] {
  return history.slice(0, historyLimit).flatMap((message, historyIndex) => {
    if (
      !isRootAgentHistoryMessage(message) ||
      !isActualHumanUserMessage(message) ||
      !message.id ||
      message.leaderResponseCoverageVersion !== LEADER_THREAD_RESPONSE_VERSION
    )
      return [];
    const threadKey = leaderResponseThreadKeyForUserMessage(message);
    if (!threadKey) return [];
    return [
      {
        message,
        messageId: message.id,
        historyIndex,
        timestamp: typeof message.timestamp === "number" && Number.isFinite(message.timestamp) ? message.timestamp : 0,
        threadKey,
      },
    ];
  });
}

function buildCandidateChains(parsed: ParsedRevision[]): CandidateResponseChain[] {
  const byResponseId = new Map<string, ParsedRevision[]>();
  for (const entry of parsed) {
    const existing = byResponseId.get(entry.metadata.logicalResponseId);
    if (existing) existing.push(entry);
    else byResponseId.set(entry.metadata.logicalResponseId, [entry]);
  }
  const chains: CandidateResponseChain[] = [];
  for (const candidates of byResponseId.values()) {
    const entries: ParsedRevision[] = [];
    for (const candidate of candidates) {
      const previous = entries.at(-1);
      if (!previous) {
        if (candidate.metadata.revisionNumber !== 1 || candidate.metadata.parentRevisionId) continue;
      } else if (
        candidate.threadKey !== previous.threadKey ||
        candidate.metadata.batchId !== previous.metadata.batchId ||
        candidate.metadata.batchObservedHistoryLength !== previous.metadata.batchObservedHistoryLength ||
        JSON.stringify(candidate.metadata.coveredUserMessageIds) !==
          JSON.stringify(previous.metadata.coveredUserMessageIds) ||
        candidate.metadata.revisionNumber !== previous.metadata.revisionNumber + 1 ||
        candidate.metadata.parentRevisionId !== previous.metadata.revisionId
      )
        break;
      entries.push(candidate);
    }
    if (entries.length > 0) chains.push({ threadKey: entries[0]!.threadKey, entries });
  }
  return chains.sort((left, right) => left.entries[0]!.revision.historyIndex - right.entries[0]!.revision.historyIndex);
}

function pendingBatchesForThread(
  sessionId: string,
  threadKey: string,
  evaluation: Pick<ResponseEvaluation, "directMessages" | "coveredMessageIds">,
  observedHistoryLength: number,
): LeaderThreadPendingBatchDetail[] {
  const eligible = evaluation.directMessages.filter((message) => message.threadKey === threadKey);
  const batches: DirectHumanMessage[][] = [];
  let current: DirectHumanMessage[] = [];
  for (const message of eligible) {
    if (evaluation.coveredMessageIds.has(message.messageId)) {
      if (current.length > 0) batches.push(current);
      current = [];
    } else current.push(message);
  }
  if (current.length > 0) batches.push(current);
  return batches.map((members) => {
    const userMessageIds = members.map((member) => member.messageId);
    return {
      batchId: routedPendingBatchId(sessionId, threadKey, observedHistoryLength, userMessageIds),
      legacyBatchId: legacyPendingBatchId(sessionId, threadKey, observedHistoryLength, userMessageIds),
      userMessageIds,
      messageCount: members.length,
      firstHistoryIndex: members[0]!.historyIndex,
      lastHistoryIndex: members.at(-1)!.historyIndex,
      firstAskedAt: members[0]!.timestamp,
      lastAskedAt: members.at(-1)!.timestamp,
      members: members.map((member) => {
        const preview = member.message.content.trim();
        return {
          messageId: member.messageId,
          historyIndex: member.historyIndex,
          timestamp: member.timestamp,
          preview: preview.slice(0, PREVIEW_LIMIT),
          truncated: preview.length > PREVIEW_LIMIT,
          imageCount: member.message.images?.length ?? 0,
        };
      }),
    };
  });
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function evaluateResponses(
  session: Pick<LeaderThreadResponseSession, "id" | "messageHistory">,
  historyLimit = session.messageHistory.length,
): ResponseEvaluation {
  const boundedLimit = Math.max(0, Math.min(Math.floor(historyLimit), session.messageHistory.length));
  const directMessages = collectCoveredDirectMessages(session.messageHistory, boundedLimit);
  const parsed = session.messageHistory.slice(0, boundedLimit).flatMap((message, historyIndex) => {
    const revision = parsedHistoryRevision(message, historyIndex);
    return revision ? [revision] : [];
  });
  const acceptedChains: CandidateResponseChain[] = [];
  const coveredMessageIds = new Set<string>();
  for (const chain of buildCandidateChains(parsed)) {
    const first = chain.entries[0]!;
    const observedLength = first.metadata.batchObservedHistoryLength;
    if (observedLength > first.revision.historyIndex || observedLength > boundedLimit) continue;
    const observedDirectMessages = directMessages.filter((message) => message.historyIndex < observedLength);
    const observedCoveredIds = new Set<string>();
    for (const accepted of acceptedChains) {
      if (accepted.entries[0]!.revision.historyIndex >= observedLength) continue;
      accepted.entries[0]!.metadata.coveredUserMessageIds.forEach((id) => observedCoveredIds.add(id));
    }
    const observedBatches = pendingBatchesForThread(
      session.id,
      chain.threadKey,
      { directMessages: observedDirectMessages, coveredMessageIds: observedCoveredIds },
      observedLength,
    );
    const matchedBatch = observedBatches.find(
      (batch) =>
        (batch.batchId === first.metadata.batchId || batch.legacyBatchId === first.metadata.batchId) &&
        sameIds(batch.userMessageIds, first.metadata.coveredUserMessageIds),
    );
    if (!matchedBatch || first.metadata.coveredUserMessageIds.some((id) => coveredMessageIds.has(id))) continue;
    first.metadata.coveredUserMessageIds.forEach((id) => coveredMessageIds.add(id));
    acceptedChains.push(chain);
  }
  return { directMessages, chains: acceptedChains, coveredMessageIds };
}

function responseStateFromChain(chain: CandidateResponseChain): LeaderThreadResponseState {
  const first = chain.entries[0]!;
  const latest = chain.entries.at(-1)!;
  return {
    version: LEADER_THREAD_RESPONSE_VERSION,
    logicalResponseId: latest.metadata.logicalResponseId,
    threadKey: chain.threadKey,
    ...(chain.threadKey === "main" ? {} : { questId: chain.threadKey }),
    batchId: first.metadata.batchId,
    batchObservedHistoryLength: first.metadata.batchObservedHistoryLength,
    coveredUserMessageIds: [...first.metadata.coveredUserMessageIds],
    currentRevisionId: latest.metadata.revisionId,
    currentMessageId: latest.revision.messageId,
    currentHistoryIndex: latest.revision.historyIndex,
    revisionCount: chain.entries.length,
    createdAt: first.revision.createdAt,
    updatedAt: latest.revision.createdAt,
  };
}

function responseDetailFromChain(chain: CandidateResponseChain): LeaderThreadResponseDetail {
  return { ...responseStateFromChain(chain), revisions: chain.entries.map((entry) => entry.revision) };
}

function buildLeaderThreadResponseStateAt(
  session: Pick<LeaderThreadResponseSession, "id" | "messageHistory">,
  requestedThreadKey: string,
  historyLimit: number,
): LeaderThreadResponseStateDetail {
  const threadKey = normalizeThreadKey(requestedThreadKey);
  const boundedHistoryLimit = Math.max(0, Math.min(Math.floor(historyLimit), session.messageHistory.length));
  const evaluation = evaluateResponses(session, boundedHistoryLimit);
  const responses = evaluation.chains
    .filter((chain) => chain.threadKey === threadKey)
    .map(responseDetailFromChain)
    .sort((left, right) => left.currentHistoryIndex - right.currentHistoryIndex);
  const pendingBatches = pendingBatchesForThread(session.id, threadKey, evaluation, boundedHistoryLimit);
  const eligible = evaluation.directMessages.filter((message) => message.threadKey === threadKey);
  const projection: LeaderThreadResponseProjection = {
    version: LEADER_THREAD_RESPONSE_VERSION,
    threadKey,
    cutoverHistoryIndex: eligible[0]?.historyIndex ?? session.messageHistory.length,
    pendingMessageCount: pendingBatches.reduce((count, batch) => count + batch.messageCount, 0),
    pendingBatches: pendingBatches.map(
      ({ members: _members, batchId: _batchId, legacyBatchId: _legacyBatchId, ...batch }) => batch,
    ),
    currentResponses: responses.map(({ revisions: _revisions, ...response }) => response),
    ready: pendingBatches.length === 0,
  };
  return { projection, responses, pendingBatches };
}

export function buildLeaderThreadResponseState(
  session: Pick<LeaderThreadResponseSession, "id" | "messageHistory">,
  requestedThreadKey: string,
): LeaderThreadResponseStateDetail {
  return buildLeaderThreadResponseStateAt(session, requestedThreadKey, session.messageHistory.length);
}

export type FinalizeRoutedLeaderResponseResult =
  | { finalized: true; responseId: string; revisionId: string }
  | {
      finalized: false;
      reason: "not_response" | "already_finalized" | "unproven_observation" | "invalid_message" | "stale";
    };

export function isCurrentValidRoutedLeaderResponseMessage(
  session: LeaderThreadResponseSession,
  message: Extract<BrowserIncomingMessage, { type: "assistant" }>,
): boolean {
  const historyIndex = session.messageHistory.indexOf(message);
  if (historyIndex < 0) return false;
  const parsed = parsedHistoryRevision(message, historyIndex);
  if (!parsed) return false;
  return buildLeaderThreadResponseState(session, parsed.threadKey).responses.some(
    (response) =>
      response.currentHistoryIndex === historyIndex &&
      response.currentMessageId === parsed.revision.messageId &&
      response.currentRevisionId === parsed.metadata.revisionId &&
      response.logicalResponseId === parsed.metadata.logicalResponseId,
  );
}

function routedLogicalResponseId(sessionId: string, messageId: string, batchId: string): string {
  return `routed-response-${leaderThreadResponseContentHash(`${sessionId}\n${messageId}\n${batchId}`).slice(0, 24)}`;
}

function routedRevisionId(logicalResponseId: string, revisionNumber: number, messageId: string): string {
  const messageDigest = leaderThreadResponseContentHash(messageId).slice(0, 12);
  return `${logicalResponseId}-r${revisionNumber}-${messageDigest}`;
}

function pendingBatchesObservedByResponse(
  session: LeaderThreadResponseSession,
  threadKey: string,
  observedHistoryLength: number,
): LeaderThreadPendingBatchDetail[] {
  const current = evaluateResponses(session);
  return pendingBatchesForThread(
    session.id,
    threadKey,
    {
      directMessages: collectCoveredDirectMessages(session.messageHistory, observedHistoryLength),
      coveredMessageIds: current.coveredMessageIds,
    },
    observedHistoryLength,
  );
}

function latestResponseObservedByTurn(
  session: LeaderThreadResponseSession,
  threadKey: string,
  observedHistoryLength: number,
): LeaderThreadResponseDetail | null {
  const observedMessageIds = new Set(
    collectCoveredDirectMessages(session.messageHistory, observedHistoryLength)
      .filter((message) => message.threadKey === threadKey)
      .map((message) => message.messageId),
  );
  return (
    buildLeaderThreadResponseState(session, threadKey).responses.findLast((response) =>
      response.coveredUserMessageIds.every((messageId) => observedMessageIds.has(messageId)),
    ) ?? null
  );
}

export function finalizeRoutedLeaderResponseMessage(
  session: LeaderThreadResponseSession,
  message: Extract<BrowserIncomingMessage, { type: "assistant" }>,
): FinalizeRoutedLeaderResponseResult {
  if (message.leaderThreadRole !== "response") return { finalized: false, reason: "not_response" };
  if (validRevisionMetadata(message.threadResponse)) return { finalized: false, reason: "already_finalized" };
  const observedHistoryLength = message.leaderResponseObservedHistoryLength;
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
  if (
    !threadKey ||
    !messageId ||
    historyIndex < observedHistoryLength! ||
    !isRootAgentHistoryMessage(message) ||
    !isEligibleResponseHistoryMessage(message) ||
    !isSubstantiveLeaderThreadResponse(markdown) ||
    hasThreadControlDirectives(markdown)
  ) {
    return { finalized: false, reason: "invalid_message" };
  }
  if (message.threadResponse !== undefined) return { finalized: false, reason: "invalid_message" };

  const currentBefore = buildLeaderThreadResponseState(session, threadKey);
  if (
    currentBefore.responses.some((response) => response.revisions.some((revision) => revision.messageId === messageId))
  ) {
    return { finalized: false, reason: "already_finalized" };
  }

  const observedBatch = pendingBatchesObservedByResponse(session, threadKey, observedHistoryLength!)[0];
  let logicalResponseId: string;
  let batchId: string;
  let batchObservedHistoryLength: number;
  let coveredUserMessageIds: string[];
  let parentRevisionId: string | undefined;
  let revisionNumber: number;

  if (observedBatch) {
    logicalResponseId = routedLogicalResponseId(session.id, messageId, observedBatch.batchId);
    batchId = observedBatch.batchId;
    batchObservedHistoryLength = observedHistoryLength!;
    coveredUserMessageIds = [...observedBatch.userMessageIds];
    revisionNumber = 1;
  } else {
    const currentResponse = latestResponseObservedByTurn(session, threadKey, observedHistoryLength!);
    if (!currentResponse) return { finalized: false, reason: "invalid_message" };
    logicalResponseId = currentResponse.logicalResponseId;
    batchId = currentResponse.batchId;
    batchObservedHistoryLength = currentResponse.batchObservedHistoryLength;
    coveredUserMessageIds = [...currentResponse.coveredUserMessageIds];
    parentRevisionId = currentResponse.currentRevisionId;
    revisionNumber = currentResponse.revisionCount + 1;
  }

  const revisionId = routedRevisionId(logicalResponseId, revisionNumber, messageId);
  message.threadResponse = {
    logicalResponseId,
    revisionId,
    ...(parentRevisionId ? { parentRevisionId } : {}),
    revisionNumber,
    batchId,
    batchObservedHistoryLength,
    coveredUserMessageIds,
    contentHash: leaderThreadResponseContentHash(markdown),
  };
  const finalizedState = buildLeaderThreadResponseState(session, threadKey);
  const finalizedResponse = finalizedState.responses.find(
    (response) =>
      response.logicalResponseId === logicalResponseId &&
      response.currentRevisionId === revisionId &&
      response.currentMessageId === messageId,
  );
  if (!finalizedResponse) {
    delete message.threadResponse;
    return { finalized: false, reason: "stale" };
  }
  return { finalized: true, responseId: logicalResponseId, revisionId };
}

export function currentLeaderThreadResponseMessage(
  history: ReadonlyArray<BrowserIncomingMessage>,
  response: LeaderThreadResponseState,
): ResponseHistoryMessage | null {
  const candidate = history[response.currentHistoryIndex];
  const parsed = candidate ? parsedHistoryRevision(candidate, response.currentHistoryIndex) : null;
  return parsed &&
    parsed.threadKey === response.threadKey &&
    parsed.metadata.logicalResponseId === response.logicalResponseId &&
    parsed.metadata.revisionId === response.currentRevisionId &&
    parsed.revision.messageId === response.currentMessageId
    ? parsed.message
    : null;
}
