// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({ api: {} }));

import { topicApi } from "../api/topics.js";
import { rememberTopicList, resetLeaderTopicsForTest } from "../utils/leader-topics.js";
import { MessageThreadHeader } from "./MessageThreadHeader.js";
import { MessageTopicLabel } from "./MessageTopicLabel.js";

/**
 * A user's message shown in a view it doesn't belong to names the topic it belongs to, at the top
 * left of its bubble (Jiayi's ask: a message she wrote in Main and that moved into a quest showed
 * no sign of it). Tapping the label opens that topic's conversation at the message.
 */

/** A message written in Main and handed off to q-7. */
const MOVED = {
  id: "m-1",
  metadata: {
    threadKey: "main",
    threadRefs: [{ threadKey: "q-7", questId: "q-7", source: "explicit" as const, attachedAt: 2 }],
  },
};

function mockTopics() {
  vi.spyOn(topicApi, "questMap").mockResolvedValue({
    enabled: true,
    map: { "q-7": { id: "t1", name: "Relay" }, "q-8": { id: "t1", name: "Relay" }, "q-9": { id: "t2", name: "Voice" } },
    topics: {},
  });
}

afterEach(() => {
  resetLeaderTopicsForTest();
  vi.restoreAllMocks();
  window.location.hash = "";
});

describe("MessageTopicLabel", () => {
  it("names the topic a message moved to, and opens the topic at the message", async () => {
    mockTopics();
    render(<MessageTopicLabel message={MOVED} sessionId="l1" currentThreadKey="main" />);
    const label = await screen.findByTestId("message-topic-label");
    await waitFor(() => expect(label.textContent).toBe("Relay"));
    fireEvent.click(label.querySelector("button")!);
    expect(window.location.hash).toBe("#/session/l1/msg/m-1?topic=1&thread=q-7");
  });

  it("is absent where the message is at home: its quest, its topic, or another quest of that topic", async () => {
    mockTopics();
    const { rerender } = render(<MessageTopicLabel message={MOVED} sessionId="l1" currentThreadKey="q-7" />);
    expect(screen.queryByTestId("message-topic-label")).toBeNull();
    rerender(<MessageTopicLabel message={MOVED} sessionId="l1" currentThreadKey="topic:t1" />);
    await waitFor(() => expect(topicApi.questMap).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("message-topic-label")).toBeNull());
    // Another quest of the same topic: hidden once both topics are known.
    rerender(<MessageTopicLabel message={MOVED} sessionId="l1" currentThreadKey="q-8" />);
    await waitFor(() => expect(topicApi.questMap).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByTestId("message-topic-label")).toBeNull());
    // A quest of another topic shows it.
    rerender(<MessageTopicLabel message={MOVED} sessionId="l1" currentThreadKey="q-9" />);
    await waitFor(() => expect(screen.getByTestId("message-topic-label").textContent).toBe("Relay"));
  });

  it("names the quest until the quest is filed under a topic, and opens the quest at the message", async () => {
    vi.spyOn(topicApi, "questMap").mockResolvedValue({ enabled: true, map: {}, topics: {} });
    render(<MessageTopicLabel message={MOVED} sessionId="l1" currentThreadKey="main" />);
    const label = await screen.findByTestId("message-topic-label");
    expect(label.textContent).toBe("q-7");
    fireEvent.click(label.querySelector("button")!);
    expect(window.location.hash).toBe("#/session/l1/msg/m-1?thread=q-7");
  });

  it("leaves a message that belongs to the view alone", () => {
    render(
      <MessageTopicLabel
        message={{ id: "m-2", metadata: { threadKey: "main" } }}
        sessionId="l1"
        currentThreadKey="main"
      />,
    );
    expect(screen.queryByTestId("message-topic-label")).toBeNull();
  });
});

describe("a message written in a topic's own thread", () => {
  it("is named by its topic in its thread header, and opens the topic conversation at it", async () => {
    // Seen in All, a message (or answer) of a topic thread names the topic instead of the raw
    // `thread:topic:<handle>` key. Its first version re-rendered forever (a new object per store read).
    rememberTopicList("l1", [{ id: "aaaaaaaa-1111", name: "Relay", questIds: ["q-7", "q-9"], activityAt: 1 } as never]);
    render(<MessageThreadHeader threadKey="topic:aaaaaaaa" message={{ sessionId: "l1", id: "m-2" }} />);
    const label = await screen.findByTestId("message-topic-label");
    expect(label.textContent).toContain("Relay");
    fireEvent.click(label.querySelector("button")!);
    // It opens in the tab of the topic's newest quest, zoomed out to the topic.
    await waitFor(() => expect(window.location.hash).toContain("q-9"));
    expect(window.location.hash).toContain("topic=1");
  });
});
