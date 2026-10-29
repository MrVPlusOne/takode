import { isTopicViewKey } from "../../shared/topic-thread-key.js";
import type {
  AttentionAlertMessage,
  BoardRow,
  BrowserIncomingMessage,
  NeedsInputNotificationQuestion,
  SessionNotification,
} from "../session-types.js";
import {
  applyLeaderServerCandidateThreadTabEvent,
  canServerCandidateOpenThread,
  normalizeLeaderOpenThreadTabsState,
  normalizeLeaderThreadKey,
  shouldPersistLeaderThreadTab,
} from "../../shared/leader-open-thread-tabs.js";
import {
  type ThreadRouteMetadata,
  normalizeThreadRoute,
  resolveConsistentNotificationThreadRoute,
  routeFromHistoryEntry,
  sameThreadRoute,
  withThreadRoute,
} from "../thread-routing-metadata.js";
import {
  isNeverStartedScheduledLeaderThreadTabRow,
  isScheduledLeaderThreadTabStatus,
  type LeaderThreadTabMutationPolicy,
} from "../../shared/leader-thread-tab-priority.js";
import { THREAD_OUTCOME_REMINDER_SOURCE_ID } from "../../shared/thread-outcome-reminder.js";
import {
  leaderMessageThreadKey,
  leaderResponseMessageIsAssociatedWithThread,
} from "../../shared/leader-thread-response-routing.js";
import { randomUUID } from "node:crypto";
import type { PhoneAlertSubject } from "../phone-alert-status.js";
import { leaderTurnObservedHistoryLength } from "./thread-routing-reminder.js";
import { removeResolvedQuestionFromBoardRow } from "./board-user-checkpoint.js";
import { markdownToPlainText } from "../../shared/markdown-plain-text.js";
import type { QuestStartedFrom } from "../quest-types.js";
import { findSupportingQuestSource, indexLeaderRequests } from "../supporting-quest.js";
import { topicThreadLabel } from "../topic-views.js";

type SessionLike = any;

export type AttentionReason = "action" | "error" | "review";
export type NotificationUrgency = "needs-input" | "review" | null;

export interface NotificationStatusSnapshot {
  notificationUrgency: NotificationUrgency;
  activeNotificationCount: number;
  activeNeedsInputNotificationCount: number;
  activeReviewNotificationCount: number;
  mutedNeedsInputNotificationCount: number;
  notificationStatusVersion: number;
  notificationStatusUpdatedAt: number;
}

type BrowserNotificationDeps = {
  broadcastToBrowsers?: (session: SessionLike, msg: BrowserIncomingMessage) => void;
};

type PersistNotificationDeps = BrowserNotificationDeps & {
  persistSession: (session: SessionLike) => void;
  promoteLeaderThreadTabForAttention?: (
    sessionId: string,
    threadKey: string,
    eventAt: number,
    kind: "primary" | "review",
  ) => boolean;
};

type NotifyUserDeps = PersistNotificationDeps & {
  getLeaderThreadTabMutationPolicy?: (sessionId: string, threadKey: string) => LeaderThreadTabMutationPolicy | null;
  isHerdedWorkerSession?: (session: SessionLike) => boolean;
  getLauncherSessionInfo?: (sessionId: string) => any;
  emitTakodeEvent?: (sessionId: string, type: string, data: Record<string, unknown>) => void;
  scheduleNotification?: (
    sessionId: string,
    category: "question" | "completed",
    detail: string,
    options?: { skipReadCheck?: boolean; notificationId?: string; threadKey?: string; messageId?: string },
  ) => void;
};

type NotifyUserOptions = {
  /** Needs-input decision context, written to the feed as an ordinary assistant message before the card. */
  context?: string;
  /** Leader-only: direct-user IDs the context answers, settled like an explicit answer. */
  answerUserMessageIds?: string[];
  suggestedAnswers?: string[];
  questions?: NeedsInputNotificationQuestion[];
  threadRoute?: ThreadRouteMetadata;
  suppressThreadTabPromotion?: boolean;
};

type NotifyUserResult = {
  ok: true;
  anchoredMessageId: string | null;
  notificationId: string;
  reused?: boolean;
};

type NotificationDoneDeps = PersistNotificationDeps & {
  broadcastBoard?: (session: SessionLike, board: BoardRow[], completedBoard: BoardRow[]) => void;
  invalidateLeaderThreadTabsForQuestIds?: (questIds: readonly string[]) => void;
  cancelScheduledNotification?: (sessionId: string, notificationId: string) => void;
};

type ResolutionNoticeMode = "pending" | "delivered";

type NotificationDoneOptions = {
  resolutionNotice?: ResolutionNoticeMode;
  resolutionNoticeSource?: "manual" | "response";
  suppressScheduledNotificationCancel?: boolean;
};

type NotificationMuteDeps = PersistNotificationDeps & {
  isHerdedWorkerSession?: (session: SessionLike) => boolean;
};

type LeaderUnreadDeps = PersistNotificationDeps & {
  isHerdedWorkerSession?: (session: SessionLike) => boolean;
  /** Phone alert for an urgent answer; it fires only while `isStillOpen` holds after the alert delay. */
  scheduleUrgentResultAlert?: (
    sessionId: string,
    detail: string,
    options: { notificationId: string; threadKey: string; messageId: string; isStillOpen: () => boolean },
  ) => void;
  /** The message a quest was filed from, to recognize supporting quests. */
  resolveQuestStartedFrom?: (questId: string) => Promise<QuestStartedFrom | null>;
};

type ClearAttentionAndMarkReadOptions = {
  mode?: "all" | "session-view";
};

const EXACT_NEEDS_INPUT_RETRY_DEDUPE_WINDOW_MS = 5 * 60 * 1000;

export function setAttention(
  session: SessionLike,
  reason: AttentionReason,
  deps: PersistNotificationDeps & { isHerdedWorkerSession?: (session: SessionLike) => boolean },
  options?: { allowHerdedWorker?: boolean },
): void {
  if (deps.isHerdedWorkerSession?.(session) && !options?.allowHerdedWorker) return;
  const current = session.attentionReason as AttentionReason | null;
  const pri = { action: 3, error: 2, review: 1 } as const;
  if (current && pri[current] >= pri[reason]) return;
  session.attentionReason = reason;
  deps.persistSession(session);
}

/**
 * Whether a tab already shows something unread: for a leader thread tab, an unread
 * result in that thread; for an ordinary session (`threadKey` null), any unread
 * result or the session's own unread attention.
 */
export function hasUnreadResult(session: SessionLike, threadKey: string | null): boolean {
  if (threadKey === null) {
    const reason = session.attentionReason as AttentionReason | null;
    if (reason === "review" || reason === "error" || session.manualUnread === true) return true;
  }
  const normalizedThreadKey = threadKey === null ? null : normalizeLeaderThreadKey(threadKey);
  return (session.notifications ?? []).some(
    (notification: SessionNotification) =>
      notification.category === "review" &&
      !notification.done &&
      (normalizedThreadKey === null ||
        normalizeLeaderThreadKey(notification.threadKey ?? "main") === normalizedThreadKey),
  );
}

