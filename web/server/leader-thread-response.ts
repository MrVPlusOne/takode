import { createHash, randomBytes } from "node:crypto";
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
  ThreadRef,
} from "./session-types.js";
import { LEADER_THREAD_RESPONSE_VERSION } from "./leader-thread-response-types.js";

export type LeaderThreadResponseSession = {
  id: string;
  messageHistory: BrowserIncomingMessage[];
};

export type PublishLeaderThreadResponseInput =
  | {
      intent: "create";
      threadKey: string;
      pendingBatchToken: string;
      baseRevisionId: null;
      markdown: string;
      idempotencyKey?: string;
    }
  | {
      intent: "revise";
      threadKey: string;
      responseId: string;
      baseRevisionId: string;
      markdown: string;
      idempotencyKey?: string;
    };

export interface LeaderThreadPendingBatchDetail extends LeaderThreadPendingBatchProjection {
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

export type PublishLeaderThreadResponseResult = {
  created: boolean;
  message: Extract<BrowserIncomingMessage, { type: "leader_user_message" }>;
  response: LeaderThreadResponseDetail;
  responseState: LeaderThreadResponseStateDetail;
};

type DirectHumanMessage = {
  message: Extract<BrowserIncomingMessage, { type: "user_message" }>;
  messageId: string;
  historyIndex: number;
  timestamp: number;
  threadKey: string;
};

type ParsedRevision = {
  message: Extract<BrowserIncomingMessage, { type: "leader_user_message" }>;
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

const THREAD_ROUTE_DIRECTIVE_RE = /^\s*\[thread:(?:main|q-\d+)\]/i;
const SHELL_THREAD_ROUTE_DIRECTIVE_RE = /^\s*#\s*thread:(?:main|q-\d+)\b/i;
const THREAD_STATUS_DIRECTIVE_RE = /^\s*\{\[\(Thread (?:Waiting|Ready):/i;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const PREVIEW_LIMIT = 240;

export class LeaderThreadResponseConflictError extends Error {
  constructor(
    readonly currentRevisionId: string | null,
    message?: string,
  ) {
    super(
      message ??
        (currentRevisionId
          ? `Thread response changed; retry against current revision ${currentRevisionId}.`
          : "Thread response changed; retry against the current empty state."),
    );
    this.name = "LeaderThreadResponseConflictError";
  }
}

export class LeaderThreadResponseIdempotencyConflictError extends Error {
  constructor() {
    super("Thread response idempotency key was already used for a different request.");
    this.name = "LeaderThreadResponseIdempotencyConflictError";
  }
}

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

function assertNoThreadControlDirectives(markdown: string): void {
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
      throw new Error("Thread response content cannot contain routing or Thread Waiting/Ready directives.");
    }
  }
}

function normalizeThreadKey(value: string): string {
  const threadKey = normalizeSelectedFeedThreadKey(value);
  if (threadKey !== "main" && !/^q-\d+$/.test(threadKey)) throw new Error("threadKey must be main or q-N.");
  return threadKey;
}

function normalizedIdempotencyKey(value: string | undefined): string | undefined {
  const key = value?.trim();
  if (!key) return undefined;
  if (key.length > 200) throw new Error("idempotencyKey must be 200 characters or fewer.");
  return key;
}

function requestIdempotencyHash(input: PublishLeaderThreadResponseInput, markdown: string): string {
  return leaderThreadResponseContentHash(
    JSON.stringify({
      intent: input.intent,
      threadKey: normalizeSelectedFeedThreadKey(input.threadKey),
      baseRevisionId: input.baseRevisionId,
      ...(input.intent === "create"
        ? { pendingBatchToken: input.pendingBatchToken }
        : { responseId: input.responseId }),
      markdown,
    }),
  );
}

function encodePendingBatchToken(sessionId: string, payload: PendingBatchTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const checksum = leaderThreadResponseContentHash(`${sessionId}\n${encoded}`).slice(0, 24);
  return `response-batch-v1.${encoded}.${checksum}`;
}

function decodePendingBatchToken(sessionId: string, token: string): PendingBatchTokenPayload | null {
  const match = /^response-batch-v1\.([A-Za-z0-9_-]+)\.([0-9a-f]{24})$/.exec(token);
  if (!match) return null;
  const [, encoded, checksum] = match;
  if (leaderThreadResponseContentHash(`${sessionId}\n${encoded}`).slice(0, 24) !== checksum) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(encoded!, "base64url").toString("utf8"),
    ) as Partial<PendingBatchTokenPayload>;
    if (
      payload.v !== LEADER_THREAD_RESPONSE_VERSION ||
      typeof payload.t !== "string" ||
      !Number.isInteger(payload.h) ||
      (payload.h ?? -1) < 0 ||
      !Array.isArray(payload.ids) ||
      payload.ids.length === 0 ||
      !payload.ids.every((id) => typeof id === "string" && id.length > 0) ||
      new Set(payload.ids).size !== payload.ids.length
    )
      return null;
    return { v: LEADER_THREAD_RESPONSE_VERSION, t: payload.t, h: payload.h!, ids: [...payload.ids] };
  } catch {
    return null;
  }
}

function pendingBatchToken(
  sessionId: string,
  threadKey: string,
  observedHistoryLength: number,
  messageIds: readonly string[],
): string {
  return encodePendingBatchToken(sessionId, {
    v: LEADER_THREAD_RESPONSE_VERSION,
    t: threadKey,
    h: observedHistoryLength,
    ids: [...messageIds],
  });
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

function exactResponseThreadKey(
  message: Extract<BrowserIncomingMessage, { type: "leader_user_message" }>,
): string | null {
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

function parsedHistoryRevision(message: BrowserIncomingMessage, historyIndex: number): ParsedRevision | null {
  if (
    message.type !== "leader_user_message" ||
    !isRootAgentHistoryMessage(message) ||
    !validRevisionMetadata(message.threadResponse)
  )
    return null;
  const threadKey = exactResponseThreadKey(message);
  const markdown = normalizeLeaderThreadResponseMarkdown(message.content);
  if (
    !threadKey ||
    !message.id ||
    !isSubstantiveLeaderThreadResponse(markdown) ||
    message.threadResponse.contentHash !== leaderThreadResponseContentHash(markdown) ||
    !Number.isFinite(message.timestamp) ||
    message.timestamp < 0
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
      messageId: message.id,
      historyIndex,
      markdown,
      batchId: metadata.batchId,
      batchObservedHistoryLength: metadata.batchObservedHistoryLength,
      coveredUserMessageIds: [...metadata.coveredUserMessageIds],
      contentHash: metadata.contentHash,
      createdAt: message.timestamp,
      ...(metadata.idempotencyKey ? { idempotencyKey: metadata.idempotencyKey } : {}),
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
  return batches.map((members) => ({
    token: pendingBatchToken(
      sessionId,
      threadKey,
      observedHistoryLength,
      members.map((member) => member.messageId),
    ),
    userMessageIds: members.map((member) => member.messageId),
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
  }));
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
        batch.token === first.metadata.batchId && sameIds(batch.userMessageIds, first.metadata.coveredUserMessageIds),
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

export function buildLeaderThreadResponseState(
  session: Pick<LeaderThreadResponseSession, "id" | "messageHistory">,
  requestedThreadKey: string,
): LeaderThreadResponseStateDetail {
  const threadKey = normalizeThreadKey(requestedThreadKey);
  const evaluation = evaluateResponses(session);
  const responses = evaluation.chains
    .filter((chain) => chain.threadKey === threadKey)
    .map(responseDetailFromChain)
    .sort((left, right) => left.currentHistoryIndex - right.currentHistoryIndex);
  const pendingBatches = pendingBatchesForThread(session.id, threadKey, evaluation, session.messageHistory.length);
  const eligible = evaluation.directMessages.filter((message) => message.threadKey === threadKey);
  const projection: LeaderThreadResponseProjection = {
    version: LEADER_THREAD_RESPONSE_VERSION,
    threadKey,
    cutoverHistoryIndex: eligible[0]?.historyIndex ?? session.messageHistory.length,
    pendingMessageCount: pendingBatches.reduce((count, batch) => count + batch.messageCount, 0),
    pendingBatches: pendingBatches.map(({ members: _members, ...batch }) => batch),
    currentResponses: responses.map(({ revisions: _revisions, ...response }) => response),
    ready: pendingBatches.length === 0,
  };
  return { projection, responses, pendingBatches };
}

export function currentLeaderThreadResponseMessage(
  history: ReadonlyArray<BrowserIncomingMessage>,
  response: LeaderThreadResponseState,
): Extract<BrowserIncomingMessage, { type: "leader_user_message" }> | null {
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

function resolveObservedPendingBatch(
  session: LeaderThreadResponseSession,
  threadKey: string,
  token: string,
): LeaderThreadPendingBatchDetail | null {
  const payload = decodePendingBatchToken(session.id, token);
  if (!payload || payload.t !== threadKey || payload.h > session.messageHistory.length) return null;
  const observed = evaluateResponses(session, payload.h);
  const observedBatch = pendingBatchesForThread(session.id, threadKey, observed, payload.h).find(
    (batch) => batch.token === token && sameIds(batch.userMessageIds, payload.ids),
  );
  if (!observedBatch) return null;
  const current = buildLeaderThreadResponseState(session, threadKey);
  const currentBatch = current.pendingBatches.find(
    (batch) =>
      batch.userMessageIds.length >= payload.ids.length &&
      sameIds(batch.userMessageIds.slice(0, payload.ids.length), payload.ids),
  );
  if (!currentBatch) return null;
  return observedBatch;
}

function findIdempotentRevision(session: LeaderThreadResponseSession, key: string): ParsedRevision | null {
  for (let historyIndex = 0; historyIndex < session.messageHistory.length; historyIndex += 1) {
    const parsed = parsedHistoryRevision(session.messageHistory[historyIndex]!, historyIndex);
    if (parsed?.metadata.idempotencyKey === key) return parsed;
  }
  return null;
}

export function publishLeaderThreadResponse(
  session: LeaderThreadResponseSession,
  input: PublishLeaderThreadResponseInput,
  options: { now?: number; randomSuffix?: string } = {},
): PublishLeaderThreadResponseResult {
  const threadKey = normalizeThreadKey(input.threadKey);
  const markdown = normalizeLeaderThreadResponseMarkdown(input.markdown);
  assertNoThreadControlDirectives(markdown);
  if (!isSubstantiveLeaderThreadResponse(markdown)) {
    throw new Error("Thread response must contain substantive renderable Markdown.");
  }
  const idempotencyKey = normalizedIdempotencyKey(input.idempotencyKey);
  const idempotencyHash = requestIdempotencyHash(input, markdown);
  if (idempotencyKey) {
    const duplicate = findIdempotentRevision(session, idempotencyKey);
    if (duplicate) {
      if (duplicate.metadata.idempotencyHash !== idempotencyHash) {
        throw new LeaderThreadResponseIdempotencyConflictError();
      }
      const responseState = buildLeaderThreadResponseState(session, threadKey);
      const response = responseState.responses.find(
        (candidate) => candidate.logicalResponseId === duplicate.metadata.logicalResponseId,
      );
      if (!response) throw new Error("Thread response history is inconsistent.");
      return { created: false, message: duplicate.message, response, responseState };
    }
  }

  const before = buildLeaderThreadResponseState(session, threadKey);
  let logicalResponseId: string;
  let batchId: string;
  let batchObservedHistoryLength: number;
  let coveredUserMessageIds: string[];
  let parentRevisionId: string | undefined;
  let revisionNumber: number;
  if (input.intent === "create") {
    if (input.baseRevisionId !== null) throw new Error("Creating a response requires baseRevisionId null.");
    const batch = resolveObservedPendingBatch(session, threadKey, input.pendingBatchToken);
    if (!batch) {
      throw new LeaderThreadResponseConflictError(
        null,
        "Pending response batch changed or is no longer an uncovered prefix; refresh before creating the response.",
      );
    }
    const payload = decodePendingBatchToken(session.id, batch.token)!;
    const now = options.now ?? Date.now();
    const suffix = options.randomSuffix ?? randomBytes(4).toString("hex");
    logicalResponseId = `thread-response-${now}-${suffix}`;
    batchId = batch.token;
    batchObservedHistoryLength = payload.h;
    coveredUserMessageIds = [...batch.userMessageIds];
    revisionNumber = 1;
  } else {
    const current = before.responses.find((response) => response.logicalResponseId === input.responseId);
    if (!current) throw new Error("Thread response was not found in the requested thread.");
    if (input.baseRevisionId !== current.currentRevisionId) {
      throw new LeaderThreadResponseConflictError(current.currentRevisionId);
    }
    logicalResponseId = current.logicalResponseId;
    batchId = current.batchId;
    batchObservedHistoryLength = current.batchObservedHistoryLength;
    coveredUserMessageIds = [...current.coveredUserMessageIds];
    parentRevisionId = current.currentRevisionId;
    revisionNumber = current.revisionCount + 1;
  }

  const now = options.now ?? Date.now();
  const revisionId = `${logicalResponseId}-r${revisionNumber}`;
  const messageId = `${revisionId}-${session.messageHistory.length}`;
  const contentHash = leaderThreadResponseContentHash(markdown);
  const metadata: LeaderThreadResponseRevisionMetadata = {
    logicalResponseId,
    revisionId,
    ...(parentRevisionId ? { parentRevisionId } : {}),
    revisionNumber,
    batchId,
    batchObservedHistoryLength,
    coveredUserMessageIds,
    contentHash,
    ...(idempotencyKey ? { idempotencyKey, idempotencyHash } : {}),
  };
  const threadRefs: ThreadRef[] | undefined =
    threadKey === "main" ? undefined : [{ threadKey, questId: threadKey, source: "explicit" }];
  const message: Extract<BrowserIncomingMessage, { type: "leader_user_message" }> = {
    type: "leader_user_message",
    id: messageId,
    content: markdown,
    timestamp: now,
    threadKey,
    ...(threadKey === "main" ? {} : { questId: threadKey }),
    ...(threadRefs ? { threadRefs } : {}),
    threadResponse: metadata,
  };
  session.messageHistory.push(message);
  const responseState = buildLeaderThreadResponseState(session, threadKey);
  const response = responseState.responses.find((candidate) => candidate.logicalResponseId === logicalResponseId);
  if (!response) throw new Error("Failed to publish thread response.");
  return { created: true, message, response, responseState };
}
