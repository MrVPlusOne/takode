// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { openTopicConversation } from "./topic-conversation.js";
import { resetLeaderTopicsForTest } from "./leader-topics.js";

/**
 * A topic's conversation is its own place (`topic:<handle>`), so the route, history and every
 * saved place name the topic, not one of its quests.
 */
afterEach(() => {
  window.location.hash = "";
  resetLeaderTopicsForTest();
});

describe("topic conversations as their own place", () => {
  it("routes a topic's conversation by the topic's key, dropping a legacy topic flag", () => {
    window.location.hash = "#/session/l1?thread=q-5&topic=1";
    openTopicConversation("l1", "topic:2bd59c8c");
    expect(window.location.hash).toBe("#/session/l1?thread=topic%3A2bd59c8c");
  });
});
