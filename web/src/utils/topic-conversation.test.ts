// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  closeTopicConversation,
  openTopicConversation,
  readTopicConversation,
  useTopicConversationTab,
} from "./topic-conversation.js";
import { threadRouteFromHash, topicViewFromHash } from "./routing.js";

/**
 * A quest tab is a zoomed-in view of its topic: the topic conversation is the same tab zoomed out,
 * and which one shows is part of the route (`topic=1`), so back and forward zoom in and out.
 */
afterEach(() => {
  window.location.hash = "";
});

describe("zooming a quest tab out to its topic and back in", () => {
  it("zooms out and in as history steps of the same tab", async () => {
    window.location.hash = "#/session/l1?thread=q-5";
    const { result } = renderHook(() => useTopicConversationTab("l1"));
    openTopicConversation("l1", "q-5");
    expect(window.location.hash).toBe("#/session/l1?thread=q-5&topic=1");
    await waitFor(() => expect(result.current).toBe("q-5"));

    closeTopicConversation("l1");
    expect(window.location.hash).toBe("#/session/l1?thread=q-5");
    await waitFor(() => expect(result.current).toBeNull());

    // Back zooms out again.
    history.back();
    await waitFor(() => expect(result.current).toBe("q-5"));
  });

  it("is only this leader's: another session's topic view is not its tab's", async () => {
    window.location.hash = "#/session/other?thread=q-5&topic=1";
    const { result } = renderHook(() => useTopicConversationTab("l1"));
    await waitFor(() => expect(topicViewFromHash(window.location.hash)).toBe(true));
    expect(result.current).toBeNull();
  });
});

describe("readTopicConversation", () => {
  // From a topic page: the conversation opens in the tab on screen when that quest is in the
  // topic, and otherwise in the tab of the topic's newest quest.
  it("opens in the quest tab on screen when the topic holds it", async () => {
    window.location.hash = "#/session/l1?thread=q-5";
    const { result } = renderHook(() => useTopicConversationTab("l1"));
    readTopicConversation("l1", ["q-5", "q-12"], "q-5");
    expect(threadRouteFromHash(window.location.hash).threadKey).toBe("q-5");
    await waitFor(() => expect(result.current).toBe("q-5"));
  });

  it("otherwise opens in the tab of the topic's newest quest", async () => {
    window.location.hash = "#/session/l1?thread=main";
    const { result } = renderHook(() => useTopicConversationTab("l1"));
    readTopicConversation("l1", ["q-12", "q-100", "q-9"], "main");
    expect(threadRouteFromHash(window.location.hash).threadKey).toBe("q-100");
    await waitFor(() => expect(result.current).toBe("q-100"));
  });
});
