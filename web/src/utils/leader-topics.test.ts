// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({ api: {} }));

import { topicApi } from "../api/topics.js";
import { resetLeaderTopicsForTest, useKnownQuestTopic, useKnownTopicBrief, useLeaderTopics } from "./leader-topics.js";

/**
 * The tab bar loads every tab's topic once; a quest tab opened afterwards reads its topic and the
 * topic's quest count from that, in the same render as its strip, without waiting for a request.
 */
afterEach(() => {
  resetLeaderTopicsForTest();
  vi.restoreAllMocks();
});

describe("leader topics", () => {
  it("knows a tab's topic as soon as the tab bar has loaded, and a quest under no topic too", async () => {
    vi.spyOn(topicApi, "questMap").mockResolvedValue({
      enabled: true,
      map: { "q-1": { id: "t1", name: "Relay" } },
      topics: { t1: { name: "Relay", questIds: ["q-1", "q-3"], activityAt: 5 } },
    });
    const bar = renderHook(() => useLeaderTopics("leader", ["q-1", "q-2"]));
    await waitFor(() => expect(bar.result.current?.map["q-1"]?.name).toBe("Relay"));

    // Read synchronously on first render: no request of its own is needed to show the line.
    const tab = renderHook(() => ({
      topic: useKnownQuestTopic("leader", "q-1"),
      brief: useKnownTopicBrief("leader", "t1"),
      unfiled: useKnownQuestTopic("leader", "q-2"),
      unknown: useKnownQuestTopic("leader", "q-9"),
    }));
    expect(tab.result.current.topic).toEqual({ id: "t1", name: "Relay" });
    expect(tab.result.current.brief?.questIds).toEqual(["q-1", "q-3"]);
    expect(tab.result.current.unfiled).toBeNull();
    expect(tab.result.current.unknown).toBeUndefined();
  });

  it("is null while the leader has topics off", async () => {
    vi.spyOn(topicApi, "questMap").mockResolvedValue({ enabled: false, map: {}, topics: {} });
    const bar = renderHook(() => useLeaderTopics("leader", ["q-1"]));
    await waitFor(() => expect(topicApi.questMap).toHaveBeenCalled());
    expect(bar.result.current).toBeNull();
  });
});
