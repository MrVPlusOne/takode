import type {
  BrowserIncomingMessage,
  BrowserOutgoingMessage,
  PendingCodexInput,
  SessionNotification,
} from "../session-types.js";
import type {
  AdapterBrowserRoutingDeps,
  AdapterBrowserRoutingSessionLike,
} from "./adapter-browser-routing-controller.js";
import { browserMessageRoute, sameThreadRoute } from "../thread-routing-metadata.js";
import type { ThreadRouteMetadata } from "../thread-routing-metadata.js";

type BrowserUserMessage = Extract<BrowserOutgoingMessage, { type: "user_message" }>;

function parseNotificationNumericId(notificationId: string): number | null {
  const match = /^n-(\d+)$/.exec(notificationId);
  return match ? Number.parseInt(match[1], 10) : null;
}

function formatReminderSummary(summary: string | undefined): string {
  return summary?.trim().replace(/\s+/g, " ") || "(no summary)";
}

function formatResolutionSource(source: "manual" | "response" | undefined): string {
  return source === "response" ? "answered in notification UI" : "resolved outside the agent";
}

function extractReminderNotificationInfo(reminderText: string): { referencedIds: string[]; totalCount: number | null } {
  let totalCount: number | null = null;
  const ids: string[] = [];
  for (const line of reminderText.split(/\r?\n/)) {
    const totalMatch =
      /^Unresolved same-session(?: same-thread)? needs-input notifications(?: \([^)]+\))?: (\d+)\./.exec(line.trim());
    if (totalMatch) {
      totalCount = Number.parseInt(totalMatch[1], 10);
      continue;
    }
    const match = /^\s*(n-\d+|\d+)\.\s+/.exec(line);
    if (!match) continue;
    ids.push(match[1].startsWith("n-") ? match[1] : `n-${Number.parseInt(match[1], 10)}`);
  }
  return { referencedIds: ids, totalCount };
}

export function shouldCommitNeedsInputReminderHistoryEntry(
  reminderText: string,
  notifications: ReadonlyArray<SessionNotification> | undefined,
): boolean {
  const { referencedIds, totalCount } = extractReminderNotificationInfo(reminderText);
  if (referencedIds.length === 0) return true;
  if (totalCount !== null && totalCount > referencedIds.length) return true;

  let knownCount = 0;
  for (const notificationId of referencedIds) {
    const notification = notifications?.find(
      (entry) => entry.id === notificationId && entry.category === "needs-input",
    );
    if (!notification) continue;
    knownCount += 1;
    if (!notification.done) return true;
  }

  return knownCount !== referencedIds.length;
}

export function buildNeedsInputReminderTextForDirectUserMessage(
  session: AdapterBrowserRoutingSessionLike,
  msg: BrowserUserMessage,
  deps: Pick<AdapterBrowserRoutingDeps, "getLauncherSessionInfo">,
): string | null {
  if (msg.agentSource) return null;
  if (deps.getLauncherSessionInfo(session.id)?.isOrchestrator !== true) return null;

  const messageRoute = browserMessageRoute(msg) ?? { threadKey: "main" };
  const pending = (session.notifications ?? [])
    .filter((notification) => notification.category === "needs-input" && !notification.done)
    .filter((notification) => sameThreadRoute(notification, messageRoute))
    .map((notification) => ({
      ...notification,
      numericId: parseNotificationNumericId(notification.id),
    }))
    .sort((a, b) => {
      if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
      return (b.numericId ?? 0) - (a.numericId ?? 0);
    });

  if (pending.length === 0) return null;

  const visible = pending.slice(0, 3);
  const header =
    pending.length === 1
      ? `Unresolved same-session same-thread needs-input notifications (${messageRoute.threadKey}): 1.`
      : `Unresolved same-session same-thread needs-input notifications (${messageRoute.threadKey}): ${pending.length}. Showing newest ${visible.length}.`;
  const lines = visible.map((notification) => {
    const id = notification.numericId === null ? notification.id : String(notification.numericId);
    return `  ${id}. ${formatReminderSummary(notification.summary)}`;
  });

  return [
    "[Needs-input reminder]",
    header,
    ...lines,
    "Review or resolve these before assuming the user's latest message answered them.",
  ].join("\n");
}

