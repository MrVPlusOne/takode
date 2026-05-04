import type { ChatMessage, SessionNotification } from "../types.js";

export const NEEDS_INPUT_REMINDER_SOURCE_ID = "system:needs-input-reminder";

export type NeedsInputReminderEntryStatus = "active" | "resolved" | "unknown";

export interface NeedsInputReminderEntryView {
  rawId: string;
  notificationId: string;
  summary: string;
  status: NeedsInputReminderEntryStatus;
}

export interface NeedsInputReminderViewModel {
  entries: NeedsInputReminderEntryView[];
  activeCount: number;
  resolvedCount: number;
  unknownCount: number;
  unlistedCount: number;
  hasPartialState: boolean;
  title: string;
  description: string;
}

interface ParsedNeedsInputReminderEntry {
  rawId: string;
  notificationId: string;
  summary: string;
}

interface ParsedNeedsInputReminder {
  entries: ParsedNeedsInputReminderEntry[];
  totalCount: number | null;
}

function normalizeReminderNotificationId(rawId: string): string | null {
  const trimmed = rawId.trim().toLowerCase();
  if (/^\d+$/.test(trimmed)) return `n-${Number.parseInt(trimmed, 10)}`;
  if (/^n-\d+$/.test(trimmed)) return trimmed;
  return null;
}

function parseNeedsInputReminderContent(content: string): ParsedNeedsInputReminder | null {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "[Needs-input reminder]") return null;
  const totalMatch = lines[1]?.match(/^Unresolved same-session needs-input notifications: (\d+)\./);
  const totalCount = totalMatch ? Number.parseInt(totalMatch[1], 10) : null;

  const entries: ParsedNeedsInputReminderEntry[] = [];
  for (const line of lines.slice(1)) {
    const match = /^\s*(n-\d+|\d+)\.\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    const notificationId = normalizeReminderNotificationId(match[1]);
    if (!notificationId) continue;
    entries.push({
      rawId: match[1],
      notificationId,
      summary: match[2].trim() || "(no summary)",
    });
  }

  return { entries, totalCount };
}

function findNeedsInputNotification(
  notifications: ReadonlyArray<SessionNotification> | undefined,
  notificationId: string,
): SessionNotification | null {
  return (
    notifications?.find(
      (notification) => notification.id === notificationId && notification.category === "needs-input",
    ) ?? null
  );
}

function countUnlistedActiveNotifications(
  notifications: ReadonlyArray<SessionNotification> | undefined,
  listedIds: ReadonlySet<string>,
  reminderTimestamp: number | undefined,
  unlistedCount: number,
): number {
  if (!notifications || unlistedCount <= 0) return 0;

  const activeUnlisted = notifications.filter((notification) => {
    if (notification.category !== "needs-input" || notification.done || listedIds.has(notification.id)) return false;
    if (typeof reminderTimestamp !== "number") return true;
    return notification.timestamp <= reminderTimestamp;
  });
  return Math.min(activeUnlisted.length, unlistedCount);
}

function describeReminderCounts({
  listedActiveCount,
  activeCount,
  resolvedCount,
  unknownCount,
  unlistedCount,
  unlistedActiveCount,
  listedCount,
  totalCount,
}: {
  listedActiveCount: number;
  activeCount: number;
  resolvedCount: number;
  unknownCount: number;
  unlistedCount: number;
  unlistedActiveCount: number;
  listedCount: number;
  totalCount: number | null;
}): string {
  if (unlistedActiveCount > 0) {
    const hiddenLabel =
      unlistedActiveCount === 1
        ? "1 unlisted needs-input notification from this reminder may still be unresolved."
        : `${unlistedActiveCount} unlisted needs-input notifications from this reminder may still be unresolved.`;
    if (listedActiveCount === 0) return hiddenLabel;
  }

  if (activeCount > 0) {
    const activeLabel =
      activeCount === 1
        ? "1 referenced needs-input notification is still unresolved."
        : `${activeCount} referenced needs-input notifications are still unresolved.`;
    const historicalParts: string[] = [];
    if (resolvedCount > 0) historicalParts.push(`${resolvedCount} resolved`);
    if (unknownCount > 0) historicalParts.push(`${unknownCount} unavailable`);
    return historicalParts.length > 0 ? `${activeLabel} Historical: ${historicalParts.join(", ")}.` : activeLabel;
  }

  if (unlistedCount > 0) {
    const originalCount = totalCount ?? listedCount + unlistedCount;
    const unlistedLabel =
      unlistedCount === 1
        ? "1 unlisted notification state is unavailable."
        : `${unlistedCount} unlisted notification states are unavailable.`;
    return `This reminder originally had ${originalCount} unresolved notifications but only listed ${listedCount}; ${unlistedLabel}`;
  }

  if (resolvedCount > 0 && unknownCount === 0) {
    return "All referenced needs-input notifications have since been resolved.";
  }
  if (resolvedCount === 0 && unknownCount > 0) {
    return "Notification state is no longer available for this historical reminder.";
  }
  if (resolvedCount > 0 && unknownCount > 0) {
    return "No referenced notifications are currently active; some notification state is no longer available.";
  }
  return "This historical reminder no longer has parseable notification references.";
}

export function buildNeedsInputReminderViewModel(
  message: Pick<ChatMessage, "agentSource" | "content" | "timestamp">,
  notifications: ReadonlyArray<SessionNotification> | undefined,
): NeedsInputReminderViewModel | null {
  if (message.agentSource?.sessionId !== NEEDS_INPUT_REMINDER_SOURCE_ID) return null;

  const parsed = parseNeedsInputReminderContent(message.content);
  const entries =
    parsed?.entries.map((entry): NeedsInputReminderEntryView => {
      const notification = findNeedsInputNotification(notifications, entry.notificationId);
      return {
        ...entry,
        summary: notification?.summary?.trim() || entry.summary,
        status: notification ? (notification.done ? "resolved" : "active") : "unknown",
      };
    }) ?? [];

  const listedIds = new Set(entries.map((entry) => entry.notificationId));
  const listedActiveCount = entries.filter((entry) => entry.status === "active").length;
  const resolvedCount = entries.filter((entry) => entry.status === "resolved").length;
  const listedUnknownCount = entries.filter((entry) => entry.status === "unknown").length;
  const unlistedCount = Math.max(0, (parsed?.totalCount ?? entries.length) - entries.length);
  const unlistedActiveCount = countUnlistedActiveNotifications(
    notifications,
    listedIds,
    message.timestamp,
    unlistedCount,
  );
  const unlistedUnknownCount = Math.max(0, unlistedCount - unlistedActiveCount);
  const activeCount = listedActiveCount + unlistedActiveCount;
  const unknownCount = listedUnknownCount + unlistedUnknownCount;
  const hasPartialState = activeCount === 0 && unlistedCount > 0;

  return {
    entries,
    activeCount,
    resolvedCount,
    unknownCount,
    unlistedCount,
    hasPartialState,
    title: activeCount > 0 || hasPartialState ? "Needs-input reminder" : "Historical needs-input reminder",
    description: describeReminderCounts({
      listedActiveCount,
      activeCount,
      resolvedCount,
      unknownCount,
      unlistedCount,
      unlistedActiveCount,
      listedCount: entries.length,
      totalCount: parsed?.totalCount ?? null,
    }),
  };
}
