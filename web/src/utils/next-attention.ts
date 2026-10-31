import type { ThreadMonitoringEntry } from "../../shared/thread-monitoring.js";
import type { SdkSessionInfo, SessionNotification } from "../types.js";
import type { GlobalNeedsInputEntry } from "./global-needs-input.js";
import { hasUnreadSessionAttention } from "./session-attention-status.js";
import {
  resolveLeaderThreadTabsProjection,
  type LeaderThreadTabsProjectionSource,
} from "./leader-thread-tabs-resolver.js";
import { resolveNotificationOwnerThreadKey } from "./notification-thread.js";
import { MAIN_THREAD_KEY } from "./thread-projection.js";

/**
 * The attention queue: everything that needs the user, in the order the
 * attention navigators visit it (the global list and its Next, and each
 * session's feed chip).
 *
 * Sections come in a fixed priority: questions, answers a leader marked urgent,
 * reminders that came due, unread answers (grouped by topic), then watched quests
 * with a result. Newest first within a section (and within a topic). A thread that already appears in an
 * earlier section is not repeated as unread.
 */
export type NextAttentionItem =
  | (NextAttentionBase & { kind: "needs-input"; entry: GlobalNeedsInputEntry })
  | (NextAttentionBase & { kind: "notify-me"; entry: ThreadMonitoringEntry })
  | (NextAttentionBase & {
      kind: "unread";
      summary?: string;
      /** Set for a thread snoozed with "Remind me later": when it comes back. */
      remindAt?: number;
      /** For one unread answer, report or finished quest: its notification and message. */
      notification?: SessionNotification;
      /** The Library topic of its quest, when the leader has topics on: the list groups by it. */
      topic?: { id: string; name: string } | null;
    });

interface NextAttentionBase {
  /** Stable identity across queue rebuilds, used to remember where Next last went. */
  key: string;
  sessionId: string;
  /** Thread the item lives in; null when only the session is known. */
  threadKey: string | null;
  label: string;
  timestamp: number;
}

export interface UnreadAttentionCandidate {
  sessionId: string;
  threadKey: string | null;
  label: string;
  timestamp: number;
  /** What the thread's newest unread result is, when the leader's tab projection says. */
  summary?: string;
  /** Set for one unread message (answer, report or finished quest) rather than a whole thread. */
  notification?: SessionNotification;
}

/**
 * The sections of the attention list, in the order Next visits them: questions, urgent answers,
 * reminders that came due, unread answers, and results of watched quests. Urgent answers come
 * right after questions: a question holds up an agent and is quick to answer, while an urgent
 * answer is time-sensitive reading that should come before everything else.
 */
export type AttentionSection = "needs-input" | "urgent" | "reminder" | "unread" | "notify-me";

export const ATTENTION_SECTIONS: readonly AttentionSection[] = [
  "needs-input",
  "urgent",
  "reminder",
  "unread",
  "notify-me",
];

/**
 * An item's section: a Notify Me result that a "Remind me later" brought back is a reminder, and
 * an unread answer the leader marked urgent is urgent.
 */
export function attentionSection(item: NextAttentionItem): AttentionSection {
  if (item.kind === "notify-me" && item.entry.pending?.reminder) return "reminder";
  if (isUrgentAttentionItem(item)) return "urgent";
  return item.kind;
}

/** An unread answer its leader marked urgent (`A!`). */
export function isUrgentAttentionItem(item: NextAttentionItem): boolean {
  return item.kind === "unread" && item.notification?.urgent === true && item.remindAt === undefined;
}

/**
 * Where a navigator is in its queue: the place of the item it last opened.
 * It is kept as that item's sort position rather than an index, so items that
 * leave or join the queue do not move the cursor back to the start.
 */
export interface AttentionCursor {
  key: string;
  /** The item's place in queue order, compared element by element. */
  place: readonly (number | string)[];
}

/** The topic of a leader's quest thread, as known; null when it has none (or is Main). */
export type AttentionTopicOf = (sessionId: string, threadKey: string | null) => { id: string; name: string } | null;

