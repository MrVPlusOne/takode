import { beforeEach, describe, expect, it } from "vitest";
import { useStore } from "./store.js";
import {
  noteSessionConversationViewed,
  resetSessionConversationRetentionForTest,
  RETAINED_CONVERSATION_SESSIONS,
} from "./session-conversation-retention.js";

// Revisits paint from held conversations, so held data must stay bounded in a
// long-lived tab: beyond the limit the least recently viewed session without a
// socket loses its conversation, but keeps its list and notification state.
describe("session conversation retention", () => {
  beforeEach(() => {
    useStore.getState().reset();
    resetSessionConversationRetentionForTest();
  });

  function hold(sessionId: string) {
    useStore.getState().setMessages(sessionId, [{ id: `${sessionId}-m`, role: "user", content: "hi", timestamp: 1 }]);
    useStore.getState().setSessionNotifications(sessionId, []);
  }

  it("releases the least recently viewed conversation beyond the limit", () => {
    const ids = Array.from({ length: RETAINED_CONVERSATION_SESSIONS + 1 }, (_, i) => `s${i}`);
    for (const id of ids) {
      hold(id);
      noteSessionConversationViewed(id, () => false);
    }
    expect(useStore.getState().messages.has("s0")).toBe(false);
    expect(useStore.getState().messages.has("s1")).toBe(true);
    expect(useStore.getState().messages.has(ids.at(-1)!)).toBe(true);
  });

  it("keeps sessions that still have a socket and moves revisited ones to the front", () => {
    const ids = Array.from({ length: RETAINED_CONVERSATION_SESSIONS }, (_, i) => `s${i}`);
    for (const id of ids) {
      hold(id);
      noteSessionConversationViewed(id, () => false);
    }
    noteSessionConversationViewed("s0", () => false); // revisited: now most recent
    hold("new");
    noteSessionConversationViewed("new", (id) => id === "s1"); // s1 still has a socket
    expect(useStore.getState().messages.has("s0")).toBe(true);
    expect(useStore.getState().messages.has("s1")).toBe(true);
    expect(useStore.getState().messages.has("s2")).toBe(false);
  });
});
