import { useHashLocation } from "./hash-location.js";
import { navigateToSessionThread, routeShowsSession, threadRouteFromHash, topicViewFromHash } from "./routing.js";

/**
 * A leader's quest tab is a zoomed-in view of its topic: the topic's quests read as one
 * conversation is the zoomed-out view, and a quest alone the zoomed-in one. Which one is on screen
 * is part of the route (`topic=1`), so back and forward zoom in and out, and links open quests
 * zoomed in.
 */

/** Zooms out: the quest tab shows its whole topic, a new history step. */
export function openTopicConversation(sessionId: string, threadKey: string, options: { replace?: boolean } = {}): void {
  navigateToSessionThread(sessionId, threadKey, options.replace ?? false, sessionId, { topicView: true });
}

/** Zooms in: the quest tab on screen shows its quest alone, a new history step. */
export function closeTopicConversation(sessionId: string): void {
  const threadKey = threadRouteFromHash(window.location.hash).threadKey;
  if (!threadKey) return;
  navigateToSessionThread(sessionId, threadKey, false, sessionId, { topicView: false });
}

/** The quest tab of this leader that shows its topic conversation, if any. */
export function useTopicConversationTab(sessionId: string): string | null {
  const hash = useHashLocation();
  if (!topicViewFromHash(hash) || !routeShowsSession(hash, sessionId)) return null;
  return threadRouteFromHash(hash).threadKey;
}

/**
 * Reads a topic's quests as one conversation: in the quest tab on screen when it is one of them,
 * otherwise in the tab of the topic's newest quest.
 */
export function readTopicConversation(
  sessionId: string,
  questIds: readonly string[],
  currentThreadKey: string,
  options: { replace?: boolean } = {},
): void {
  const current = currentThreadKey.toLowerCase();
  const questId = questIds.some((id) => id.toLowerCase() === current)
    ? current
    : [...questIds].sort((a, b) => Number(b.slice(2)) - Number(a.slice(2)))[0];
  if (!questId) return;
  openTopicConversation(sessionId, questId, options);
}
