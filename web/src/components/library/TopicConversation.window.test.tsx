// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const sendToSession = vi.hoisted(() => vi.fn(() => true));
vi.mock("../../ws.js", () => ({ sendToSession }));

import { useStore } from "../../store.js";
import type { ThreadWindowState } from "../../types.js";
import { useTopicWindowFollowsQuests } from "./TopicConversation.js";

/**
 * A topic conversation's view key names the topic, so a quest joining or leaving the topic changes
 * no key and nothing would reload its window. The view asks for its window again when the topic's
 * known quests differ from those the window was built with.
 */
function window(members: string[], hasNewer = false): ThreadWindowState {
  return {
    thread_key: "topic:t1",
    from_item: 10,
    item_count: 30,
    total_items: 40,
    has_older_items: true,
    has_newer_items: hasNewer,
    source_history_length: 100,
    section_item_count: 10,
    visible_item_count: 3,
    topic_members: members,
  };
}

afterEach(() => {
  useStore.getState().reset();
  sendToSession.mockClear();
});

describe("useTopicWindowFollowsQuests", () => {
  it("asks for the latest window again when the topic's quests change", () => {
    useStore.getState().setThreadWindow("s1", "topic:t1", window(["q-1", "q-2"]), []);
    const { rerender } = renderHook(({ quests }) => useTopicWindowFollowsQuests("s1", "topic:t1", quests), {
      initialProps: { quests: ["q-2", "q-1"] },
    });
    expect(sendToSession).not.toHaveBeenCalled();

    rerender({ quests: ["q-1", "q-2", "q-3"] });
    expect(sendToSession).toHaveBeenCalledTimes(1);
    expect(sendToSession).toHaveBeenCalledWith(
      "s1",
      expect.objectContaining({ thread_key: "topic:t1", from_item: -1 }),
    );
  });

  it("leaves a reader paging through older messages where they are", () => {
    useStore.getState().setThreadWindow("s1", "topic:t1", window(["q-1"], true), []);
    renderHook(() => useTopicWindowFollowsQuests("s1", "topic:t1", ["q-1", "q-2"]));
    expect(sendToSession).not.toHaveBeenCalled();
  });
});
