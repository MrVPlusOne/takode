import type {
  ActiveTurnRoute,
  BrowserIncomingMessage,
  PendingCodexInput,
  SessionNotification,
} from "./session-types.js";
import { isActualHumanUserMessage } from "./user-message-classification.js";
import { MAIN_THREAD_KEY, normalizeSelectedFeedThreadKey } from "../shared/thread-window.js";
import { authoritativeMessageOwner, type AuthoritativeMessageOwner } from "./authoritative-message-owner.js";
import { isRootAgentHistoryMessage } from "./root-agent-feed-message.js";

export const RECENT_ASK_BUNDLE_LIMIT = 50;
const MEMBER_PREVIEW_LIMIT = 520;
const RESPONSE_PREVIEW_LIMIT = 260;

export type RecentAskBundleStatus =
  | "awaiting_response"
  | "queued"
  | "working"
  | "needs_input"
  | "thread_needs_input"
  | "response_unread"
  | "responded"
  | "caught_up"
  | "retrying"
  | "failed"
  | "interrupted"
  | "completed";

export type RecentAskFilter = "all" | "needs_me" | "new_response" | "active";

export interface RecentAskMember {
  messageId: string;
  historyIndex: number;
  timestamp: number;
  preview: string;
  truncated: boolean;
  imageCount: number;
}

export interface RecentAskResponsePreview {
  messageId: string;
  historyIndex: number;
  timestamp: number;
  preview: string;
  truncated: boolean;
}

export interface RecentAskBundle {
  id: string;
  sessionId: string;
  sessionNum: number | null;
  sessionName: string;
  sessionState?: "starting" | "connected" | "running" | "exited";
  archived: boolean;
  archivedAt?: number;
  sessionSpaceId: string;
  sessionSpaceName: string;
  ownerThreadKey: string;
  questId?: string;
  questTitle?: string;
  questStatus?: string;
  firstAskedAt: number;
  lastAskedAt: number;
  members: RecentAskMember[];
  response?: RecentAskResponsePreview;
  status: RecentAskBundleStatus;
  statusDetail?: string;
}

export interface RecentAskQuestSummary {
  questId: string;
  title: string;
  status: string;
}

export interface RecentAskSessionDocument {
  sessionId: string;
  sessionNum: number | null;
  sessionName: string;
  sessionState?: "starting" | "connected" | "running" | "exited";
  archived: boolean;
  archivedAt?: number;
  sessionSpaceId: string;
  sessionSpaceName: string;
  messageHistory: ReadonlyArray<BrowserIncomingMessage>;
  notifications?: ReadonlyArray<SessionNotification>;
  isGenerating?: boolean;
  activeTurnRoute?: ActiveTurnRoute | null;
  userMessageIdsThisTurn?: ReadonlyArray<number>;
  queuedTurnUserMessageIds?: ReadonlyArray<ReadonlyArray<number>>;
  pendingCodexInputs?: ReadonlyArray<PendingCodexInput>;
  isOrchestrator: boolean;
}

export interface BuildRecentAskBundlesInput {
  documents: RecentAskSessionDocument[];
  quests?: ReadonlyMap<string, RecentAskQuestSummary>;
  query?: string;
  filter?: RecentAskFilter;
  sessionSpaceId?: string;
  limit?: number;
  omittedSearchOnlySessions?: number;
}

export interface RecentAskBundlesResponse {
  groups: RecentAskBundle[];
  totalMatches: number;
  totalRecentGroups: number;
  limit: number;
  query: string;
  filter: RecentAskFilter;
  sessionSpaceId: string | null;
  attentionCount: number;
  sessionSpaces: Array<{ id: string; name: string; count: number }>;
  coverageNotice?: string;
  tookMs: number;
}

export interface RecentAskVisibleResponseSession {
  activeTurnRoute?: ActiveTurnRoute | null;
  recentAskVisibleResponseThreads?: Set<string>;
}

