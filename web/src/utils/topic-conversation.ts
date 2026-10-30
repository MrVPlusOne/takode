import { navigateToSessionThread } from "./routing.js";

/**
 * A topic's conversation (its quests read as one) is a place of its own, like a quest: the route
 * names it as `topic:<handle>`, and it is remembered, restored and handed to other devices under
 * that key. (It was once a quest tab "zoomed out" with a `topic=1` route flag, which every place
 * that remembers where a leader was left lost.)
 */
export function openTopicConversation(sessionId: string, topicKey: string, options: { replace?: boolean } = {}): void {
  navigateToSessionThread(sessionId, topicKey, options.replace ?? false);
}