/**
 * Tell every browser that a tab got a needs-input prompt for the user or a new result
 * to read. Browsers sound it unless they show that tab; see `AttentionAlertMessage`.
 */
export function announceAttentionAlert(
  session: SessionLike,
  kind: AttentionAlertMessage["kind"],
  threadKey: string | undefined,
  deps: Pick<BrowserNotificationDeps, "broadcastToBrowsers">,
): void {
  deps.broadcastToBrowsers?.(session, {
    type: "attention_alert",
    session_id: session.id,
    kind,
    ...(threadKey ? { thread_key: normalizeLeaderThreadKey(threadKey) } : {}),
  });
}

export function clearAttentionAndMarkRead(
  session: SessionLike,
  deps: PersistNotificationDeps,
  options: ClearAttentionAndMarkReadOptions = {},
): void {
  const unreadReviewNotifications = getUserVisibleSessionNotifications(session).filter(
    (notification) => notification.category === "review" && !notification.done,
  );
  const hasThreadScopedReviewNotifications =
    options.mode === "session-view" && unreadReviewNotifications.some(isThreadScopedReviewNotification);
  const shouldAdvanceReadTimestamp = !hasThreadScopedReviewNotifications;
  const hadUnreadReviewNotifications = shouldAdvanceReadTimestamp && unreadReviewNotifications.length > 0;
  const hadManualUnread = session.manualUnread === true;
  if (session.attentionReason === null && !hadUnreadReviewNotifications && !hadManualUnread) return;
  session.manualUnread = false;
  session.attentionReason = null;
  if (shouldAdvanceReadTimestamp) {
    session.lastReadAt = Date.now();
  }
  if (hadUnreadReviewNotifications) {
    touchNotificationStatus(session);
    deps.broadcastToBrowsers?.(session, buildNotificationUpdateMessage(session));
  }
  deps.persistSession(session);
}

export function normalizeStatusNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function deriveNotificationStatusUpdatedAt(
  notifications: ReadonlyArray<Pick<SessionNotification, "timestamp">>,
): number {
  let latest = 0;
  for (const notification of notifications) {
    if (Number.isFinite(notification.timestamp) && notification.timestamp > latest) latest = notification.timestamp;
  }
  return latest;
}

function touchNotificationStatus(session: SessionLike): void {
  session.notificationStatusVersion = normalizeStatusNumber(session.notificationStatusVersion, 0) + 1;
  session.notificationStatusUpdatedAt = Date.now();
}

function isActionableSessionNotification(notification: Pick<SessionNotification, "category">): boolean {
  return notification.category === "needs-input" || notification.category === "review";
}

function isReadReviewNotification(session: SessionLike, notification: SessionNotification): boolean {
  if (notification.category !== "review") return false;
  const timestamp = Number(notification.timestamp ?? 0);
  const lastReadAt = normalizeStatusNumber(session.lastReadAt, 0);
  return timestamp > 0 && lastReadAt >= timestamp;
}

function isThreadScopedReviewNotification(notification: SessionNotification): boolean {
  if (notification.category !== "review") return false;
  const route = normalizeThreadRoute(notification.threadKey, notification.questId);
  return route !== null && route.threadKey !== "main";
}

function scheduledBoardRowForThread(session: SessionLike, threadKey: string): BoardRow | undefined {
  const normalizedThreadKey = normalizeLeaderThreadKey(threadKey);
  const board = session.board;
  const rows: Iterable<BoardRow> = board instanceof Map ? board.values() : Array.isArray(board) ? board : [];
  for (const row of rows) {
    if (normalizeLeaderThreadKey(row.questId) !== normalizedThreadKey) continue;
    return isScheduledLeaderThreadTabStatus(row.status) ? row : undefined;
  }
  return undefined;
}

function openLeaderReviewThreadKeys(session: SessionLike): Set<string> | null {
  if (session.state?.isOrchestrator !== true) return null;
  const openTabs = normalizeLeaderOpenThreadTabsState(session.state?.leaderOpenThreadTabs);
  if (!openTabs) return null;
  const keys = new Set(["main", ...openTabs.orderedOpenThreadKeys]);

  // Active board rows are server-owned visual tab candidates even for restored
  // sessions whose durable open-tab state predates server-side surfacing. Keep
  // their review notifications discoverable while still honoring a newer close.
  const board = session.board;
  const rows: Iterable<BoardRow> = board instanceof Map ? board.values() : Array.isArray(board) ? board : [];
  for (const row of rows) {
    if (!row || row.completedAt !== undefined || !shouldPersistLeaderThreadTab(row.questId)) continue;
    const eventAt = row.threadTabActivatedAt ?? row.createdAt;
    if (
      !canServerCandidateOpenThread(openTabs, row.questId, eventAt, {
        allowTombstoneReopen: !isScheduledLeaderThreadTabStatus(row.status),
      })
    ) {
      continue;
    }
    keys.add(normalizeLeaderThreadKey(row.questId));
  }
  return keys;
}

function isDiscoverableLeaderReviewNotification(
  notification: SessionNotification,
  openThreadKeys: Set<string> | null,
): boolean {
  if (notification.category !== "review" || notification.done || !openThreadKeys) return true;
  const route = normalizeThreadRoute(notification.threadKey, notification.questId);
  // Topic threads and the user's threads are never tabs: their answers are always discoverable.
  if (route?.threadKey && isTopicViewKey(route.threadKey)) return true;
  return openThreadKeys.has(route?.threadKey ?? "main");
}

export function getUserVisibleSessionNotifications(session: SessionLike): SessionNotification[] {
  const openThreadKeys = openLeaderReviewThreadKeys(session);
  return (session.notifications ?? []).filter(
    (notification: SessionNotification) =>
      isActionableSessionNotification(notification) &&
      !isReadReviewNotification(session, notification) &&
      isDiscoverableLeaderReviewNotification(notification, openThreadKeys),
  );
}

export function getNotificationStatusSnapshot(session: SessionLike): NotificationStatusSnapshot {
  let activeNotificationCount = 0;
  let activeNeedsInputNotificationCount = 0;
  let activeReviewNotificationCount = 0;
  let mutedNeedsInputNotificationCount = 0;
  let hasNeedsInput = false;
  let hasReview = false;
  const notifications = getUserVisibleSessionNotifications(session);
  for (const notification of notifications) {
    if (notification.done) continue;
    activeNotificationCount += 1;
    if (notification.category === "needs-input") {
      if (notification.muted) {
        mutedNeedsInputNotificationCount += 1;
        activeNotificationCount -= 1;
        continue;
      }
      hasNeedsInput = true;
      activeNeedsInputNotificationCount += 1;
    }
    if (notification.category === "review") {
      hasReview = true;
      activeReviewNotificationCount += 1;
    }
  }
  return {
    notificationUrgency: hasNeedsInput ? "needs-input" : hasReview ? "review" : null,
    activeNotificationCount,
    activeNeedsInputNotificationCount,
    activeReviewNotificationCount,
    mutedNeedsInputNotificationCount,
    notificationStatusVersion: normalizeStatusNumber(session.notificationStatusVersion, 0),
    notificationStatusUpdatedAt: normalizeStatusNumber(
      session.notificationStatusUpdatedAt,
      deriveNotificationStatusUpdatedAt(notifications),
    ),
  };
}