export function buildNeedsInputResolutionNoticeForDirectUserMessage(
  session: AdapterBrowserRoutingSessionLike,
  msg: BrowserUserMessage,
  deps: Pick<AdapterBrowserRoutingDeps, "getLauncherSessionInfo">,
): { text: string; notificationIds: string[]; threadRoute: ThreadRouteMetadata } | null {
  if (msg.agentSource) return null;
  if (deps.getLauncherSessionInfo(session.id)?.isOrchestrator !== true) return null;

  const messageRoute = browserMessageRoute(msg) ?? { threadKey: "main" };
  const resolved = (session.notifications ?? [])
    .filter((notification) => notification.category === "needs-input" && notification.done)
    .filter((notification) => notification.resolutionNotice?.status === "pending")
    .filter((notification) => sameThreadRoute(notification, messageRoute))
    .map((notification) => ({
      ...notification,
      numericId: parseNotificationNumericId(notification.id),
    }))
    .sort((a, b) => {
      const left = a.resolutionNotice?.resolvedAt ?? a.timestamp;
      const right = b.resolutionNotice?.resolvedAt ?? b.timestamp;
      if (right !== left) return right - left;
      return (b.numericId ?? 0) - (a.numericId ?? 0);
    });

  if (resolved.length === 0) return null;

  const visible = resolved.slice(0, 5);
  const header =
    resolved.length === 1
      ? `Resolved same-session same-thread needs-input (${messageRoute.threadKey}): 1.`
      : `Resolved same-session same-thread needs-input (${messageRoute.threadKey}): ${resolved.length}; showing newest ${visible.length}.`;
  const lines = visible.map((notification) => {
    const id = notification.numericId === null ? notification.id : String(notification.numericId);
    const source = formatResolutionSource(notification.resolutionNotice?.source);
    return `  ${id}. ${formatReminderSummary(notification.summary)} (${source}).`;
  });

  return {
    text: [
      "[Needs-input resolution notice]",
      header,
      ...lines,
      "Do not run `takode notify resolve` for these same-session prompts unless a new prompt is recreated later.",
    ].join("\n"),
    notificationIds: visible.map((notification) => notification.id),
    threadRoute: messageRoute,
  };
}

export function buildNeedsInputReminderHistoryEntry(
  reminderText: string,
  timestamp: number,
  idSuffix: string | number = timestamp,
  threadRoute?: ThreadRouteMetadata,
): Extract<BrowserIncomingMessage, { type: "user_message" }> {
  return {
    type: "user_message",
    content: reminderText,
    timestamp,
    id: `needs-input-reminder-${idSuffix}`,
    ...(threadRoute ? { threadKey: threadRoute.threadKey } : {}),
    ...(threadRoute?.questId ? { questId: threadRoute.questId } : {}),
    ...(threadRoute?.threadRefs?.length ? { threadRefs: threadRoute.threadRefs } : {}),
    agentSource: {
      sessionId: "system:needs-input-reminder",
      sessionLabel: "Needs Input Reminder",
    },
  };
}

export function buildNeedsInputResolutionNoticeHistoryEntry(
  noticeText: string,
  timestamp: number,
  idSuffix: string | number = timestamp,
  threadRoute?: ThreadRouteMetadata,
): Extract<BrowserIncomingMessage, { type: "user_message" }> {
  return {
    type: "user_message",
    content: noticeText,
    timestamp,
    id: `needs-input-resolution-notice-${idSuffix}`,
    ...(threadRoute ? { threadKey: threadRoute.threadKey } : {}),
    ...(threadRoute?.questId ? { questId: threadRoute.questId } : {}),
    ...(threadRoute?.threadRefs?.length ? { threadRefs: threadRoute.threadRefs } : {}),
    agentSource: {
      sessionId: "system:needs-input-resolution",
      sessionLabel: "Needs Input Resolution",
    },
  };
}

export function commitNeedsInputResolutionNoticeHistoryEntry(
  session: AdapterBrowserRoutingSessionLike,
  notice: ReturnType<typeof buildNeedsInputResolutionNoticeForDirectUserMessage>,
  timestamp: number,
  deps: Pick<AdapterBrowserRoutingDeps, "broadcastToBrowsers">,
): void {
  if (!notice) return;
  const noticeHistoryEntry = buildNeedsInputResolutionNoticeHistoryEntry(
    notice.text,
    timestamp,
    timestamp,
    notice.threadRoute,
  );
  session.messageHistory.push(noticeHistoryEntry);
  deps.broadcastToBrowsers(session, noticeHistoryEntry);
  markNeedsInputResolutionNoticesDelivered(session, notice.notificationIds);
}