export function buildNextAttentionQueue(input: {
  needsInput: readonly GlobalNeedsInputEntry[];
  notifyMe: readonly ThreadMonitoringEntry[];
  unread: readonly UnreadAttentionCandidate[];
  topicOf?: AttentionTopicOf;
}): NextAttentionItem[] {
  const items: NextAttentionItem[] = [];
  for (const entry of input.needsInput) {
    items.push({
      kind: "needs-input",
      entry,
      key: `needs-input:${entry.sessionId}:${entry.notification.id}`,
      sessionId: entry.sessionId,
      threadKey: resolveNotificationOwnerThreadKey(entry.notification),
      label: entry.notification.summary || entry.sessionName,
      timestamp: entry.notification.timestamp,
    });
  }
  for (const entry of input.notifyMe) {
    if (!entry.pending) continue;
    items.push({
      kind: "notify-me",
      entry,
      key: `notify-me:${entry.sessionId}:${entry.threadKey}:${entry.pending.id}`,
      sessionId: entry.sessionId,
      threadKey: entry.threadKey,
      label: entry.title,
      timestamp: entry.pending.timestamp,
    });
  }
  const covered = new Set(items.map((item) => coverageKey(item.sessionId, item.threadKey)));
  for (const candidate of input.unread) {
    // A session-level candidate is covered by any earlier item in that session. An urgent
    // answer is never covered: it must show even when its thread also has a question.
    const alreadyQueued =
      candidate.notification?.urgent !== true &&
      (covered.has(coverageKey(candidate.sessionId, candidate.threadKey)) ||
        (candidate.threadKey === null && items.some((item) => item.sessionId === candidate.sessionId)));
    if (alreadyQueued) continue;
    const key = candidate.notification
      ? `unread:${candidate.sessionId}:${candidate.notification.id}`
      : `unread:${candidate.sessionId}:${candidate.threadKey ?? ""}`;
    items.push({
      kind: "unread",
      key,
      ...candidate,
      ...(input.topicOf ? { topic: input.topicOf(candidate.sessionId, candidate.threadKey) } : {}),
    });
  }
  // Unread answers are grouped by topic: the topic with the newest answer first, and inside it in
  // reading order (see queuePlace).
  const newestByTopic = new Map<string, number>();
  for (const item of items) {
    if (item.kind !== "unread") continue;
    const group = topicGroupKey(item);
    newestByTopic.set(group, Math.max(newestByTopic.get(group) ?? 0, item.timestamp));
  }
  for (const item of items) placeOf.set(item, queuePlace(item, newestByTopic));
  return items.sort((a, b) => comparePlaces(placeOf.get(a)!, placeOf.get(b)!, a.key, b.key));
}

/** Each item's place, as computed when its queue was built (topic groups depend on the whole queue). */
const placeOf = new WeakMap<NextAttentionItem, readonly (number | string)[]>();

function queuePlace(item: NextAttentionItem, newestByTopic?: ReadonlyMap<string, number>): (number | string)[] {
  const rank = ATTENTION_SECTIONS.indexOf(attentionSection(item));
  if (item.kind !== "unread" || isUrgentAttentionItem(item) || !newestByTopic) return [rank, -item.timestamp];
  const group = topicGroupKey(item);
  // Inside a topic Next goes in reading order, as opening a place does (firstUnreadResult): answers
  // and reports oldest first, then finished quests. Newest first would open a later result, or a
  // finished quest whose anchor is the leader's commentary, above an answer still waiting.
  const finished = item.notification?.unreadReason === "quest-complete" ? 1 : 0;
  return [rank, -(newestByTopic.get(group) ?? item.timestamp), group, finished, item.timestamp];
}

/** Unread items group by topic; outside a topic, by session and thread. */
function topicGroupKey(item: NextAttentionItem): string {
  if (item.kind === "unread" && item.topic) return `topic:${item.topic.id}`;
  return `thread:${item.sessionId}:${item.threadKey ?? ""}`;
}

/**
 * What the attention list keeps below the queue, collapsed, and Next never
 * visits: muted prompts, and tracked Notify Me threads still waiting for a
 * result. Threads that have a result are already in the queue's Notify Me
 * group, so they are left out here. Newest first.
 */
export function buildAttentionBacklog(input: {
  muted: readonly GlobalNeedsInputEntry[];
  tracked: readonly ThreadMonitoringEntry[];
  reminders?: readonly NextAttentionItem[];
}): AttentionBacklog {
  const muted = buildNextAttentionQueue({ needsInput: input.muted, notifyMe: [], unread: [] });
  const tracked: NextAttentionItem[] = input.tracked
    .filter((entry) => !entry.pending)
    .map((entry) => ({
      kind: "notify-me",
      entry,
      key: `tracked:${entry.sessionId}:${entry.threadKey}`,
      sessionId: entry.sessionId,
      threadKey: entry.threadKey,
      label: entry.title,
      timestamp: entry.trackedAt,
    }));
  tracked.sort((a, b) => b.timestamp - a.timestamp);
  return { muted, tracked, reminders: [...(input.reminders ?? [])] };
}

