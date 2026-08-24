import type {
  ActiveTurnRoute,
  BrowserIncomingMessage,
  PendingCodexInput,
  SessionNotification,
} from "./session-types.js";
import { isActualHumanUserMessage } from "./user-message-classification.js";
import { MAIN_THREAD_KEY, normalizeSelectedFeedThreadKey } from "../shared/thread-window.js";

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

export function buildRecentAskBundles(input: BuildRecentAskBundlesInput): RecentAskBundlesResponse {
  const startedAt = Date.now();
  const limit = clampInteger(input.limit, RECENT_ASK_BUNDLE_LIMIT, 1, RECENT_ASK_BUNDLE_LIMIT);
  const query = (input.query ?? "").trim();
  const filter = normalizeFilter(input.filter);
  const allGroups = input.documents
    .flatMap((document) => buildSessionBundles(document))
    .sort(compareBundleRecency)
    .slice(0, limit)
    .map((bundle) => enrichQuest(bundle, input.quests));
  const sessionSpaces = summarizeSessionSpaces(allGroups);
  const filtered = allGroups.filter((group) => {
    if (input.sessionSpaceId && group.sessionSpaceId !== input.sessionSpaceId) return false;
    if (!matchesFilter(group.status, filter)) return false;
    return matchesQuery(group, query);
  });

  return {
    groups: filtered,
    totalMatches: filtered.length,
    totalRecentGroups: allGroups.length,
    limit,
    query,
    filter,
    sessionSpaceId: input.sessionSpaceId || null,
    attentionCount: allGroups.filter((group) => isAttentionStatus(group.status)).length,
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

function buildSessionBundles(document: RecentAskSessionDocument): RecentAskBundle[] {
  const groups: MutableBundle[] = [];
  const lastBundleByThread = new Map<string, MutableBundle>();
  let open: MutableBundle | null = null;

  const startIndex = recentHistoryStartIndex(document.messageHistory, RECENT_ASK_BUNDLE_LIMIT);
  for (let index = startIndex; index < document.messageHistory.length; index += 1) {
    const message = document.messageHistory[index]!;
    if (isActualHumanUserMessage(message)) {
      const owner = ownerRoute(message);
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
      const owner = ownerRoute(message);
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
    const resultRoute = message.threadKey || message.questId ? ownerRoute(message) : null;
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
  applyNotificationStatuses(groups, document.notifications ?? []);
  return groups.map(stripMutableFields);
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
  const text = (message.content || "").trim();
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
    ? normalizeSelectedFeedThreadKey(document.activeTurnRoute.threadKey)
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

function applyNotificationStatuses(groups: MutableBundle[], notifications: ReadonlyArray<SessionNotification>): void {
  const notificationByMessageId = new Map<string, SessionNotification[]>();
  for (const notification of notifications) {
    if (!notification.messageId) continue;
    const existing = notificationByMessageId.get(notification.messageId) ?? [];
    existing.push(notification);
    notificationByMessageId.set(notification.messageId, existing);
  }

  for (const group of groups) {
    const responseId = group.response?.messageId;
    const exact = responseId ? (notificationByMessageId.get(responseId) ?? []) : [];
    const activeNeedsInput = exact.find(
      (notification) => notification.category === "needs-input" && !notification.done,
    );
    if (activeNeedsInput) {
      group.status = "needs_input";
      group.statusDetail = activeNeedsInput.summary || undefined;
      continue;
    }
    const unreadReview = exact.find((notification) => notification.category === "review" && !notification.done);
    if (unreadReview && group.status !== "failed" && group.status !== "interrupted") {
      group.status = "response_unread";
      group.statusDetail = unreadReview.summary || undefined;
      continue;
    }
    const resolvedReceipt = exact.find(
      (notification) =>
        (notification.category === "review" || notification.category === "needs-input") && notification.done,
    );
    if (resolvedReceipt && group.status === "responded") group.status = "caught_up";
  }

  const latestByThread = new Map<string, MutableBundle>();
  for (const group of groups) {
    const current = latestByThread.get(group.ownerThreadKey);
    if (!current || group.lastAskedAt > current.lastAskedAt) latestByThread.set(group.ownerThreadKey, group);
  }
  const exactResponseIds = new Set(groups.flatMap((group) => (group.response ? [group.response.messageId] : [])));
  for (const notification of notifications) {
    if (notification.done || notification.category !== "needs-input") continue;
    if (notification.messageId && exactResponseIds.has(notification.messageId)) continue;
    const route = normalizeNotificationThread(notification);
    const group = latestByThread.get(route);
    if (!group || notification.timestamp < group.lastAskedAt || group.status === "needs_input") continue;
    group.status = "thread_needs_input";
    group.statusDetail = notification.summary || undefined;
  }
}

function ownerRoute(message: BrowserIncomingMessage): { threadKey: string; questId?: string } {
  const attachedRef = [...(message.threadRefs ?? [])]
    .filter((ref) => ref.source !== "backfill")
    .sort((left, right) => (right.attachedAt ?? 0) - (left.attachedAt ?? 0))[0];
  const rawThreadKey = attachedRef?.threadKey || message.threadKey || message.questId || MAIN_THREAD_KEY;
  const threadKey = normalizeSelectedFeedThreadKey(rawThreadKey) || MAIN_THREAD_KEY;
  const questId = attachedRef?.questId || message.questId || (threadKey.startsWith("q-") ? threadKey : undefined);
  return { threadKey, ...(questId ? { questId } : {}) };
}

function normalizeNotificationThread(notification: SessionNotification): string {
  return normalizeSelectedFeedThreadKey(notification.threadKey || notification.questId || MAIN_THREAD_KEY);
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

function matchesQuery(bundle: RecentAskBundle, query: string): boolean {
  if (!query) return true;
  const normalized = query.toLocaleLowerCase();
  return [
    bundle.sessionName,
    bundle.sessionSpaceName,
    bundle.ownerThreadKey,
    bundle.questId ?? "",
    bundle.questTitle ?? "",
    bundle.statusDetail ?? "",
    ...bundle.members.map((member) => member.preview),
    bundle.response?.preview ?? "",
  ].some((value) => value.toLocaleLowerCase().includes(normalized));
}

function matchesFilter(status: RecentAskBundleStatus, filter: RecentAskFilter): boolean {
  if (filter === "all") return true;
  if (filter === "needs_me") return status === "needs_input" || status === "thread_needs_input";
  if (filter === "new_response") return status === "response_unread";
  return status === "awaiting_response" || status === "queued" || status === "working" || status === "retrying";
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

function recentHistoryStartIndex(history: ReadonlyArray<BrowserIncomingMessage>, maxGroups: number): number {
  let groupCount = 0;
  let newerHumanThread: string | null = null;
  let terminalBoundaryBeforeNewerHuman = false;
  const responseBoundaryThreads = new Set<string>();

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const message = history[index]!;
    if (isActualHumanUserMessage(message)) {
      const threadKey = ownerRoute(message).threadKey;
      if (
        newerHumanThread === null ||
        terminalBoundaryBeforeNewerHuman ||
        responseBoundaryThreads.has(threadKey) ||
        threadKey !== newerHumanThread
      ) {
        groupCount += 1;
        if (groupCount > maxGroups) return index + 1;
      }
      newerHumanThread = threadKey;
      terminalBoundaryBeforeNewerHuman = message.recentAskBoundaryBefore === "visible_response";
      responseBoundaryThreads.delete(threadKey);
      continue;
    }
    if (visibleResponse(message, index)) {
      responseBoundaryThreads.add(ownerRoute(message).threadKey);
      continue;
    }
    if (message.type === "result" && !message.data.codex_provider_retry) terminalBoundaryBeforeNewerHuman = true;
  }
  return 0;
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
