import type { BrowserIncomingMessage, SessionNotification, ThreadRef } from "../session-types.js";
import { routeFromHistoryEntry, routeKey, type ThreadRouteMetadata } from "../thread-routing-metadata.js";
import {
  THREAD_OUTCOME_REMINDER_SOURCE_ID,
  THREAD_OUTCOME_REMINDER_SOURCE_LABEL,
} from "../../shared/thread-outcome-reminder.js";

type LeaderThreadOutcomeSession = {
  id: string;
  messageHistory: BrowserIncomingMessage[];
  notifications?: SessionNotification[];
  leaderThreadOutcomeValidatedHistoryLength?: number;
};

export type LeaderThreadOutcomeTurnSource = "user" | "leader" | "system" | "unknown";

export type LeaderThreadOutcomeValidationResult =
  | { checked: false; reason: "not_leader" | "system_turn" | "no_new_history" }
  | { checked: true; missing: string[]; injected: boolean };

export interface LeaderThreadOutcomeValidationDeps {
  isLeaderSession: (sessionId: string) => boolean;
  getTurnSource?: (session: LeaderThreadOutcomeSession) => LeaderThreadOutcomeTurnSource;
  injectUserMessage: (
    sessionId: string,
    content: string,
    agentSource: { sessionId: string; sessionLabel?: string },
    threadRoute?: ThreadRouteMetadata,
  ) => "sent" | "queued" | "dropped" | "no_session";
  persistSession?: (session: LeaderThreadOutcomeSession) => void;
}

type TouchedThread = {
  route: ThreadRouteMetadata;
  key: string;
  earliestTimestamp: number;
  latestTimestamp: number;
  latestIndex: number;
};

export function validateLeaderThreadOutcomes(
  session: LeaderThreadOutcomeSession,
  deps: LeaderThreadOutcomeValidationDeps,
): LeaderThreadOutcomeValidationResult {
  if (!deps.isLeaderSession(session.id)) return { checked: false, reason: "not_leader" };

  const history = session.messageHistory ?? [];
  const startIndex = clampHistoryIndex(session.leaderThreadOutcomeValidatedHistoryLength, history.length);
  if (startIndex >= history.length) return { checked: false, reason: "no_new_history" };
  if (deps.getTurnSource?.(session) === "system") {
    session.leaderThreadOutcomeValidatedHistoryLength = history.length;
    deps.persistSession?.(session);
    return { checked: false, reason: "system_turn" };
  }

  const touchedThreads = collectTouchedLeaderThreads(history, startIndex);
  session.leaderThreadOutcomeValidatedHistoryLength = history.length;

  const missing = touchedThreads.filter((thread) => !hasFreshOutcomeMarker(thread, session.notifications ?? []));
  if (missing.length === 0) {
    deps.persistSession?.(session);
    return { checked: true, missing: [], injected: false };
  }

  const firstMissing = missing[0]!;
  const delivery = deps.injectUserMessage(
    session.id,
    buildReminderContent(missing),
    { sessionId: THREAD_OUTCOME_REMINDER_SOURCE_ID, sessionLabel: THREAD_OUTCOME_REMINDER_SOURCE_LABEL },
    firstMissing.route,
  );
  session.leaderThreadOutcomeValidatedHistoryLength = Math.max(
    session.leaderThreadOutcomeValidatedHistoryLength ?? 0,
    history.length,
  );
  deps.persistSession?.(session);
  return {
    checked: true,
    missing: missing.map((thread) => thread.route.threadKey),
    injected: delivery !== "dropped" && delivery !== "no_session",
  };
}

function clampHistoryIndex(value: number | undefined, historyLength: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return 0;
  return Math.min(value, historyLength);
}

function collectTouchedLeaderThreads(history: BrowserIncomingMessage[], startIndex: number): TouchedThread[] {
  const byThread = new Map<string, TouchedThread>();
  for (let index = startIndex; index < history.length; index += 1) {
    const entry = history[index]!;
    if (!isLeaderVisibleOutput(entry)) continue;
    const route = routeFromHistoryEntry(entry);
    if (!route) continue;
    const key = routeKey(route);
    const timestamp = getHistoryTimestamp(entry);
    const existing = byThread.get(key);
    if (!existing) {
      byThread.set(key, {
        route,
        key,
        earliestTimestamp: timestamp,
        latestTimestamp: timestamp,
        latestIndex: index,
      });
      continue;
    }
    if (isLaterOrEqual(existing, timestamp, index)) continue;
    byThread.set(key, { ...existing, route, latestTimestamp: timestamp, latestIndex: index });
  }
  return [...byThread.values()].sort((left, right) => left.latestIndex - right.latestIndex);
}

function isLaterOrEqual(existing: TouchedThread, timestamp: number, index: number): boolean {
  if (existing.latestTimestamp !== timestamp) return existing.latestTimestamp > timestamp;
  return existing.latestIndex >= index;
}

function isLeaderVisibleOutput(entry: BrowserIncomingMessage): boolean {
  if (entry.type === "leader_user_message") return hasText(entry.content);
  if (entry.type !== "assistant" || entry.parent_tool_use_id !== null) return false;
  return entry.message.content.some((block) => block.type === "text" && hasText(block.text));
}

function hasText(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function getHistoryTimestamp(entry: BrowserIncomingMessage): number {
  const timestamp = (entry as { timestamp?: unknown }).timestamp;
  return typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : 0;
}

function hasFreshOutcomeMarker(thread: TouchedThread, notifications: SessionNotification[]): boolean {
  return notifications.some((notification) => {
    if (!sameThread(thread, notification)) return false;
    if (notification.timestamp < thread.earliestTimestamp) return false;
    if (notification.category === "needs-input") return !notification.done;
    if (notification.category === "waiting") return !notification.done;
    return notification.category === "review";
  });
}

function sameThread(
  thread: TouchedThread,
  notification: { threadKey?: string; questId?: string; threadRefs?: ThreadRef[] },
) {
  const notificationThreadKey =
    notification.threadKey ?? notification.questId ?? notification.threadRefs?.[0]?.threadKey;
  return routeKey({ threadKey: notificationThreadKey }) === thread.key;
}

function buildReminderContent(missing: TouchedThread[]): string {
  const labels = missing.map((thread) => formatThreadLabel(thread.route.threadKey)).join(", ");
  return [
    "Thread outcome reminder: mark every touched leader thread with a fresh outcome before idling.",
    `Missing outcome marker for: ${labels}.`,
    'Use `takode notify needs-input "..."` only for user-blocking prompts, `takode notify waiting "..."` for non-attention waiting/WIP, or `takode notify review "..."` or quest completion when done.',
  ].join("\n");
}

function formatThreadLabel(threadKey: string): string {
  return threadKey === "main" ? "Main" : threadKey;
}
