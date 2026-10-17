import type { QuestStartedFrom } from "../../server/quest-types.js";

/** A quest filed from one of the user's messages in a leader session. */
export interface StartedQuest {
  questId: string;
  title: string;
  startedFrom: QuestStartedFrom;
}

/** The quests filed from the user's messages in this leader session. */
export async function fetchStartedQuests(sessionId: string, signal?: AbortSignal): Promise<StartedQuest[]> {
  const res = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/started-quests`, { signal });
  if (!res.ok) throw new Error(`started quests: ${res.status}`);
  return ((await res.json()) as { quests: StartedQuest[] }).quests;
}
