import type { QuestStartedFrom } from "../../server/quest-types.js";

/** A quest filed from one of the user's messages in a leader session. */
export interface StartedQuest {
  questId: string;
  title: string;
  startedFrom: QuestStartedFrom;
  /** A side quest: its request is still answered where it was asked, and the user has not written in its thread. */
  sideQuest: boolean;
}

/** The leader's answer that delivered a supporting quest's result. */
export interface SupportingQuestAnswer {
  messageId: string;
  /** The thread the answer was written in. */
  threadKey: string;
  timestamp: number;
  markdown: string;
}

/** The quests filed from the user's messages in this leader session. */
export async function fetchStartedQuests(sessionId: string, signal?: AbortSignal): Promise<StartedQuest[]> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/started-quests`, { signal });
  if (!res.ok) throw new Error(`started quests: ${res.status}`);
  return ((await res.json()) as { quests: StartedQuest[] }).quests;
}

const changeListeners = new Set<(sessionId: string) => void>();

/**
 * Says a session's requests may now continue in other quests (a handoff moved one), so open
 * lists of its started quests load again: the list is read when loaded, and a request handed off
 * to a quest that already had a thread appears in no other change.
 */
export function noteStartedQuestsChanged(sessionId: string): void {
  for (const listener of changeListeners) listener(sessionId);
}

/** Calls `listener` with the session each time its started quests may have changed; returns the unsubscribe. */
export function onStartedQuestsChanged(listener: (sessionId: string) => void): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/** For a supporting quest, the leader's answer that delivered its result, if one was written. */
export async function fetchSupportingQuestAnswer(
  sessionId: string,
  questId: string,
  signal?: AbortSignal,
): Promise<SupportingQuestAnswer | null> {
  const path = `/api/sessions/${encodeURIComponent(sessionId)}/started-quests/${encodeURIComponent(questId)}/answer`;
  const res = await fetch(path, { signal });
  if (!res.ok) throw new Error(`supporting quest answer: ${res.status}`);
  return ((await res.json()) as { answer: SupportingQuestAnswer | null }).answer;
}