function buildNotificationUpdateMessage(session: SessionLike): BrowserIncomingMessage {
  const status = getNotificationStatusSnapshot(session);
  return {
    type: "notification_update",
    notifications: getUserVisibleSessionNotifications(session),
    ...status,
  } as BrowserIncomingMessage;
}

/** Publish authoritative notification changes without resolving or recreating a prompt. */
export function broadcastNotificationRefresh(session: SessionLike, deps: PersistNotificationDeps): void {
  touchNotificationStatus(session);
  deps.broadcastToBrowsers?.(session, buildNotificationUpdateMessage(session));
  clearActionAttentionIfNoNotifications(session, deps);
  deps.persistSession(session);
}

export function notifyUser(
  session: SessionLike,
  category: SessionNotification["category"],
  summary: string,
  deps: NotifyUserDeps,
  options: NotifyUserOptions = {},
): NotifyUserResult {
  const timestamp = Date.now();
  const preferredThreadRoute = options.threadRoute ?? activeNotificationThreadRoute(session);
  const isLeaderSession = deps.getLauncherSessionInfo?.(session.id)?.isOrchestrator === true;
  const preferVisibleTextAnchor =
    isLeaderSession && category === "needs-input" && !deps.isHerdedWorkerSession?.(session);
  let anchorIndex = findLastNotificationAnchorIndex(session, { preferredThreadRoute, preferVisibleTextAnchor });
  let anchor = anchorIndex !== undefined ? getNotificationAnchor(session.messageHistory[anchorIndex]) : undefined;
  const candidateThreadRoute =
    preferredThreadRoute ?? resolveConsistentNotificationThreadRoute(session.messageHistory, anchorIndex, "pending");
  const suggestedAnswers =
    category === "needs-input" && options.suggestedAnswers?.length ? options.suggestedAnswers : undefined;
  const questions = category === "needs-input" && options.questions?.length ? options.questions : undefined;
  const context = category === "needs-input" && options.context ? options.context : undefined;
  const answerUserMessageIds =
    context && isLeaderSession && options.answerUserMessageIds?.length ? options.answerUserMessageIds : undefined;

  const existingNeedsInput =
    category === "needs-input"
      ? findExactActiveNeedsInputNotification(
          session,
          summary,
          context,
          suggestedAnswers,
          questions,
          candidateThreadRoute,
          timestamp,
        )
      : null;
  if (existingNeedsInput) {
    // A retried prompt with context keeps its own context message as the anchor.
    if (anchor && !existingNeedsInput.contextMessageId) {
      maybeReanchorReusedNotification(existingNeedsInput, anchor, candidateThreadRoute);
      (anchor.message as Record<string, unknown>).notification = withThreadRoute(
        buildAnchoredNotification(existingNeedsInput),
        candidateThreadRoute,
      );
      markSatisfiedThreadOutcomeReminders(session, existingNeedsInput, anchorIndex);
      deps.broadcastToBrowsers?.(session, {
        type: "notification_anchored",
        messageId: anchor.id,
        notification: withThreadRoute(buildAnchoredNotification(existingNeedsInput), candidateThreadRoute),
      } as BrowserIncomingMessage);
    }
    touchNotificationStatus(session);
    deps.broadcastToBrowsers?.(session, buildNotificationUpdateMessage(session));
    deps.persistSession(session);
    return {
      ok: true,
      anchoredMessageId: existingNeedsInput.messageId ?? null,
      notificationId: existingNeedsInput.id,
      reused: true,
    };
  }

  let createdFallbackMessage: BrowserIncomingMessage | null = null;
  let createdContextMessage: Extract<BrowserIncomingMessage, { type: "assistant" }> | null = null;
  let threadRoute: ThreadRouteMetadata | undefined;
  const nextNotificationCounter = Number.isInteger(session.notificationCounter) ? session.notificationCounter + 1 : 1;
  session.notificationCounter = nextNotificationCounter;
  const notificationId = `n-${nextNotificationCounter}`;

  // Outcome reminders answered by this prompt sit after the latest decision source, which precedes
  // a newly written context message.
  const reminderAnchorIndex = anchorIndex;
  if (context) {
    threadRoute =
      preferredThreadRoute ??
      resolveConsistentNotificationThreadRoute(session.messageHistory, anchorIndex, notificationId);
    createdContextMessage = buildNeedsInputContextMessage(session, {
      context,
      notificationId,
      timestamp,
      leaderRoute: isLeaderSession ? threadRoute : null,
      answerUserMessageIds,
    });
    session.messageHistory.push(createdContextMessage);
    anchorIndex = session.messageHistory.length - 1;
    anchor = getNotificationAnchor(createdContextMessage);
  } else if (!anchor && isLeaderSession && category === "needs-input" && !deps.isHerdedWorkerSession?.(session)) {
    createdFallbackMessage = {
      type: "leader_user_message",
      id: `leader-needs-input-${timestamp}-${session.messageHistory.length}`,
      content: `Needs input: ${summary}`,
      timestamp,
    };
    session.messageHistory.push(createdFallbackMessage);
    anchorIndex = session.messageHistory.length - 1;
    anchor = getNotificationAnchor(createdFallbackMessage);
  }

  const anchoredMessageId = anchor?.id ?? null;
  threadRoute ??=
    preferredThreadRoute ??
    resolveConsistentNotificationThreadRoute(session.messageHistory, anchorIndex, notificationId);
  const questionOnly = category === "needs-input";
  if (createdFallbackMessage) {
    createdFallbackMessage.threadKey = threadRoute.threadKey;
    if (threadRoute.questId) createdFallbackMessage.questId = threadRoute.questId;
    if (threadRoute.threadRefs?.length) createdFallbackMessage.threadRefs = threadRoute.threadRefs;
  }
  const anchoredNotification = withThreadRoute(
    {
      id: notificationId,
      category,
      timestamp,
      summary,
      ...(questionOnly ? { questionOnly } : {}),
      ...(suggestedAnswers ? { suggestedAnswers } : {}),
      ...(questions ? { questions } : {}),
    },
    threadRoute,
  );

  const notif: SessionNotification = withThreadRoute(
    {
      id: notificationId,
      category,
      summary,
      ...(questionOnly ? { questionOnly } : {}),
      ...(createdContextMessage ? { contextMessageId: createdContextMessage.message.id } : {}),
      ...(suggestedAnswers ? { suggestedAnswers } : {}),
      ...(questions ? { questions } : {}),
      timestamp,
      messageId: anchoredMessageId,
      done: false,
    },
    threadRoute,
  );
  // An ordinary session is one tab; a leader's tabs are its threads.
  const alertThreadKey = isLeaderSession ? threadRoute.threadKey : undefined;
  const resultWasUnread = category === "review" && hasUnreadResult(session, alertThreadKey ?? null);
  session.notifications.push(notif);
  if (notif.category === "needs-input") {
    surfaceCreatedNeedsInputThreadTab(session, threadRoute, timestamp, deps);
    markSatisfiedThreadOutcomeReminders(session, notif, reminderAnchorIndex);
  } else if (notif.category === "review" && !options.suppressThreadTabPromotion) {
    deps.promoteLeaderThreadTabForAttention?.(session.id, threadRoute.threadKey, timestamp, "review");
  }
  touchNotificationStatus(session);

  if (createdContextMessage) deps.broadcastToBrowsers?.(session, createdContextMessage);

  if (deps.isHerdedWorkerSession?.(session)) {
    if (category === "needs-input") {
      deps.emitTakodeEvent?.(session.id, "notification_needs_input", {
        summary,
        notificationId: notif.id,
        messageId: anchoredMessageId,
        ...(context ? { context } : {}),
        ...(suggestedAnswers ? { suggestedAnswers } : {}),
        ...(questions ? { questions } : {}),
        ...(anchorIndex !== undefined ? { msg_index: anchorIndex } : {}),
        threadKey: threadRoute.threadKey,
        ...(threadRoute.questId ? { questId: threadRoute.questId } : {}),
      });
    }
    deps.persistSession(session);
    return { ok: true, anchoredMessageId, notificationId: notif.id };
  }

  if (anchor) {
    (anchor.message as Record<string, unknown>).notification = anchoredNotification;
  }

  if (createdFallbackMessage) deps.broadcastToBrowsers?.(session, createdFallbackMessage);

  deps.broadcastToBrowsers?.(session, buildNotificationUpdateMessage(session));
  if (category === "needs-input") announceAttentionAlert(session, "needs-input", alertThreadKey, deps);
  if (category === "review" && !resultWasUnread) announceAttentionAlert(session, "result", alertThreadKey, deps);

  if (category === "needs-input" || category === "review") {
    const reason = category === "needs-input" ? "action" : "review";
    setAttention(session, reason, deps);
  }

  if (category === "needs-input" || category === "review") {
    deps.scheduleNotification?.(session.id, category === "needs-input" ? "question" : "completed", summary, {
      skipReadCheck: true,
      ...(category === "needs-input" ? { notificationId: notif.id } : {}),
      threadKey: threadRoute.threadKey,
      ...(anchoredMessageId ? { messageId: anchoredMessageId } : {}),
    });
  }

  if (anchor) {
    deps.broadcastToBrowsers?.(session, {
      type: "notification_anchored",
      messageId: anchoredMessageId,
      notification: anchoredNotification,
    } as BrowserIncomingMessage);
  }

  deps.persistSession(session);
  return { ok: true, anchoredMessageId, notificationId: notif.id };
}

