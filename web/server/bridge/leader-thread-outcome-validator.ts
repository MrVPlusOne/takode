import type { BrowserIncomingMessage, SessionNotification, ThreadRef } from "../session-types.js";
import { isRootAgentHistoryMessage } from "../root-agent-feed-message.js";
import { isActualHumanUserMessage } from "../user-message-classification.js";
import { buildLeaderThreadResponseState, leaderResponseThreadKeyForUserMessage } from "../leader-thread-response.js";
import {
  routeFromHistoryEntry,
  routeKey,
  threadRouteForTarget,
  type ThreadRouteMetadata,
} from "../thread-routing-metadata.js";
import {
  THREAD_OUTCOME_REMINDER_SOURCE_ID,
  THREAD_OUTCOME_REMINDER_SOURCE_LABEL,
} from "../../shared/thread-outcome-reminder.js";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";

export const THREAD_RESPONSE_REMINDER_SOURCE_ID = THREAD_OUTCOME_REMINDER_SOURCE_ID;
export const THREAD_RESPONSE_REMINDER_SOURCE_LABEL = THREAD_OUTCOME_REMINDER_SOURCE_LABEL;

type LeaderThreadOutcomeSession = {
  id: string;
  messageHistory: BrowserIncomingMessage[];
  notifications?: SessionNotification[];
  state?: { leaderThreadStatuses?: Record<string, LeaderThreadStatus> };
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
  textEvents: Array<{ text: string; timestamp: number }>;
};

type FreshOutcomeKind = "waiting" | "ready" | "needs-input" | "review";