export function markNeedsInputResolutionNoticesQueued(
  session: AdapterBrowserRoutingSessionLike,
  notificationIds: readonly string[] | undefined,
  queuedInputId: string,
): void {
  for (const notificationId of notificationIds ?? []) {
    const notification = session.notifications?.find((entry) => entry.id === notificationId);
    if (notification?.resolutionNotice?.status !== "pending") continue;
    notification.resolutionNotice.status = "queued";
    notification.resolutionNotice.queuedInputId = queuedInputId;
  }
}

export function markNeedsInputResolutionNoticesDelivered(
  session: Pick<AdapterBrowserRoutingSessionLike, "notifications">,
  notificationIds: readonly string[] | undefined,
  queuedInputId?: string,
): void {
  const deliveredAt = Date.now();
  for (const notificationId of notificationIds ?? []) {
    const notification = session.notifications?.find((entry) => entry.id === notificationId);
    if (!notification?.resolutionNotice) continue;
    if (queuedInputId && notification.resolutionNotice.queuedInputId !== queuedInputId) continue;
    notification.resolutionNotice = {
      ...notification.resolutionNotice,
      status: "delivered",
      deliveredAt,
    };
  }
}

export function restoreQueuedNeedsInputResolutionNotices(
  session: Pick<AdapterBrowserRoutingSessionLike, "notifications">,
  queuedInputId: string,
): void {
  for (const notification of session.notifications ?? []) {
    if (notification.resolutionNotice?.status !== "queued") continue;
    if (notification.resolutionNotice.queuedInputId !== queuedInputId) continue;
    notification.resolutionNotice = {
      source: notification.resolutionNotice.source,
      resolvedAt: notification.resolutionNotice.resolvedAt,
      status: "pending",
    };
  }
}

export function shouldCommitNeedsInputResolutionNoticeHistoryEntry(
  session: Pick<AdapterBrowserRoutingSessionLike, "notifications">,
  notificationIds: readonly string[] | undefined,
  queuedInputId: string,
): boolean {
  if (!notificationIds?.length) return false;
  return notificationIds.every((notificationId) => {
    const notification = session.notifications?.find((entry) => entry.id === notificationId);
    return (
      notification?.category === "needs-input" &&
      notification.done &&
      notification.resolutionNotice?.status === "queued" &&
      notification.resolutionNotice.queuedInputId === queuedInputId
    );
  });
}

export function commitQueuedNeedsInputResolutionNoticeHistoryEntry(
  session: Pick<AdapterBrowserRoutingSessionLike, "notifications" | "messageHistory">,
  pending: Pick<
    PendingCodexInput,
    | "id"
    | "timestamp"
    | "needsInputResolutionNoticeText"
    | "needsInputResolutionNoticeIds"
    | "threadKey"
    | "questId"
    | "threadRefs"
  >,
  deps: { broadcastToBrowsers: (session: any, msg: BrowserIncomingMessage) => void },
): void {
  if (
    !pending.needsInputResolutionNoticeText ||
    !shouldCommitNeedsInputResolutionNoticeHistoryEntry(session, pending.needsInputResolutionNoticeIds, pending.id)
  ) {
    return;
  }
  const noticeHistoryEntry = buildNeedsInputResolutionNoticeHistoryEntry(
    pending.needsInputResolutionNoticeText,
    pending.timestamp,
    pending.id,
    pending.threadKey
      ? {
          threadKey: pending.threadKey,
          ...(pending.questId ? { questId: pending.questId } : {}),
          ...(pending.threadRefs?.length ? { threadRefs: pending.threadRefs } : {}),
        }
      : undefined,
  );
  session.messageHistory.push(noticeHistoryEntry);
  deps.broadcastToBrowsers(session, noticeHistoryEntry);
  markNeedsInputResolutionNoticesDelivered(session, pending.needsInputResolutionNoticeIds, pending.id);
}

export function prependNeedsInputReminderToContent(
  content: string | unknown[],
  reminderText: string | undefined,
): string | unknown[] {
  if (!reminderText) return content;
  if (typeof content === "string") return `${reminderText}\n\n${content}`;
  return [{ type: "text", text: reminderText }, ...content];
}

export function prependNeedsInputNoticesToContent(
  content: string | unknown[],
  resolutionNoticeText: string | undefined,
  reminderText: string | undefined,
): string | unknown[] {
  const notices = [resolutionNoticeText, reminderText].filter((notice): notice is string => !!notice);
  if (notices.length === 0) return content;
  const prefix = notices.join("\n\n");
  if (typeof content === "string") return `${prefix}\n\n${content}`;
  return [{ type: "text", text: prefix }, ...content];
}