export function notifyUserBySessionId(
  sessions: Map<string, SessionLike>,
  sessionId: string,
  category: SessionNotification["category"],
  summary: string,
  deps: NotifyUserDeps,
  options: NotifyUserOptions = {},
): NotifyUserResult | { ok: false; error: string } {
  const session = sessions.get(sessionId);
  if (!session) return { ok: false, error: "Session not found" };
  return notifyUser(session, category, summary, deps, options);
}

type LeaderAnswerEntry = Extract<BrowserIncomingMessage, { type: "assistant" }>;

/**
 * Make a leader thread unread for each newly settled answer, because an answer
 * is what the user needs to read; a Thread Ready mark alone no longer does.
 * An answer shown in several threads is unread only in the thread it was written
 * in. A needs-input context answer is skipped: its prompt already asks for attention.
 * An urgent answer (`A!`) always sounds and also sends a phone alert while it stays unread.
 */
export function recordAnswerUnreadNotifications(
  session: SessionLike,
  answers: ReadonlyArray<LeaderAnswerEntry>,
  deps: LeaderUnreadDeps,
): boolean {
  let changed = false;
  for (const answer of answers) {
    const messageId = answer.message.id;
    if (!messageId || hasUnreadNotificationForMessage(session, messageId)) continue;
    if (isNeedsInputContextMessage(session, messageId)) continue;
    const threadKey = leaderMessageThreadKey(answer);
    const preview = answerPreview(answer);
    // A topic conversation or user thread reads by its name, not its `topic:<handle>` key.
    const label = threadKey === "main" ? "Main" : (topicThreadLabel(threadKey) ?? threadKey);
    const timestamp = typeof answer.timestamp === "number" ? answer.timestamp : Date.now();
    const answerTo = answer.threadAnswer?.answerUserMessageIds ?? [];
    const urgent = answer.threadAnswer?.urgent === true;
    const summary = `Answer in ${label}${preview ? ` | ${preview}` : ""}`;
    const notification = addLeaderUnreadNotification(session, {
      reason: "answer",
      threadKey,
      summary,
      timestamp,
      messageId,
      ...(answerTo.length ? { answerTo } : {}),
      urgent,
      deps,
    });
    if (urgent) {
      deps.scheduleUrgentResultAlert?.(session.id, preview || summary, {
        notificationId: notification.id,
        threadKey,
        messageId,
        isStillOpen: () =>
          (session.notifications ?? []).some(
            (candidate: SessionNotification) => candidate.id === notification.id && !candidate.done,
          ),
      });
    }
    deps.promoteLeaderThreadTabForAttention?.(session.id, threadKey, timestamp, "review");
    changed = true;
  }
  if (changed) publishLeaderUnread(session, deps);
  return changed;
}

/**
 * Make a completed quest's leader thread unread. The thread's Quest complete card
 * shows the result, so this does not depend on the leader writing an answer, which
 * it cannot do for work another leader handed over. Recompleting a quest counts again.
 * A supporting quest (see findSupportingQuestSource) adds nothing: its result reaches
 * the user as the leader's answer to the request, which stays pending until answered.
 */
export async function recordQuestCompletionUnreadNotification(
  session: SessionLike,
  completion: { questId: string; summary: string; completedAt: number },
  deps: LeaderUnreadDeps,
): Promise<boolean> {
  // Without a resolver nothing is awaited, so the unread is recorded synchronously.
  const startedFrom = deps.resolveQuestStartedFrom ? await deps.resolveQuestStartedFrom(completion.questId) : null;
  const requests = startedFrom ? indexLeaderRequests(session.messageHistory ?? []) : null;
  if (requests && findSupportingQuestSource(requests, session.id, completion.questId, startedFrom ?? undefined)) {
    return false;
  }
  const threadKey = normalizeLeaderThreadKey(completion.questId);
  const alreadyRecorded = (session.notifications ?? []).some(
    (notification: SessionNotification) =>
      notification.unreadReason === "quest-complete" &&
      notification.timestamp === completion.completedAt &&
      sameThreadRoute(notification, { threadKey }),
  );
  if (alreadyRecorded) return false;
  const anchorIndex = findLastNotificationAnchorIndex(session, { preferredThreadRoute: { threadKey } });
  const anchor = anchorIndex !== undefined ? getNotificationAnchor(session.messageHistory[anchorIndex]) : undefined;
  addLeaderUnreadNotification(session, {
    reason: "quest-complete",
    threadKey,
    summary: completion.summary,
    timestamp: completion.completedAt,
    messageId: anchor?.id ?? null,
    deps,
  });
  publishLeaderUnread(session, deps);
  return true;
}