export function markRecentAskVisibleResponseFromStream(
  session: RecentAskVisibleResponseSession,
  message: Pick<BrowserIncomingMessage, "type" | "threadKey" | "questId"> & {
    parent_tool_use_id?: string | null;
    event?: unknown;
  },
): boolean {
  if (message.type !== "stream_event" || message.parent_tool_use_id != null) return false;
  const event = message.event as { type?: unknown; delta?: { type?: unknown; text?: unknown } };
  if (event?.type !== "content_block_delta" || event.delta?.type !== "text_delta") return false;
  if (typeof event.delta.text !== "string" || !event.delta.text.trim()) return false;
  const rawThreadKey =
    message.threadKey ||
    message.questId ||
    session.activeTurnRoute?.threadKey ||
    session.activeTurnRoute?.questId ||
    MAIN_THREAD_KEY;
  const threadKey = normalizeSelectedFeedThreadKey(rawThreadKey) || MAIN_THREAD_KEY;
  (session.recentAskVisibleResponseThreads ??= new Set()).add(threadKey);
  return true;
}

export function consumeRecentAskVisibleResponseBoundary(
  session: RecentAskVisibleResponseSession,
  threadKey: string,
): boolean {
  const normalized = normalizeSelectedFeedThreadKey(threadKey) || MAIN_THREAD_KEY;
  const threads = session.recentAskVisibleResponseThreads;
  if (!threads?.has(normalized)) return false;
  threads.delete(normalized);
  return true;
}

export function clearRecentAskVisibleResponseBoundaries(session: RecentAskVisibleResponseSession): void {
  session.recentAskVisibleResponseThreads?.clear();
}

interface MutableBundle extends RecentAskBundle {
  closed: boolean;
  terminalStatus?: RecentAskBundleStatus;
}

interface RecentDestinationProjection {
  bundle: RecentAskBundle;
  statusFacets: Set<RecentAskBundleStatus>;
}

interface StatusEvidence {
  status: RecentAskBundleStatus;
  timestamp: number;
  statusDetail?: string;
  response?: RecentAskResponsePreview;
}

const STATUS_BADGE_PRIORITY: Record<RecentAskBundleStatus, number> = {
  needs_input: 120,
  thread_needs_input: 119,
  response_unread: 110,
  failed: 100,
  interrupted: 90,
  retrying: 80,
  working: 70,
  queued: 60,
  awaiting_response: 50,
  completed: 40,
  responded: 30,
  caught_up: 20,
};

export function buildRecentAskBundles(input: BuildRecentAskBundlesInput): RecentAskBundlesResponse {
  const startedAt = Date.now();
  const limit = clampInteger(input.limit, RECENT_ASK_BUNDLE_LIMIT, 1, RECENT_ASK_BUNDLE_LIMIT);
  const filter = normalizeFilter(input.filter);
  const recentDestinations = input.documents
    .flatMap((document) => buildSessionDestinations(document))
    .map((destination) => enrichDestination(destination, input.quests))
    .sort((left, right) => compareBundleRecency(left.bundle, right.bundle))
    .slice(0, limit);
  const allGroups = recentDestinations.map((destination) => destination.bundle);
  const sessionSpaces = summarizeSessionSpaces(allGroups);
  const filtered = recentDestinations
    .filter((destination) => {
      if (input.sessionSpaceId && destination.bundle.sessionSpaceId !== input.sessionSpaceId) return false;
      return matchesFilter(destination.statusFacets, filter);
    })
    .map((destination) => destination.bundle);

  return {
    groups: filtered,
    totalMatches: filtered.length,
    totalRecentGroups: allGroups.length,
    limit,
    query: "",
    filter,
    sessionSpaceId: input.sessionSpaceId || null,
    attentionCount: recentDestinations.filter((destination) => hasAttentionFacet(destination.statusFacets)).length,
    sessionSpaces,
    ...(input.omittedSearchOnlySessions
      ? {
          coverageNotice:
            "Some archived sessions are available only through Search because their compact excerpts lack trustworthy human and thread provenance.",
        }
      : {}),
    tookMs: Date.now() - startedAt,
  };
}

function buildSessionDestinations(document: RecentAskSessionDocument): RecentDestinationProjection[] {
  const bundles = buildSessionBundles(document);
  const byOwner = new Map<string, MutableBundle[]>();
  for (const bundle of bundles) {
    const existing = byOwner.get(bundle.ownerThreadKey) ?? [];
    existing.push(bundle);
    byOwner.set(bundle.ownerThreadKey, existing);
  }

  return [...byOwner.values()].map((ownerBundles) => collapseDestination(document, ownerBundles));
}

