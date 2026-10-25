// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { closeTopicConversation, readTopicConversation, useTopicConversationTab } from "./topic-conversation.js";
import { threadRouteFromHash } from "./routing.js";

/**
 * Reading a topic as one conversation from its topic page: the conversation lives in a quest tab,
 * so it opens in the tab on screen when that quest is in the topic, and otherwise in the tab of the
 * topic's newest quest (the page can show any topic, not only the one of the tab on screen).
 */
afterEach(() => {
  closeTopicConversation("l1");
  window.location.hash = "";
});

describe("readTopicConversation", () => {
  it("opens in the quest tab on screen when the topic holds it", () => {
    window.location.hash = "#/session/l1?thread=q-5";
    const { result } = renderHook(() => useTopicConversationTab("l1"));
    act(() => readTopicConversation("l1", ["q-5", "q-12"], "q-5"));
    expect(threadRouteFromHash(window.location.hash).threadKey).toBe("q-5");
    expect(result.current).toBe("q-5");
  });

  it("otherwise opens in the tab of the topic's newest quest", () => {
    window.location.hash = "#/session/l1?thread=main";
    const { result } = renderHook(() => useTopicConversationTab("l1"));
    act(() => readTopicConversation("l1", ["q-12", "q-100", "q-9"], "main"));
    expect(threadRouteFromHash(window.location.hash).threadKey).toBe("q-100");
    expect(result.current).toBe("q-100");
  });
});