/**
 * Make a leader thread unread for a newly published report: a report is written for
 * the user to read, whether or not anything asked for it. Its row always stays visible
 * in a collapsed turn, so the unread points at something on screen.
 */
export function recordReportUnreadNotification(
  session: SessionLike,
  report: { id: string; threadKey: string; content: string; timestamp: number },
  deps: LeaderUnreadDeps,
): boolean {
  if (hasUnreadNotificationForMessage(session, report.id)) return false;
  const threadKey = normalizeLeaderThreadKey(report.threadKey);
  const preview = firstLinePreview(report.content);
  addLeaderUnreadNotification(session, {
    reason: "report",
    threadKey,
    summary: `Report in ${threadKey === "main" ? "Main" : threadKey}${preview ? ` | ${preview}` : ""}`,
    timestamp: report.timestamp,
    messageId: report.id,
    deps,
  });
  deps.promoteLeaderThreadTabForAttention?.(session.id, threadKey, report.timestamp, "review");
  publishLeaderUnread(session, deps);
  return true;
}

function addLeaderUnreadNotification(
  session: SessionLike,
  input: {
    reason: NonNullable<SessionNotification["unreadReason"]>;
    threadKey: string;
    summary: string;
    timestamp: number;
    messageId: string | null;
    answerTo?: string[];
    urgent?: boolean;
    deps: LeaderUnreadDeps;
  },
): SessionNotification {
  session.notifications ??= [];
  const nextNotificationCounter = Number.isInteger(session.notificationCounter) ? session.notificationCounter + 1 : 1;
  session.notificationCounter = nextNotificationCounter;
  const threadRoute = normalizeThreadRoute(input.threadKey) ?? { threadKey: "main" };
  // An urgent answer sounds even when its thread already has something unread.
  if (input.urgent || !hasUnreadResult(session, threadRoute.threadKey)) {
    announceAttentionAlert(session, "result", threadRoute.threadKey, input.deps);
  }
  const notification: SessionNotification = withThreadRoute(
    {
      id: `n-${nextNotificationCounter}`,
      category: "review" as const,
      summary: input.summary,
      timestamp: input.timestamp,
      messageId: input.messageId,
      unreadReason: input.reason,
      ...(input.answerTo ? { answerTo: [...input.answerTo] } : {}),
      ...(input.urgent ? { urgent: true as const } : {}),
      done: false,
    },
    threadRoute,
  );
  session.notifications.push(notification);
  return notification;
}

function publishLeaderUnread(session: SessionLike, deps: LeaderUnreadDeps): void {
  touchNotificationStatus(session);
  deps.broadcastToBrowsers?.(session, buildNotificationUpdateMessage(session));
  setAttention(session, "review", deps);
  deps.persistSession(session);
}

function hasUnreadNotificationForMessage(session: SessionLike, messageId: string): boolean {
  return (session.notifications ?? []).some(
    (notification: SessionNotification) => notification.category === "review" && notification.messageId === messageId,
  );
}

function isNeedsInputContextMessage(session: SessionLike, messageId: string): boolean {
  return (session.notifications ?? []).some(
    (notification: SessionNotification) =>
      notification.category === "needs-input" && notification.contextMessageId === messageId,
  );
}

const ANSWER_PREVIEW_MAX_CHARS = 80;

function answerPreview(answer: LeaderAnswerEntry): string {
  const content = answer.message.content;
  return firstLinePreview(
    Array.isArray(content)
      ? content.map((block) => (block.type === "text" ? block.text : "")).join("\n")
      : String(content ?? ""),
  );
}

/** The first line of an answer or report as plain text: alerts and unread rows show it unrendered. */
function firstLinePreview(text: string): string {
  const firstLine = markdownToPlainText(text)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .find((line) => line && !line.startsWith("{[("));
  if (!firstLine) return "";
  return firstLine.length > ANSWER_PREVIEW_MAX_CHARS
    ? `${firstLine.slice(0, ANSWER_PREVIEW_MAX_CHARS - 1).trimEnd()}…`
    : firstLine;
}

function surfaceCreatedNeedsInputThreadTab(
  session: SessionLike,
  route: ThreadRouteMetadata,
  eventAt: number,
  deps: Pick<NotifyUserDeps, "getLauncherSessionInfo" | "getLeaderThreadTabMutationPolicy">,
): void {
  const isLeader =
    session.state?.isOrchestrator === true || deps.getLauncherSessionInfo?.(session.id)?.isOrchestrator === true;
  // A topic conversation or user thread is found in the Topics or Threads menu, never as a tab.
  if (!isLeader || !shouldPersistLeaderThreadTab(route.threadKey) || isTopicViewKey(route.threadKey)) return;
  const scheduledRow = scheduledBoardRowForThread(session, route.threadKey);
  const mutationPolicy =
    deps.getLeaderThreadTabMutationPolicy?.(session.id, route.threadKey) ??
    (scheduledRow
      ? {
          inMotion: false,
          scheduled: true,
          neverStartedScheduled: isNeverStartedScheduledLeaderThreadTabRow(scheduledRow),
          completed: false,
          canClose: true,
        }
      : null);
  if (mutationPolicy?.neverStartedScheduled) return;
  const existingState = normalizeLeaderOpenThreadTabsState(session.state?.leaderOpenThreadTabs);
  const nextState = applyLeaderServerCandidateThreadTabEvent(existingState, route.threadKey, eventAt, {
    repositionExisting: true,
    allowTombstoneReopen: mutationPolicy?.scheduled !== true,
  });
  if (!nextState || nextState === existingState) return;
  session.state = { ...(session.state ?? {}), leaderOpenThreadTabs: nextState };
}

function activeNotificationThreadRoute(session: SessionLike): ThreadRouteMetadata | null {
  return normalizeThreadRoute(session.activeTurnRoute?.threadKey, session.activeTurnRoute?.questId);
}

function notificationThreadRoute(notification: SessionNotification): ThreadRouteMetadata {
  return normalizeThreadRoute(notification.threadKey, notification.questId) ?? { threadKey: "main" };
}

