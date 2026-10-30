import { getQuestJourneyPhase, getQuestJourneyPhaseForState } from "../shared/quest-journey.js";
import { normalizeTopicKey } from "../shared/topic-thread-key.js";
import type { BoardRow, SessionNotification } from "./session-types.js";

/**
 * One line of a leader's overview as its Scribe sees it, keyed by thread: the leader's questions to
 * the user and its unread results there, and the quest's phase while it runs on the board.
 */
export interface OverviewItem {
  key: string;
  title?: string;
  /** Open questions to the user, by their summaries. */
  questions: string[];
  /** Unread answers, reports and finished quests, by their summaries. */
  results: string[];
  /** The quest's phase while it is on the board in progress. */
  running?: string;
}

/**
 * What a leader's overview lists, from the same records the browser builds it from: the leader's
 * open needs-input and unread review notifications, and its board's rows in progress (queued rows
 * are not running).
 */
export function leaderOverviewItems(
  notifications: readonly SessionNotification[],
  board: readonly BoardRow[],
): OverviewItem[] {
  const items = new Map<string, OverviewItem>();
  const itemOf = (key: string) => {
    let item = items.get(key);
    if (!item) items.set(key, (item = { key, questions: [], results: [] }));
    return item;
  };
  for (const notification of notifications) {
    if (notification.done) continue;
    const key = threadKeyOf(notification);
    const summary = notification.summary?.trim() || "(no summary)";
    if (notification.category === "needs-input") itemOf(key).questions.push(summary);
    else if (notification.category === "review") itemOf(key).results.push(summary);
  }
  for (const row of board) {
    if ((row.status ?? "").trim().toUpperCase() === "QUEUED") continue;
    const phase = getQuestJourneyPhase(row.journey?.currentPhaseId) ?? getQuestJourneyPhaseForState(row.status);
    const item = itemOf(row.questId.toLowerCase());
    item.title = row.title;
    item.running = phase?.label ?? row.status ?? "in progress";
  }
  return [...items.values()];
}

/** The thread a notification belongs to: its quest, its topic conversation, else Main. */
function threadKeyOf(notification: SessionNotification): string {
  const key = (notification.threadKey ?? notification.questId ?? "main").trim().toLowerCase();
  if (key.startsWith("topic:")) return normalizeTopicKey(key) ?? "main";
  return /^q-\d+$/.test(key) ? key : "main";
}