export interface AttentionBacklog {
  muted: NextAttentionItem[];
  tracked: NextAttentionItem[];
  /** Threads snoozed with "Remind me later", soonest first. */
  reminders: NextAttentionItem[];
}

/**
 * Every leader thread waiting on a "Remind me later", soonest first, from the leaders'
 * tab projections. Archived leaders keep theirs on the server but are not listed.
 */
export function collectThreadReminders(
  state: LeaderThreadTabsProjectionSource & { sdkSessions: readonly SdkSessionInfo[] },
): NextAttentionItem[] {
  const items: NextAttentionItem[] = [];
  for (const session of state.sdkSessions) {
    if (session.archived || !session.isOrchestrator) continue;
    const projection = resolveLeaderThreadTabsProjection(state, session.sessionId).value;
    for (const [threadKey, reminder] of Object.entries(projection?.threadReminders ?? {})) {
      const tab = projection?.tabs.find((candidate) => candidate.threadKey === threadKey);
      items.push({
        kind: "unread",
        key: `reminder:${session.sessionId}:${threadKey}`,
        sessionId: session.sessionId,
        threadKey,
        label: threadKey === MAIN_THREAD_KEY ? "Main" : (tab?.title ?? threadKey),
        // No age: the row shows when the thread comes back instead.
        timestamp: 0,
        remindAt: reminder.remindAt,
      });
    }
  }
  return items.sort((a, b) => (a.kind === "unread" && b.kind === "unread" ? (a.remindAt ?? 0) - (b.remindAt ?? 0) : 0));
}

/**
 * The place an item points to, for counting: every question, urgent answer, reminder and watched
 * result is its own place; other unread answers count once per topic (or per quest or Main outside
 * topics). Counts show places, so a busy topic is one thing to look at, not ten.
 */
export function attentionPlaceKey(item: NextAttentionItem): string {
  return item.kind === "unread" && !isUrgentAttentionItem(item) ? topicGroupKey(item) : item.key;
}

/** How many places the queue points to. */
export function countAttentionPlaces(queue: readonly NextAttentionItem[]): number {
  return new Set(queue.map(attentionPlaceKey)).size;
}

/** The 0-based place of `item` among the queue's places, in queue order. */
export function attentionPlaceIndex(queue: readonly NextAttentionItem[], item: NextAttentionItem): number {
  const places: string[] = [];
  for (const candidate of queue) {
    const place = attentionPlaceKey(candidate);
    if (places.at(-1) !== place && !places.includes(place)) places.push(place);
    if (candidate.key === item.key) return places.indexOf(place);
  }
  return Math.max(0, places.length - 1);
}

/**
 * How many new things unread items hold: answers to the same request of the user count as one,
 * as do repeats of one thread-level item.
 */
export function countNewThings(items: readonly NextAttentionItem[]): number {
  const things = new Set<string>();
  for (const item of items) {
    const answerTo = item.kind === "unread" ? item.notification?.answerTo : undefined;
    things.add(answerTo?.length ? `request:${[...answerTo].sort().join(",")}` : item.key);
  }
  return things.size;
}

export function attentionCursorFor(item: NextAttentionItem): AttentionCursor {
  return { key: item.key, place: placeOf.get(item) ?? queuePlace(item) };
}

function compareQueuePlace(a: AttentionCursor, b: AttentionCursor): number {
  return comparePlaces(a.place, b.place, a.key, b.key);
}

function comparePlaces(
  a: readonly (number | string)[],
  b: readonly (number | string)[],
  aKey: string,
  bKey: string,
): number {
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const left = a[index];
    const right = b[index];
    if (left === right) continue;
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (typeof left === "number" && typeof right === "number") return left - right;
    return String(left) < String(right) ? -1 : 1;
  }
  return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
}

/**
 * Pick the item a navigator opens next: the first item placed after the cursor,
 * wrapping to the top at the end, so repeated steps walk the whole queue into
 * the lower-priority groups. Without a cursor it starts at the top. An item
 * that was answered or read simply drops out, and a new one is visited when the
 * walk reaches its place.
 */
export function pickAttentionAfter(
  queue: readonly NextAttentionItem[],
  cursor: AttentionCursor | null,
): { item: NextAttentionItem; position: number } | null {
  if (queue.length === 0) return null;
  const index = cursor ? queue.findIndex((item) => compareQueuePlace(attentionCursorFor(item), cursor) > 0) : 0;
  const position = index >= 0 ? index : 0;
  return { item: queue[position]!, position };
}