function collapseDestination(
  document: RecentAskSessionDocument,
  ownerBundles: MutableBundle[],
): RecentDestinationProjection {
  const latestBundle = ownerBundles.reduce((latest, candidate) =>
    latestMember(candidate).historyIndex > latestMember(latest).historyIndex ? candidate : latest,
  );
  const newestMember = latestMember(latestBundle);
  const evidence: StatusEvidence[] = [statusEvidenceFromBundle(latestBundle, document.notifications ?? [])];

  appendNotificationEvidence(document, latestBundle.ownerThreadKey, newestMember.timestamp, ownerBundles, evidence);

  const primary = evidence.reduce((current, candidate) =>
    compareStatusEvidence(candidate, current) > 0 ? candidate : current,
  );
  const statusFacets = new Set(evidence.map((item) => item.status));
  const bundle: RecentAskBundle = {
    ...latestBundle,
    id: `${document.sessionId}:${latestBundle.ownerThreadKey}`,
    firstAskedAt: newestMember.timestamp,
    lastAskedAt: newestMember.timestamp,
    members: [newestMember],
    status: primary.status,
  };

  if (primary.statusDetail) bundle.statusDetail = primary.statusDetail;
  else delete bundle.statusDetail;
  const primaryResponse = primary.response ?? (!isAttentionStatus(primary.status) ? latestBundle.response : undefined);
  if (primaryResponse) bundle.response = primaryResponse;
  else delete bundle.response;

  return { bundle: stripMutableFields(bundle as MutableBundle), statusFacets };
}

function latestMember(bundle: RecentAskBundle): RecentAskMember {
  return bundle.members.reduce((latest, candidate) =>
    candidate.historyIndex > latest.historyIndex ? candidate : latest,
  );
}

function statusEvidenceFromBundle(
  bundle: RecentAskBundle,
  notifications: ReadonlyArray<SessionNotification>,
): StatusEvidence {
  const status = hasResolvedReceipt(bundle, notifications) ? "caught_up" : bundle.status;
  return {
    status,
    timestamp: bundle.lastAskedAt,
    ...(bundle.statusDetail ? { statusDetail: bundle.statusDetail } : {}),
    ...(bundle.response ? { response: bundle.response } : {}),
  };
}

function hasResolvedReceipt(bundle: RecentAskBundle, notifications: ReadonlyArray<SessionNotification>): boolean {
  if (bundle.status !== "responded" || !bundle.response) return false;
  return notifications.some(
    (notification) =>
      notification.done &&
      notification.messageId === bundle.response?.messageId &&
      (notification.category === "review" || notification.category === "needs-input"),
  );
}

function appendNotificationEvidence(
  document: RecentAskSessionDocument,
  ownerThreadKey: string,
  newestMemberTimestamp: number,
  ownerBundles: RecentAskBundle[],
  evidence: StatusEvidence[],
): void {
  for (const notification of document.notifications ?? []) {
    if (
      notification.done ||
      notification.muted ||
      notificationOwner(document, notification).threadKey !== ownerThreadKey
    ) {
      continue;
    }
    const response = responseForNotification(document, ownerBundles, notification.messageId, ownerThreadKey);
    if (notification.category === "needs-input") {
      if (!response && safeTimestamp(notification.timestamp, 0) < newestMemberTimestamp) continue;
      evidence.push({
        status: response ? "needs_input" : "thread_needs_input",
        timestamp: safeTimestamp(notification.timestamp, 0),
        ...(notification.summary ? { statusDetail: notification.summary } : {}),
        ...(response ? { response } : {}),
      });
    } else if (notification.category === "review" && response) {
      evidence.push({
        status: "response_unread",
        timestamp: safeTimestamp(notification.timestamp, 0),
        ...(notification.summary ? { statusDetail: notification.summary } : {}),
        response,
      });
    }
  }
}

function responseForNotification(
  document: RecentAskSessionDocument,
  ownerBundles: RecentAskBundle[],
  messageId: string | null,
  ownerThreadKey: string,
): RecentAskResponsePreview | undefined {
  if (!messageId) return undefined;
  const bundled = ownerBundles.find((bundle) => bundle.response?.messageId === messageId)?.response;
  if (bundled) return bundled;
  for (let index = document.messageHistory.length - 1; index >= 0; index -= 1) {
    const message = document.messageHistory[index]!;
    if (!isRootAgentHistoryMessage(message) || visibleResponseMessageId(message) !== messageId) continue;
    if (messageOwner(document, message).threadKey !== ownerThreadKey) return undefined;
    return visibleResponse(message, index) ?? undefined;
  }
  return undefined;
}

