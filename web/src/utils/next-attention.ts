import type { ThreadMonitoringEntry } from "../../shared/thread-monitoring.js";
import type { SdkSessionInfo } from "../types.js";
import type { GlobalNeedsInputEntry } from "./global-needs-input.js";
import { hasUnreadSessionAttention } from "./session-attention-status.js";
import {
  resolveLeaderThreadTabsProjection,
  type LeaderThreadTabsProjectionSource,
} from "./leader-thread-tabs-resolver.js";
import { resolveNotificationOwnerThreadKey } from "./notification-thread.js";
import { MAIN_THREAD_KEY } from "./thread-projection.js";

/**
 * The "Next" queue: everything that needs the user, in the order Next visits it.
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

export interface NextAttentionLocation {
  sessionId: string | null;
  threadKey: string | null;
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
  return items.sort(
    (a, b) =>
      GROUP_RANK[a.kind] - GROUP_RANK[b.kind] ||
      b.timestamp - a.timestamp ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  );
}

/**
 * Pick where Next goes: the item after the one being viewed, wrapping around.
 * `lastKey` is the item Next last opened; it disambiguates several items in the
 * same thread so repeated taps keep advancing instead of bouncing between them.
 */
export function pickNextAttention(
  queue: readonly NextAttentionItem[],
  location: NextAttentionLocation,
  lastKey: string | null,
): { item: NextAttentionItem; position: number } | null {
  if (queue.length === 0) return null;
  const isHere = (item: NextAttentionItem) =>
    item.sessionId === location.sessionId &&
    (item.threadKey === null || item.threadKey === (location.threadKey ?? MAIN_THREAD_KEY));
  const lastIndex = queue.findIndex((item) => item.key === lastKey);
  const currentIndex = lastIndex >= 0 && isHere(queue[lastIndex]!) ? lastIndex : queue.findIndex(isHere);
  const position = (currentIndex + 1) % queue.length;
  return { item: queue[position]!, position };
}

/**
 * Unread Ready results from synchronized state. Leader sessions with a loaded
 * tab projection contribute one candidate per unread thread; otherwise a
 * session whose unread mark is a review or error contributes a session-level one.
 */
export function collectUnreadAttention(
  state: LeaderThreadTabsProjectionSource & {
    sdkSessions: readonly SdkSessionInfo[];
    sessionAttention: ReadonlyMap<string, "action" | "error" | "review" | null>;
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
          label: sessionLabel,
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
    if (!hasUnreadSessionAttention(state.sessionAttention.get(session.sessionId) ?? null)) continue;
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