/**
 * One session's queue for the feed's attention chip: the same groups, order and
 * coverage as Next, limited to that session. Unlike the global queue it keeps
 * prompts from herded sessions, because the chip belongs to the session itself.
 */
export function buildSessionAttentionQueue(input: {
  sessionId: string;
  sessionName: string;
  sessionNum: number | null;
  /** The session's unresolved, unmuted needs-input notifications. */
  needsInput: readonly SessionNotification[];
  notifyMe: readonly ThreadMonitoringEntry[];
  unread: readonly UnreadAttentionCandidate[];
  topicOf?: AttentionTopicOf;
}): NextAttentionItem[] {
  const { sessionId, sessionName, sessionNum } = input;
  return buildNextAttentionQueue({
    needsInput: input.needsInput.map((notification) => ({ sessionId, sessionName, sessionNum, notification })),
    notifyMe: input.notifyMe.filter((entry) => entry.sessionId === sessionId),
    unread: input.unread.filter((candidate) => candidate.sessionId === sessionId),
    ...(input.topicOf ? { topicOf: input.topicOf } : {}),
  });
}

/**
 * Unread Ready results from synchronized state. Leader sessions with a loaded
 * tab projection contribute one candidate per unread thread; otherwise a
 * session whose unread mark is a review or error contributes a session-level one.
 */
export function collectUnreadAttention(
  state: LeaderThreadTabsProjectionSource & {
    sdkSessions: readonly SdkSessionInfo[];
    sessionAttention?: ReadonlyMap<string, "action" | "error" | "review" | null>;
    sessionNotifications?: ReadonlyMap<string, readonly SessionNotification[]>;
  },
): UnreadAttentionCandidate[] {
  const candidates: UnreadAttentionCandidate[] = [];
  for (const session of state.sdkSessions) {
    if (session.archived) continue;
    const sessionLabel = session.name || `Session ${session.sessionId.slice(0, 8)}`;
    const tabs = session.isOrchestrator ? resolveLeaderThreadTabsProjection(state, session.sessionId) : null;
    if (tabs?.projectionState === "accepted") {
      const { mainAttention, tabs: threadTabs } = tabs.value;
      // Once this browser has the leader's notifications, each unread message is its own item.
      const notifications = state.sessionNotifications?.get(session.sessionId);
      if (notifications) {
        const titleOf = (threadKey: string) =>
          threadKey === MAIN_THREAD_KEY
            ? "Main"
            : (threadTabs.find((tab) => tab.threadKey === threadKey)?.title ?? threadKey);
        for (const notification of notifications) {
          if (notification.category !== "review" || notification.done) continue;
          const threadKey = resolveNotificationOwnerThreadKey(notification);
          candidates.push({
            sessionId: session.sessionId,
            threadKey,
            label: titleOf(threadKey),
            timestamp: notification.timestamp,
            ...(notification.summary ? { summary: notification.summary } : {}),
            notification,
          });
        }
        continue;
      }
      // Name the unread result itself, not the thread's latest Ready status, which may be
      // a later quiet check that made nothing unread.
      const resultSummary = ({ reviewSummary }: typeof mainAttention) =>
        reviewSummary ? { summary: reviewSummary } : {};
      if (mainAttention.reviewUnread) {
        candidates.push({
          sessionId: session.sessionId,
          threadKey: MAIN_THREAD_KEY,
          label: "Main",
          timestamp: mainAttention.updatedAt,
          ...resultSummary(mainAttention),
        });
      }
      for (const tab of threadTabs) {
        if (!tab.attention.reviewUnread) continue;
        candidates.push({
          sessionId: session.sessionId,
          threadKey: tab.threadKey,
          label: tab.title ?? tab.questId ?? sessionLabel,
          timestamp: tab.attention.updatedAt,
          ...resultSummary(tab.attention),
        });
      }
      if (candidates.some((candidate) => candidate.sessionId === session.sessionId)) continue;
    }
    if (!hasUnreadSessionAttention(state.sessionAttention?.get(session.sessionId) ?? null)) continue;
    candidates.push({
      sessionId: session.sessionId,
      threadKey: null,
      label: sessionLabel,
      timestamp: session.lastActivityAt ?? session.createdAt ?? 0,
    });
  }
  return candidates;
}

function coverageKey(sessionId: string, threadKey: string | null): string {
  return `${sessionId}\u0000${threadKey ?? ""}`;
}