function visibleResponseMessageId(message: BrowserIncomingMessage): string | undefined {
  if (message.type === "leader_user_message") return message.id;
  if (message.type === "assistant" && message.parent_tool_use_id == null) return message.message.id;
  return undefined;
}

function compareStatusEvidence(left: StatusEvidence, right: StatusEvidence): number {
  return (
    STATUS_BADGE_PRIORITY[left.status] - STATUS_BADGE_PRIORITY[right.status] ||
    left.timestamp - right.timestamp ||
    left.status.localeCompare(right.status)
  );
}

function enrichDestination(
  destination: RecentDestinationProjection,
  quests: ReadonlyMap<string, RecentAskQuestSummary> | undefined,
): RecentDestinationProjection {
  const bundle = enrichQuest(destination.bundle, quests);
  destination.statusFacets.add(bundle.status);
  return { bundle, statusFacets: destination.statusFacets };
}

function buildSessionBundles(document: RecentAskSessionDocument): MutableBundle[] {
  const groups: MutableBundle[] = [];
  const lastBundleByThread = new Map<string, MutableBundle>();
  let open: MutableBundle | null = null;

  const startIndex = recentHistoryStartIndex(document, RECENT_ASK_BUNDLE_LIMIT);
  for (let index = startIndex; index < document.messageHistory.length; index += 1) {
    const message = document.messageHistory[index]!;
    if (!isRootAgentHistoryMessage(message)) continue;
    if (isActualHumanUserMessage(message)) {
      const owner = messageOwner(document, message);
      const messageId = message.id;
      if (!messageId) continue;
      const humanMessage = { ...message, id: messageId };
      const forceBoundary = message.recentAskBoundaryBefore === "visible_response";
      if (!open || open.closed || open.ownerThreadKey !== owner.threadKey || forceBoundary) {
        if (open && !open.closed) open.closed = true;
        open = createBundle(document, humanMessage, index, owner.threadKey, owner.questId);
        groups.push(open);
      } else {
        open.members.push(memberFromMessage(humanMessage, index));
        open.lastAskedAt = safeTimestamp(message.timestamp, open.lastAskedAt);
      }
      lastBundleByThread.set(owner.threadKey, open);
      continue;
    }

    const response = visibleResponse(message, index);
    if (response) {
      const owner = messageOwner(document, message);
      const target: MutableBundle | undefined =
        open && open.ownerThreadKey === owner.threadKey ? open : lastBundleByThread.get(owner.threadKey);
      if (target) {
        target.response ??= response;
        if (!target.terminalStatus) target.status = "responded";
        target.closed = true;
        if (target === open) open = null;
      }
      continue;
    }

    if (message.type !== "result") continue;
    const retryOwnerId = message.data.codex_provider_retry?.ownerId;
    const openBundle = open as MutableBundle | null;
    const resultRoute =
      message.threadKey || message.questId || message.threadRefs?.length ? messageOwner(document, message) : null;
    const target: MutableBundle | null =
      (retryOwnerId
        ? (groups.findLast((group) => group.members.some((member) => member.messageId === retryOwnerId)) ?? null)
        : null) ??
      (resultRoute
        ? openBundle?.ownerThreadKey === resultRoute.threadKey
          ? openBundle
          : (lastBundleByThread.get(resultRoute.threadKey) ?? null)
        : null) ??
      openBundle ??
      groups.at(-1) ??
      null;
    if (!target) continue;
    if (message.data.codex_provider_retry) {
      target.status = "retrying";
      continue;
    }
    if (message.interrupted) {
      target.status = "interrupted";
      target.terminalStatus = "interrupted";
    } else if (message.data.is_error) {
      target.status = "failed";
      target.terminalStatus = "failed";
      target.statusDetail = resultErrorSummary(message);
    } else if (!target.terminalStatus) {
      target.status = "responded";
    }
    target.closed = true;
    if (target === open) open = null;
  }

  applyLiveStatuses(groups, document);
  return groups;
}