function markSatisfiedThreadOutcomeReminders(
  session: SessionLike,
  notification: SessionNotification,
  anchorIndex: number | undefined,
): void {
  if (anchorIndex === undefined) return;
  const notificationRoute = normalizeThreadRoute(notification.threadKey, notification.questId) ?? { threadKey: "main" };
  const anchorTimestamp = Number(session.messageHistory[anchorIndex]?.timestamp ?? 0);
  const notificationTimestamp = Number(notification.timestamp);

  for (let index = anchorIndex + 1; index < session.messageHistory.length; index += 1) {
    const entry = session.messageHistory[index] as BrowserIncomingMessage & {
      threadOutcomeReminder?: Record<string, unknown>;
    };
    if (entry.type !== "user_message") continue;
    if (entry.agentSource?.sessionId !== THREAD_OUTCOME_REMINDER_SOURCE_ID) continue;
    if (entry.threadOutcomeReminder?.status === "satisfied") continue;
    if (!sameThreadRoute(routeFromHistoryEntry(entry) ?? { threadKey: "main" }, notificationRoute)) continue;

    const reminderTimestamp = Number(entry.timestamp ?? 0);
    if (reminderTimestamp < anchorTimestamp || reminderTimestamp > notificationTimestamp) continue;
    entry.threadOutcomeReminder = {
      status: "satisfied",
      notificationId: notification.id,
      ...(notification.summary ? { notificationSummary: notification.summary } : {}),
      satisfiedAt: notificationTimestamp,
    };
  }
}

function anchorMatchesThreadRoute(session: SessionLike, anchorIndex: number, route: ThreadRouteMetadata): boolean {
  const anchorRoute = routeFromHistoryEntry(session.messageHistory[anchorIndex]) ?? { threadKey: "main" };
  return sameThreadRoute(anchorRoute, route);
}

function getSortedBoardRows(session: SessionLike): BoardRow[] {
  if (!session.board?.values) return [];
  return Array.from(session.board.values() as Iterable<BoardRow>).sort((a, b) => a.createdAt - b.createdAt);
}

function getSortedCompletedBoardRows(session: SessionLike): BoardRow[] {
  if (!session.completedBoard?.values) return [];
  return Array.from(session.completedBoard.values() as Iterable<BoardRow>).sort(
    (a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0),
  );
}

/** Removes a resolved question from board rows; returns the quest IDs whose rows changed. */
function removeNotificationLinksFromBoardRows(session: SessionLike, notifId: string): string[] {
  const normalizedNotificationId = notifId.trim().toLowerCase();
  if (!/^n-\d+$/.test(normalizedNotificationId)) return [];

  const changed: string[] = [];
  const now = Date.now();
  // Active rows may leave a User Checkpoint Takode added once its last question is resolved.
  for (const row of (session.board as Map<string, BoardRow> | undefined)?.values() ?? []) {
    if (removeResolvedQuestionFromBoardRow(row, normalizedNotificationId, now)) changed.push(row.questId);
  }
  for (const row of (session.completedBoard as Map<string, BoardRow> | undefined)?.values() ?? []) {
    const links = row.waitForInput ?? [];
    const open = row.openQuestions ?? [];
    if (!links.includes(normalizedNotificationId) && !open.includes(normalizedNotificationId)) continue;
    const nextLinks = links.filter((id) => id !== normalizedNotificationId);
    const nextOpen = open.filter((id) => id !== normalizedNotificationId);
    row.waitForInput = nextLinks.length > 0 ? nextLinks : undefined;
    row.openQuestions = nextOpen.length > 0 ? nextOpen : undefined;
    changed.push(row.questId);
  }

  return changed;
}

export function markNotificationDone(
  session: SessionLike,
  notifId: string,
  done: boolean,
  deps: NotificationDoneDeps,
  options: NotificationDoneOptions = {},
): boolean {
  const notif = session.notifications.find((entry: SessionNotification) => entry.id === notifId);
  if (!notif) return false;
  if (notif.done === done) {
    if (done && notif.category === "needs-input" && !options.suppressScheduledNotificationCancel) {
      deps.cancelScheduledNotification?.(session.id, notifId);
    }
    if (done) broadcastNotificationRefresh(session, deps);
    return true;
  }
  notif.done = done;
  updateResolutionNoticeForDoneChange(notif, done, options);
  touchNotificationStatus(session);
  const changedQuestIds =
    done && notif.category === "needs-input" ? removeNotificationLinksFromBoardRows(session, notifId) : [];
  const clearedBoardWaits = changedQuestIds.length > 0;
  if (done && notif.category === "needs-input" && !options.suppressScheduledNotificationCancel) {
    deps.cancelScheduledNotification?.(session.id, notifId);
  }
  deps.broadcastToBrowsers?.(session, buildNotificationUpdateMessage(session));
  if (clearedBoardWaits) {
    deps.broadcastBoard?.(session, getSortedBoardRows(session), getSortedCompletedBoardRows(session));
    deps.invalidateLeaderThreadTabsForQuestIds?.(changedQuestIds);
  }
  if (done) clearActionAttentionIfNoNotifications(session, deps);
  deps.persistSession(session);
  return true;
}

export function markNotificationDoneBySessionId(
  sessions: Map<string, SessionLike>,
  sessionId: string,
  notifId: string,
  done: boolean,
  deps: NotificationDoneDeps,
  options: NotificationDoneOptions = {},
): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  return markNotificationDone(session, notifId, done, deps, options);
}

export function setNotificationMuted(
  session: SessionLike,
  notifId: string,
  muted: boolean,
  deps: NotificationMuteDeps,
): boolean {
  const notif = session.notifications.find((entry: SessionNotification) => entry.id === notifId);
  if (!notif || notif.category !== "needs-input" || notif.done) return false;
  const currentlyMuted = notif.muted === true;
  // Muting a snoozed prompt still changes it: the timed snooze becomes an indefinite mute.
  if (currentlyMuted === muted && !(muted && notif.snoozedUntil !== undefined)) {
    broadcastNotificationRefresh(session, deps);
    return true;
  }

  if (muted) {
    notif.muted = true;
    notif.mutedAt = Date.now();
    delete notif.snoozedUntil;
  } else {
    delete notif.muted;
    delete notif.mutedAt;
    delete notif.snoozedUntil;
  }

  touchNotificationStatus(session);
  deps.broadcastToBrowsers?.(session, buildNotificationUpdateMessage(session));
  if (muted) {
    clearActionAttentionIfNoNotifications(session, deps);
  } else {
    setAttention(session, "action", deps);
  }
  deps.persistSession(session);
  return true;
}

export function setNotificationMutedBySessionId(
  sessions: Map<string, SessionLike>,
  sessionId: string,
  notifId: string,
  muted: boolean,
  deps: NotificationMuteDeps,
): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  return setNotificationMuted(session, notifId, muted, deps);
}

/**
 * "Remind me later": mute an unresolved needs-input prompt until `until`. Snoozing is not an answer, so the
 * prompt stays unresolved and the asking agent keeps waiting. A still-pending phone alert is cancelled so
 * nothing reaches the phone while snoozed; `wakeDueSnoozedNotifications` alerts again when the time comes.
 */
