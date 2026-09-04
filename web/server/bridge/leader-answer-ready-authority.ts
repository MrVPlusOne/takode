import { leaderResponseExactAnswerThreadKey } from "../../shared/leader-thread-response-routing.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import { isCurrentValidRoutedLeaderResponseMessage } from "../leader-thread-response.js";

type AssistantHistoryEntry = Extract<BrowserIncomingMessage, { type: "assistant" }>;

export interface CanonicalizedLeaderAnswerRoute {
  selectedThreadKey: string;
  ownerThreadKey: string;
}

/**
 * A selected route repaired onto another owner remains display-only unless a
 * separate current answer in the same turn carries real owner coverage there.
 * Ready markers must not promote a visibility-only destination into answer
 * authority merely because its pending-owned-message count is zero.
 */
export function displayOnlyCanonicalizedLeaderAnswerThreads(
  session: { id: string; messageHistory: BrowserIncomingMessage[] },
  turnEntries: readonly AssistantHistoryEntry[],
  canonicalizedRoutes: readonly CanonicalizedLeaderAnswerRoute[],
): Set<string> {
  if (canonicalizedRoutes.length === 0) return new Set();

  const currentOwnerAnswerThreads = new Set<string>();
  for (const entry of turnEntries) {
    if (!isCurrentValidRoutedLeaderResponseMessage(session, entry)) continue;
    const ownerThreadKey = leaderResponseExactAnswerThreadKey(entry);
    if (ownerThreadKey) currentOwnerAnswerThreads.add(ownerThreadKey);
  }

  return new Set(
    canonicalizedRoutes
      .map((route) => route.selectedThreadKey)
      .filter((selectedThreadKey) => !currentOwnerAnswerThreads.has(selectedThreadKey)),
  );
}