function createBundle(
  document: RecentAskSessionDocument,
  message: Extract<BrowserIncomingMessage, { type: "user_message" }> & { id: string },
  historyIndex: number,
  ownerThreadKey: string,
  questId: string | undefined,
): MutableBundle {
  const timestamp = safeTimestamp(message.timestamp, 0);
  return {
    id: `${document.sessionId}:${message.id}`,
    sessionId: document.sessionId,
    sessionNum: document.sessionNum,
    sessionName: document.sessionName,
    ...(document.sessionState ? { sessionState: document.sessionState } : {}),
    archived: document.archived,
    ...(typeof document.archivedAt === "number" ? { archivedAt: document.archivedAt } : {}),
    sessionSpaceId: document.sessionSpaceId,
    sessionSpaceName: document.sessionSpaceName,
    ownerThreadKey,
    ...(questId ? { questId } : {}),
    firstAskedAt: timestamp,
    lastAskedAt: timestamp,
    members: [memberFromMessage(message, historyIndex)],
    status: "awaiting_response",
    closed: false,
  };
}

function memberFromMessage(
  message: Extract<BrowserIncomingMessage, { type: "user_message" }> & { id: string },
  historyIndex: number,
): RecentAskMember {
  const text = message.content || "";
  return {
    messageId: message.id,
    historyIndex,
    timestamp: safeTimestamp(message.timestamp, 0),
    preview: truncate(text, MEMBER_PREVIEW_LIMIT),
    truncated: text.length > MEMBER_PREVIEW_LIMIT,
    imageCount: message.images?.length ?? 0,
  };
}

function visibleResponse(message: BrowserIncomingMessage, historyIndex: number): RecentAskResponsePreview | null {
  if (!isRootAgentHistoryMessage(message)) return null;
  if (message.type === "leader_user_message") {
    const text = collapseWhitespace(message.content || "");
    if (!text) return null;
    return {
      messageId: message.id,
      historyIndex,
      timestamp: safeTimestamp(message.timestamp, 0),
      preview: truncate(text, RESPONSE_PREVIEW_LIMIT),
      truncated: text.length > RESPONSE_PREVIEW_LIMIT,
    };
  }
  if (message.type !== "assistant" || message.parent_tool_use_id != null) return null;
  const text = collapseWhitespace(
    message.message.content
      .filter(
        (block): block is Extract<(typeof message.message.content)[number], { type: "text" }> => block.type === "text",
      )
      .map((block) => block.text)
      .join(" "),
  );
  if (!text) return null;
  return {
    messageId: message.message.id,
    historyIndex,
    timestamp: safeTimestamp(message.timestamp, 0),
    preview: truncate(text, RESPONSE_PREVIEW_LIMIT),
    truncated: text.length > RESPONSE_PREVIEW_LIMIT,
  };
}

function applyLiveStatuses(groups: MutableBundle[], document: RecentAskSessionDocument): void {
  const activeIndexes = new Set(document.isGenerating ? (document.userMessageIdsThisTurn ?? []) : []);
  const queuedIndexes = new Set((document.queuedTurnUserMessageIds ?? []).flatMap((indexes) => [...indexes]));
  const pendingIds = new Set((document.pendingCodexInputs ?? []).map((input) => input.id));
  const activeRoute = document.activeTurnRoute?.threadKey
    ? messageOwner(document, document.activeTurnRoute).threadKey
    : null;

  for (const group of groups) {
    if (group.status === "failed" || group.status === "interrupted" || group.status === "retrying") continue;
    const hasActiveMember = group.members.some((member) => activeIndexes.has(member.historyIndex));
    const hasQueuedMember = group.members.some(
      (member) => queuedIndexes.has(member.historyIndex) || pendingIds.has(member.messageId),
    );
    if (
      document.isGenerating &&
      (hasActiveMember || (!group.closed && activeRoute !== null && group.ownerThreadKey === activeRoute))
    ) {
      group.status = "working";
    } else if (hasQueuedMember) {
      group.status = "queued";
    }
  }
}

function messageOwner(
  document: RecentAskSessionDocument,
  message: Pick<BrowserIncomingMessage, "threadKey" | "questId" | "threadRefs">,
): AuthoritativeMessageOwner {
  if (!document.isOrchestrator) return { threadKey: MAIN_THREAD_KEY };
  return authoritativeMessageOwner(message);
}