const BLOCKING_PROMPT_PATTERNS = [
  /^\s*(?:#{1,6}\s*)?(?:\*\*)?Proposed quest(?:\*\*)?\s*:?\s*$/im,
  /^\s*(?:\*\*)?Please confirm or correct\.?(?:\*\*)?\s*$/im,
  /^\s*(?:#{1,6}\s*)?(?:\*\*)?Decision needed(?:\*\*)?\s*:?/im,
];

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

  const missingNeedsInputPrompts = touchedThreads.filter(
    (thread) => hasBlockingApprovalPrompt(thread) && !hasFreshSameThreadNeedsInput(thread, session.notifications ?? []),
  );
  if (missingNeedsInputPrompts.length > 0) {
    const firstMissingPrompt = missingNeedsInputPrompts[0]!;
    const delivery = deps.injectUserMessage(
      session.id,
      buildNeedsInputPromptReminderContent(missingNeedsInputPrompts),
      { sessionId: THREAD_RESPONSE_REMINDER_SOURCE_ID, sessionLabel: THREAD_RESPONSE_REMINDER_SOURCE_LABEL },
      firstMissingPrompt.route,
    );
    settleValidatedHistoryLength(session, history);
    deps.persistSession?.(session);
    return {
      checked: true,
      missing: missingNeedsInputPrompts.map((thread) => thread.route.threadKey),
      injected: delivery !== "dropped" && delivery !== "no_session",
    };
  }

  const pendingResponseMissing: TouchedThread[] = [];
  const outcomeMissing: TouchedThread[] = [];
  for (const thread of touchedThreads) {
    const outcome = freshOutcomeKind(thread, session.notifications ?? [], session.state?.leaderThreadStatuses);
    const pending = buildLeaderThreadResponseState(session, thread.key).projection.pendingMessageCount;
    if (pending > 0) {
      if (outcome !== "waiting" && outcome !== "needs-input") pendingResponseMissing.push(thread);
    } else if (!outcome) {
      outcomeMissing.push(thread);
    }
  }

  if (pendingResponseMissing.length === 0 && outcomeMissing.length === 0) {
    deps.persistSession?.(session);
    return { checked: true, missing: [], injected: false };
  }

  const primary = pendingResponseMissing[0] ?? outcomeMissing[0]!;
  const delivery = deps.injectUserMessage(
    session.id,
    pendingResponseMissing.length > 0
      ? buildPendingResponseReminderContent(session, pendingResponseMissing, outcomeMissing)
      : buildOutcomeReminderContent(outcomeMissing),
    { sessionId: THREAD_RESPONSE_REMINDER_SOURCE_ID, sessionLabel: THREAD_RESPONSE_REMINDER_SOURCE_LABEL },
    primary.route,
  );
  settleValidatedHistoryLength(session, history);
  deps.persistSession?.(session);
  return {
    checked: true,
    missing: [...pendingResponseMissing, ...outcomeMissing].map((thread) => thread.route.threadKey),
    injected: delivery !== "dropped" && delivery !== "no_session",
  };
}

function settleValidatedHistoryLength(session: LeaderThreadOutcomeSession, history: BrowserIncomingMessage[]): void {
  session.leaderThreadOutcomeValidatedHistoryLength = Math.max(
    session.leaderThreadOutcomeValidatedHistoryLength ?? 0,
    history.length,
  );
}

function clampHistoryIndex(value: number | undefined, historyLength: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return 0;
  return Math.min(value, historyLength);
}

function collectTouchedLeaderThreads(history: BrowserIncomingMessage[], startIndex: number): TouchedThread[] {
  const byThread = new Map<string, TouchedThread>();
  const touch = (route: ThreadRouteMetadata, timestamp: number, index: number, text?: string) => {
    const key = routeKey(route);
    const existing = byThread.get(key);
    if (!existing) {
      byThread.set(key, {
        route,
        key,
        earliestTimestamp: timestamp,
        latestTimestamp: timestamp,
        latestIndex: index,
        textEvents: text ? [{ text, timestamp }] : [],
      });
      return;
    }
    existing.earliestTimestamp = Math.min(existing.earliestTimestamp, timestamp);
    if (
      timestamp > existing.latestTimestamp ||
      (timestamp === existing.latestTimestamp && index > existing.latestIndex)
    ) {
      existing.route = route;
      existing.latestTimestamp = timestamp;
      existing.latestIndex = index;
    }
    if (text) existing.textEvents.push({ text, timestamp });
  };

  for (let index = startIndex; index < history.length; index += 1) {
    const entry = history[index]!;
    const timestamp = getHistoryTimestamp(entry);
    if (
      isRootAgentHistoryMessage(entry) &&
      isActualHumanUserMessage(entry) &&
      entry.id &&
      entry.leaderResponseCoverageVersion === 1
    ) {
      const threadKey = leaderResponseThreadKeyForUserMessage(entry);
      if (threadKey) touch(threadRouteForTarget(threadKey), timestamp, index);
    }
    const text = getLeaderVisibleOutputText(entry);
    const route = text ? routeFromHistoryEntry(entry) : null;
    if (text && route) touch(route, timestamp, index, text);
  }
  return [...byThread.values()].sort((left, right) => left.latestIndex - right.latestIndex);
}

function getLeaderVisibleOutputText(entry: BrowserIncomingMessage): string | null {
  if (entry.type === "leader_user_message") return hasText(entry.content) ? entry.content : null;
  if (entry.type !== "assistant" || entry.parent_tool_use_id !== null) return null;
  const text = entry.message.content
    .flatMap((block) => (block.type === "text" && hasText(block.text) ? [block.text] : []))
    .join("\n");
  return hasText(text) ? text : null;
}

function hasText(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function getHistoryTimestamp(entry: BrowserIncomingMessage): number {
  const timestamp = (entry as { timestamp?: unknown }).timestamp;
  return typeof timestamp === "number" && Number.isFinite(timestamp) ? timestamp : 0;
}

function blockingPromptTimestamp(thread: TouchedThread): number | null {
  let latest: number | null = null;
  for (const event of thread.textEvents) {
    if (!BLOCKING_PROMPT_PATTERNS.some((pattern) => pattern.test(event.text))) continue;
    latest = latest === null ? event.timestamp : Math.max(latest, event.timestamp);
  }
  return latest;
}

function hasBlockingApprovalPrompt(thread: TouchedThread): boolean {
  return blockingPromptTimestamp(thread) !== null;
}

function freshOutcomeKind(
  thread: TouchedThread,
  notifications: SessionNotification[],
  threadStatuses?: Record<string, LeaderThreadStatus>,
): FreshOutcomeKind | null {
  const status = threadStatuses?.[thread.key];
  if (status && status.timestamp >= thread.earliestTimestamp) return status.kind;

  for (const notification of notifications) {
    if (!sameThread(thread, notification) || notification.timestamp < thread.earliestTimestamp) continue;
    if (notification.category === "needs-input" && !notification.done) return "needs-input";
    if (notification.category === "waiting" && !notification.done) return "waiting";
    if (notification.category === "review") return "review";
  }
  return null;
}

function hasFreshSameThreadNeedsInput(thread: TouchedThread, notifications: SessionNotification[]): boolean {
  const promptTimestamp = blockingPromptTimestamp(thread);
  if (promptTimestamp === null) return false;
  return notifications.some(
    (notification) =>
      sameThread(thread, notification) &&
      notification.timestamp >= promptTimestamp &&
      notification.category === "needs-input" &&
      !notification.done,
  );
}

function sameThread(
  thread: TouchedThread,
  notification: { threadKey?: string; questId?: string; threadRefs?: ThreadRef[] },
) {
  const notificationThreadKey =
    notification.threadKey ?? notification.questId ?? notification.threadRefs?.[0]?.threadKey;
  return routeKey({ threadKey: notificationThreadKey }) === thread.key;
}

function buildPendingResponseReminderContent(
  session: LeaderThreadOutcomeSession,
  pendingMissing: TouchedThread[],
  outcomeMissing: TouchedThread[],
): string {
  const pendingLabels = pendingMissing.map((thread) => {
    const pending = buildLeaderThreadResponseState(session, thread.key).projection;
    return `${formatThreadLabel(thread.key)} (${pending.pendingMessageCount} pending)`;
  });
  return [
    "Thread response reminder: direct user messages still need an explicit revisable leader response before the thread can be Ready.",
    `Pending response batches: ${pendingLabels.join(", ")}.`,
    "Use `takode thread-response set --thread <main|q-N>` when the answer is ready; Takode snapshots the server-owned batch, so do not duplicate the same prose in a normal response.",
    "If work is not complete, use a fresh Thread Waiting marker or same-thread needs-input notification instead of Thread Ready.",
    ...(outcomeMissing.length > 0
      ? [`Also missing a normal Waiting/Ready/notification outcome for: ${formatThreadLabels(outcomeMissing)}.`]
      : []),
  ].join("\n");
}

function buildOutcomeReminderContent(missing: TouchedThread[]): string {
  return [
    "Thread outcome reminder: mark every touched leader thread with a fresh outcome before idling.",
    `Missing outcome marker for: ${formatThreadLabels(missing)}.`,
    "This is about outcome status for already routed leader output; it is not diagnosing missing `[thread:...]` visible-text markers or `# thread:...` shell-command markers.",
    "Before marking a thread Ready, verify any promised durable action is actually complete: quest creation/refinement, board rows, needs-input notifications, worker sends, phase dispatches, Port/push, or other external records. If not, mark the thread Waiting or incomplete instead.",
    'Use `takode notify needs-input "..."` only for user-blocking prompts. For non-blocking thread status, add a standalone `{[(Thread Waiting: thread | summary)]}` or `{[(Thread Ready: thread | summary)]}` line to your assistant response.',
  ].join("\n");
}

function buildNeedsInputPromptReminderContent(missing: TouchedThread[]): string {
  return [
    "Needs-input notification reminder: this leader response appears to ask for a blocking user decision, but no fresh same-thread `takode notify needs-input` notification was created.",
    `Blocking prompt detected for: ${formatThreadLabels(missing)}.`,
    "This is about a missing same-thread needs-input notification after routed leader output; it is not diagnosing missing `[thread:...]` visible-text markers or `# thread:...` shell-command markers.",
    "Publish or revise the covering thread response, then create the fresh same-thread needs-input notification.",
    "Existing unresolved needs-input prompts do not cover a new approval or decision prompt.",
  ].join("\n");
}

function formatThreadLabels(threads: TouchedThread[]): string {
  return threads.map((thread) => formatThreadLabel(thread.route.threadKey)).join(", ");
}

function formatThreadLabel(threadKey: string): string {
  return threadKey === "main" ? "Main" : threadKey;
}
