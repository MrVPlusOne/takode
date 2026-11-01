import { normalizeThreadKey } from "../shared/leader-projection.js";
import {
  leaderResponseOriginalThreadKey,
  leaderResponseOwnerThreadKey,
} from "../shared/leader-thread-response-routing.js";
import { questSources } from "./quest-source-index.js";
import type { BrowserIncomingMessage } from "./session-types.js";

/**
 * The quests a thread's requests went to: quests filed from its messages (`--source-message`) and
 * quests its messages were handed off to. A thread "started from" a quest (opened while the user
 * looked at it) has not gone there.
 */
export function questsOfThread(history: readonly BrowserIncomingMessage[], threadKey: string): string[] {
  const key = normalizeThreadKey(threadKey);
  const quests = new Set(questSources.startedIn(key));
  for (const message of history) {
    if (message.type !== "user_message") continue;
    const fields = message as Parameters<typeof leaderResponseOwnerThreadKey>[0];
    if (normalizeThreadKey(leaderResponseOriginalThreadKey(fields) ?? "") !== key) continue;
    const owner = leaderResponseOwnerThreadKey(fields);
    if (owner && /^q-\d+$/.test(owner)) quests.add(owner);
  }
  return [...quests];
}
