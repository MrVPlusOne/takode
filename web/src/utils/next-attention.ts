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
 * Groups come in a fixed priority (needs-input, then Notify Me results, then
 * unread Ready results), newest first within a group. A thread that already
 * appears in an earlier group is not repeated as unread.
 */
export type NextAttentionItem =
  | (NextAttentionBase & { kind: "needs-input"; entry: GlobalNeedsInputEntry })
  | (NextAttentionBase & { kind: "notify-me"; entry: ThreadMonitoringEntry })
  | (NextAttentionBase & { kind: "unread" });

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
}

/**
 * Where a navigator is in its queue: the place of the item it last opened.
 * It is kept as that item's sort position rather than an index, so items that
 * leave or join the queue do not move the cursor back to the start.
 */
export interface AttentionCursor {
  key: string;
  rank: number;
  timestamp: number;
}

const GROUP_RANK: Record<NextAttentionItem["kind"], number> = { "needs-input": 0, "notify-me": 1, unread: 2 };

export function buildNextAttentionQueue(input: {
  needsInput: readonly GlobalNeedsInputEntry[];
  notifyMe: readonly ThreadMonitoringEntry[];
  unread: readonly UnreadAttentionCandidate[];
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
    // A session-level candidate is covered by any earlier item in that session.
    const alreadyQueued =
      covered.has(coverageKey(candidate.sessionId, candidate.threadKey)) ||
      (candidate.threadKey === null && items.some((item) => item.sessionId === candidate.sessionId));
    if (alreadyQueued) continue;
    items.push({ kind: "unread", key: `unread:${candidate.sessionId}:${candidate.threadKey ?? ""}`, ...candidate });
  }
  return items.sort((a, b) => compareQueuePlace(attentionCursorFor(a), attentionCursorFor(b)));
}

export function attentionCursorFor(item: NextAttentionItem): AttentionCursor {
  return { key: item.key, rank: GROUP_RANK[item.kind], timestamp: item.timestamp };
}

function compareQueuePlace(a: AttentionCursor, b: AttentionCursor): number {
  return a.rank - b.rank || b.timestamp - a.timestamp || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
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
}): NextAttentionItem[] {
  const { sessionId, sessionName, sessionNum } = input;
  return buildNextAttentionQueue({
    needsInput: input.needsInput.map((notification) => ({ sessionId, sessionName, sessionNum, notification })),
    notifyMe: input.notifyMe.filter((entry) => entry.sessionId === sessionId),
    unread: input.unread.filter((candidate) => candidate.sessionId === sessionId),
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
  },
): UnreadAttentionCandidate[] {
  const candidates: UnreadAttentionCandidate[] = [];
  for (const session of state.sdkSessions) {
    if (session.archived) continue;
    const sessionLabel = session.name || `Session ${session.sessionId.slice(0, 8)}`;
    const tabs = session.isOrchestrator ? resolveLeaderThreadTabsProjection(state, session.sessionId) : null;
    if (tabs?.projectionState === "accepted") {
      const { mainAttention, tabs: threadTabs } = tabs.value;
      if (mainAttention.reviewUnread) {
        candidates.push({
          sessionId: session.sessionId,
          threadKey: MAIN_THREAD_KEY,
          label: "Main",
          timestamp: mainAttention.updatedAt,
        });
      }
      for (const tab of threadTabs) {
        if (!tab.attention.reviewUnread) continue;
        candidates.push({
          sessionId: session.sessionId,
          threadKey: tab.threadKey,
          label: tab.title ?? tab.questId ?? sessionLabel,
          timestamp: tab.attention.updatedAt,
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
