import { useStore } from "./store.js";
import { forgetSessionWindowCaches } from "./utils/history-window-cache.js";
import { forgetHeldViewportHandoffState } from "./utils/viewport-handoff-client.js";

/**
 * How many sessions keep their conversation in this tab once viewed. Measured
 * October 2026 on the live coordinator: holding all 48 active sessions after
 * visiting each took about 51 MB of JavaScript heap, about 1 MB a session, so
 * this keeps every active session instant to revisit for roughly 60-100 MB.
 */
export const RETAINED_CONVERSATION_SESSIONS = 60;

const viewedOrder: string[] = [];

/**
 * Record that a session's conversation is being shown, and release the
 * conversations of the least recently viewed sessions beyond the retention
 * limit. Sessions that still have a socket (the one on screen, a search
 * preview, a side chat) are never released.
 */
export function noteSessionConversationViewed(sessionId: string, hasSocket: (sessionId: string) => boolean): void {
  const index = viewedOrder.indexOf(sessionId);
  if (index >= 0) viewedOrder.splice(index, 1);
  viewedOrder.push(sessionId);
  for (let i = 0; viewedOrder.length > RETAINED_CONVERSATION_SESSIONS && i < viewedOrder.length; ) {
    const candidate = viewedOrder[i]!;
    if (candidate === sessionId || hasSocket(candidate)) {
      i += 1;
      continue;
    }
    viewedOrder.splice(i, 1);
    useStore.getState().releaseSessionConversation(candidate);
    forgetSessionWindowCaches(candidate);
    forgetHeldViewportHandoffState(candidate);
  }
}

export function resetSessionConversationRetentionForTest(): void {
  viewedOrder.length = 0;
}