export function snoozeNotification(
  session: SessionLike,
  notifId: string,
  until: number,
  deps: NotificationMuteDeps & Pick<NotificationDoneDeps, "cancelScheduledNotification">,
): boolean {
  const notif = session.notifications.find((entry: SessionNotification) => entry.id === notifId);
  if (!notif || notif.category !== "needs-input" || notif.done) return false;
  notif.muted = true;
  notif.mutedAt = Date.now();
  notif.snoozedUntil = until;
  deps.cancelScheduledNotification?.(session.id, notifId);
  touchNotificationStatus(session);
  deps.broadcastToBrowsers?.(session, buildNotificationUpdateMessage(session));
  clearActionAttentionIfNoNotifications(session, deps);
  deps.persistSession(session);
  return true;
}

/**
 * Return every snoozed prompt whose time has come to the active queue and alert for it as if it were newly
 * created: attention, thread-tab surfacing and a phone alert. Snooze times are persisted, so prompts that
 * came due while the server was down wake on the first sweep after restart. Archived sessions stay snoozed.
 */
export function wakeDueSnoozedNotifications(
  sessions: Iterable<SessionLike>,
  now: number,
  deps: NotifyUserDeps,
): number {
  let woken = 0;
  for (const session of sessions) {
    if (deps.getLauncherSessionInfo?.(session.id)?.archived) continue;
    const due = (session.notifications ?? []).filter(
      (notif: SessionNotification) =>
        notif.category === "needs-input" &&
        !notif.done &&
        notif.snoozedUntil !== undefined &&
        notif.snoozedUntil <= now,
    );
    if (due.length === 0) continue;
    for (const notif of due) {
      delete notif.muted;
      delete notif.mutedAt;
      delete notif.snoozedUntil;
      surfaceCreatedNeedsInputThreadTab(session, notificationThreadRoute(notif), now, deps);
    }
    touchNotificationStatus(session);
    deps.broadcastToBrowsers?.(session, buildNotificationUpdateMessage(session));
    if (!deps.isHerdedWorkerSession?.(session)) {
      setAttention(session, "action", deps);
      for (const notif of due) {
        deps.scheduleNotification?.(session.id, "question", notif.summary ?? "Needs input", {
          skipReadCheck: true,
          notificationId: notif.id,
          threadKey: notificationThreadRoute(notif).threadKey,
          ...(notif.messageId ? { messageId: notif.messageId } : {}),
        });
      }
    }
    deps.persistSession(session);
    woken += due.length;
  }
  return woken;
}

/**
 * Every open, unmuted (so also unsnoozed) needs-input question waiting for the user, for follow-up
 * reminders. `isAddressedToUser` leaves out sessions the global attention list leaves out: archived
 * ones, and herded workers, whose questions are for their leader.
 */
export function listWaitingUserQuestions(
  sessions: Iterable<SessionLike>,
  isAddressedToUser: (sessionId: string) => boolean,
): Array<{ key: string; sessionId: string; questId?: string; askedAt: number; subject: PhoneAlertSubject }> {
  const waiting = [];
  for (const session of sessions) {
    if (!isAddressedToUser(session.id)) continue;
    for (const notif of (session.notifications ?? []) as SessionNotification[]) {
      if (notif.category !== "needs-input" || notif.done || notif.muted) continue;
      waiting.push({
        key: `${session.id}:${notif.id}`,
        sessionId: session.id as string,
        questId: notif.questId,
        askedAt: notif.timestamp,
        subject: { kind: "question" as const, sessionId: session.id as string, notificationId: notif.id },
      });
    }
  }
  return waiting;
}

export function markAllNotificationsDone(
  session: SessionLike,
  done: boolean,
  deps: NotificationDoneDeps,
  options: NotificationDoneOptions = {},
): number {
  let count = 0;
  const changedQuestIds: string[] = [];
  for (const notif of session.notifications) {
    if (notif.done === done) continue;
    notif.done = done;
    updateResolutionNoticeForDoneChange(notif, done, options);
    if (done && notif.category === "needs-input") {
      changedQuestIds.push(...removeNotificationLinksFromBoardRows(session, notif.id));
      if (!options.suppressScheduledNotificationCancel) {
        deps.cancelScheduledNotification?.(session.id, notif.id);
      }
    }
    count += 1;
  }
  if (count > 0) {
    touchNotificationStatus(session);
    deps.broadcastToBrowsers?.(session, buildNotificationUpdateMessage(session));
    if (changedQuestIds.length > 0) {
      deps.broadcastBoard?.(session, getSortedBoardRows(session), getSortedCompletedBoardRows(session));
      deps.invalidateLeaderThreadTabsForQuestIds?.([...new Set(changedQuestIds)]);
    }
    if (done) clearActionAttentionIfNoNotifications(session, deps);
    deps.persistSession(session);
  } else if (done) {
    broadcastNotificationRefresh(session, deps);
  }
  return count;
}

export function markAllNotificationsDoneBySessionId(
  sessions: Map<string, SessionLike>,
  sessionId: string,
  done: boolean,
  deps: NotificationDoneDeps,
  options: NotificationDoneOptions = {},
): number {
  const session = sessions.get(sessionId);
  if (!session) return -1;
  return markAllNotificationsDone(session, done, deps, options);
}

export function clearActionAttentionIfNoNotifications(session: SessionLike, deps: BrowserNotificationDeps): void {
  if (session.pendingPermissions.size > 0) return;
  const hasOpenNeedsInput = session.notifications.some(
    (notif: SessionNotification) => !notif.done && !notif.muted && notif.category === "needs-input",
  );
  if (!hasOpenNeedsInput && session.attentionReason === "action") {
    session.attentionReason = null;
  }
}

function findLastNotificationAnchorIndex(
  session: SessionLike,
  options: {
    preferredThreadRoute?: ThreadRouteMetadata | null;
    preferVisibleTextAnchor?: boolean;
  } = {},
): number | undefined {
  if (options.preferVisibleTextAnchor) {
    let latestToolAnchor: number | undefined;
    for (let i = session.messageHistory.length - 1; i >= 0; i--) {
      const entry = session.messageHistory[i] as BrowserIncomingMessage;
      if (entry.codexSubagent != null) continue;
      // Attached requests keep their original owner, but still start a new
      // decision context in this view. Never borrow prose from an older ask.
      if (
        entry.type === "user_message" &&
        entry.agentSource == null &&
        (!options.preferredThreadRoute ||
          leaderResponseMessageIsAssociatedWithThread(entry, options.preferredThreadRoute.threadKey))
      )
        break;
      if (!getNotificationAnchor(entry)) continue;
      if (options.preferredThreadRoute && !anchorMatchesThreadRoute(session, i, options.preferredThreadRoute)) {
        continue;
      }
      latestToolAnchor ??= i;
      if (isVisibleNotificationAnchor(entry)) return i;
    }
    return latestToolAnchor;
  }
  for (let i = session.messageHistory.length - 1; i >= 0; i--) {
    if (!getNotificationAnchor(session.messageHistory[i])) continue;
    if (options.preferredThreadRoute && !anchorMatchesThreadRoute(session, i, options.preferredThreadRoute)) {
      continue;
    }
    return i;
  }
  return undefined;
}