function notificationOwner(
  document: RecentAskSessionDocument,
  notification: Pick<SessionNotification, "threadKey" | "questId" | "threadRefs">,
): AuthoritativeMessageOwner {
  if (!document.isOrchestrator) return { threadKey: MAIN_THREAD_KEY };
  return authoritativeMessageOwner(notification);
}

function enrichQuest(
  bundle: RecentAskBundle,
  quests: ReadonlyMap<string, RecentAskQuestSummary> | undefined,
): RecentAskBundle {
  if (!bundle.questId) return bundle;
  const quest = quests?.get(bundle.questId);
  if (!quest) return bundle;
  return {
    ...bundle,
    questTitle: quest.title,
    questStatus: quest.status,
    ...(quest.status === "done" && !isHigherPriorityThanCompleted(bundle.status)
      ? { status: "completed" as const }
      : {}),
  };
}

function stripMutableFields(bundle: MutableBundle): RecentAskBundle {
  const { closed: _closed, terminalStatus: _terminalStatus, ...result } = bundle;
  return result;
}

function matchesFilter(statuses: ReadonlySet<RecentAskBundleStatus>, filter: RecentAskFilter): boolean {
  if (filter === "all") return true;
  if (filter === "needs_me") return statuses.has("needs_input") || statuses.has("thread_needs_input");
  if (filter === "new_response") return statuses.has("response_unread");
  return ["awaiting_response", "queued", "working", "retrying"].some((status) =>
    statuses.has(status as RecentAskBundleStatus),
  );
}

function summarizeSessionSpaces(groups: RecentAskBundle[]): Array<{ id: string; name: string; count: number }> {
  const spaces = new Map<string, { id: string; name: string; count: number }>();
  for (const group of groups) {
    const current = spaces.get(group.sessionSpaceId);
    if (current) current.count += 1;
    else spaces.set(group.sessionSpaceId, { id: group.sessionSpaceId, name: group.sessionSpaceName, count: 1 });
  }
  return [...spaces.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function compareBundleRecency(left: RecentAskBundle, right: RecentAskBundle): number {
  return (
    right.lastAskedAt - left.lastAskedAt || right.firstAskedAt - left.firstAskedAt || left.id.localeCompare(right.id)
  );
}

function resultErrorSummary(message: Extract<BrowserIncomingMessage, { type: "result" }>): string | undefined {
  const first = message.data.errors?.find((error) => error.trim()) ?? message.data.result;
  return first ? truncate(collapseWhitespace(first), RESPONSE_PREVIEW_LIMIT) : undefined;
}

function normalizeFilter(value: RecentAskFilter | undefined): RecentAskFilter {
  return value === "needs_me" || value === "new_response" || value === "active" ? value : "all";
}

function isAttentionStatus(status: RecentAskBundleStatus): boolean {
  return status === "needs_input" || status === "thread_needs_input" || status === "response_unread";
}

function isHigherPriorityThanCompleted(status: RecentAskBundleStatus): boolean {
  return (
    status === "needs_input" ||
    status === "thread_needs_input" ||
    status === "response_unread" ||
    status === "failed" ||
    status === "interrupted" ||
    status === "retrying" ||
    status === "working" ||
    status === "queued" ||
    status === "awaiting_response"
  );
}

function recentHistoryStartIndex(document: RecentAskSessionDocument, maxDestinations: number): number {
  if (!document.isOrchestrator) {
    for (let index = document.messageHistory.length - 1; index >= 0; index -= 1) {
      const message = document.messageHistory[index]!;
      if (isRootAgentHistoryMessage(message) && isActualHumanUserMessage(message) && message.id) return index;
    }
    return document.messageHistory.length;
  }

  const recentDestinations = new Set<string>();
  for (let index = document.messageHistory.length - 1; index >= 0; index -= 1) {
    const message = document.messageHistory[index]!;
    if (!isRootAgentHistoryMessage(message) || !isActualHumanUserMessage(message) || !message.id) continue;
    const ownerThreadKey = messageOwner(document, message).threadKey;
    if (recentDestinations.has(ownerThreadKey)) continue;
    if (recentDestinations.size >= maxDestinations) return index + 1;
    recentDestinations.add(ownerThreadKey);
  }
  return 0;
}

function hasAttentionFacet(statuses: ReadonlySet<RecentAskBundleStatus>): boolean {
  return [...statuses].some(isAttentionStatus);
}

function safeTimestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1))}…`;
}

function clampInteger(value: number | undefined, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(value)));
}