function isVisibleNotificationAnchor(entry: BrowserIncomingMessage | undefined): boolean {
  const anchor = getNotificationAnchor(entry);
  if (!anchor) return false;
  if (anchor.message.type === "leader_user_message") return hasNonEmptyText(anchor.message.content);
  return anchor.message.message.content.some((block) => block.type === "text" && hasNonEmptyText(block.text));
}

function hasNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function findExactActiveNeedsInputNotification(
  session: SessionLike,
  summary: string,
  context: string | undefined,
  suggestedAnswers: string[] | undefined,
  questions: NeedsInputNotificationQuestion[] | undefined,
  threadRoute: ThreadRouteMetadata,
  timestamp: number,
): SessionNotification | null {
  return (
    (session.notifications ?? []).find((notification: SessionNotification) => {
      if (notification.category !== "needs-input" || notification.done || notification.muted) return false;
      if (timestamp - notification.timestamp > EXACT_NEEDS_INPUT_RETRY_DEDUPE_WINDOW_MS) return false;
      if (notification.summary !== summary || !notification.questionOnly) return false;
      const notificationRoute = normalizeThreadRoute(notification.threadKey, notification.questId) ?? {
        threadKey: "main",
      };
      if (!sameThreadRoute(notificationRoute, threadRoute)) return false;
      return (
        stringArraysEqual(notification.suggestedAnswers, suggestedAnswers) &&
        questionsEqual(notification.questions, questions) &&
        notificationContextText(session, notification) === context
      );
    }) ?? null
  );
}

function notificationContextText(session: SessionLike, notification: SessionNotification): string | undefined {
  if (!notification.contextMessageId) return undefined;
  const entry = (session.messageHistory as BrowserIncomingMessage[]).findLast(
    (message) => message.type === "assistant" && message.message.id === notification.contextMessageId,
  );
  if (entry?.type !== "assistant") return undefined;
  return entry.message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
}

/**
 * The context is a real root assistant message so the feed renders it as ordinary full-size text, with the
 * usual selection, Comment and copy behavior, and the card anchors to it. For leaders it carries the
 * notification's thread route, and naming answered messages makes it an explicit answer that the normal
 * turn-end settlement validates exactly like a `[thread:...:A:uN]` message.
 */
function buildNeedsInputContextMessage(
  session: SessionLike,
  options: {
    context: string;
    notificationId: string;
    timestamp: number;
    leaderRoute: ThreadRouteMetadata | null;
    answerUserMessageIds?: string[];
  },
): Extract<BrowserIncomingMessage, { type: "assistant" }> {
  const message: Extract<BrowserIncomingMessage, { type: "assistant" }> = {
    type: "assistant",
    message: {
      id: `needs-input-context-${options.notificationId}`,
      type: "message",
      role: "assistant",
      model: session.state?.model || "",
      content: [{ type: "text", text: options.context }],
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
    timestamp: options.timestamp,
    uuid: randomUUID(),
  };
  if (!options.leaderRoute) return message;
  const observedHistoryLength = options.answerUserMessageIds ? leaderTurnObservedHistoryLength(session) : undefined;
  return {
    ...withThreadRoute(message, options.leaderRoute),
    ...(options.answerUserMessageIds
      ? {
          leaderThreadRole: "answer" as const,
          leaderAnswerUserMessageIds: [...options.answerUserMessageIds],
          ...(observedHistoryLength !== undefined ? { leaderAnswerObservedHistoryLength: observedHistoryLength } : {}),
        }
      : { leaderThreadRole: "commentary" as const }),
  };
}

function stringArraysEqual(left: string[] | undefined, right: string[] | undefined): boolean {
  const normalizedLeft = left ?? [];
  const normalizedRight = right ?? [];
  if (normalizedLeft.length !== normalizedRight.length) return false;
  return normalizedLeft.every((value, index) => value === normalizedRight[index]);
}

function questionsEqual(
  left: NeedsInputNotificationQuestion[] | undefined,
  right: NeedsInputNotificationQuestion[] | undefined,
): boolean {
  const normalizedLeft = left ?? [];
  const normalizedRight = right ?? [];
  if (normalizedLeft.length !== normalizedRight.length) return false;
  return normalizedLeft.every((leftQuestion, index) => {
    const rightQuestion = normalizedRight[index];
    if (!rightQuestion || leftQuestion.prompt !== rightQuestion.prompt) return false;
    return stringArraysEqual(leftQuestion.suggestedAnswers, rightQuestion.suggestedAnswers);
  });
}

function buildAnchoredNotification(notification: SessionNotification): Omit<SessionNotification, "messageId" | "done"> {
  return {
    id: notification.id,
    category: notification.category,
    timestamp: notification.timestamp,
    ...(notification.summary ? { summary: notification.summary } : {}),
    ...(notification.body ? { body: notification.body } : {}),
    ...(notification.questionOnly ? { questionOnly: true } : {}),
    ...(notification.suggestedAnswers ? { suggestedAnswers: notification.suggestedAnswers } : {}),
    ...(notification.questions ? { questions: notification.questions } : {}),
  };
}

function maybeReanchorReusedNotification(
  notification: SessionNotification,
  anchor: { id: string; message: Extract<BrowserIncomingMessage, { type: "assistant" | "leader_user_message" }> },
  threadRoute: ThreadRouteMetadata,
): void {
  if (notification.messageId === anchor.id) return;
  notification.messageId = anchor.id;
  notification.threadKey = threadRoute.threadKey;
  if (threadRoute.questId) notification.questId = threadRoute.questId;
  else delete notification.questId;
  if (threadRoute.threadRefs?.length) notification.threadRefs = threadRoute.threadRefs;
  else delete notification.threadRefs;
}

function getNotificationAnchor(entry: BrowserIncomingMessage | undefined):
  | {
      id: string;
      message: Extract<BrowserIncomingMessage, { type: "assistant" | "leader_user_message" }>;
    }
  | undefined {
  if (!entry) return undefined;
  if (entry.type === "assistant" && entry.parent_tool_use_id == null && entry.message?.id) {
    return { id: entry.message.id, message: entry };
  }
  if (entry.type === "leader_user_message" && entry.id) {
    return { id: entry.id, message: entry };
  }
  return undefined;
}

function updateResolutionNoticeForDoneChange(
  notification: SessionNotification,
  done: boolean,
  options: NotificationDoneOptions,
): void {
  if (done) notification.doneAt = Date.now();
  else delete notification.doneAt;
  if (notification.category !== "needs-input") return;
  if (!done) {
    delete notification.resolutionNotice;
    return;
  }
  if (!options.resolutionNotice) return;
  const resolvedAt = Date.now();
  notification.resolutionNotice = {
    status: options.resolutionNotice,
    source: options.resolutionNoticeSource ?? "manual",
    resolvedAt,
    ...(options.resolutionNotice === "delivered" ? { deliveredAt: resolvedAt } : {}),
  };
}
