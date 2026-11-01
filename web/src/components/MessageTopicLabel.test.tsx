// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({ api: {} }));

import { useStore } from "../store.js";
import { rememberThreads, rememberTopicList, resetLeaderTopicsForTest } from "../utils/leader-topics.js";
import { useSideColumnStore } from "../utils/side-column.js";
import { MessageThreadHeader } from "./MessageThreadHeader.js";
import { MessageTopicLabel } from "./MessageTopicLabel.js";

/**
 * A user's message shown in a view it doesn't belong to names the quest thread it belongs to, at
 * the top left of its bubble (Jiayi's ask: a message she wrote in Main and that moved into a quest
 * showed no sign of it). Tapping the label opens that quest's thread at the message. Topics are
 * tags, so the label names the quest, not its topic.
 */

/** A message written in Main and handed off to q-7. */
const MOVED = {
  id: "m-1",
  metadata: {
    threadKey: "main",
    threadRefs: [{ threadKey: "q-7", questId: "q-7", source: "explicit" as const, attachedAt: 2 }],
  },
};

afterEach(() => {
  resetLeaderTopicsForTest();
  useSideColumnStore.setState({ items: [], focus: undefined, focusAt: undefined });
  useStore.setState({ quests: [] } as never);
  vi.restoreAllMocks();
  window.location.hash = "";
});

describe("MessageTopicLabel", () => {
  it("names the quest a message moved to, with its title once known, and opens it at the message", async () => {
    const { rerender } = render(<MessageTopicLabel message={MOVED} sessionId="l1" currentThreadKey="main" />);
    expect(screen.getByTestId("message-topic-label").textContent).toBe("q-7");
    useStore.setState({ quests: [{ questId: "q-7", title: "Fix the relay" }] } as never);
    rerender(<MessageTopicLabel message={MOVED} sessionId="l1" currentThreadKey="main" />);
    await waitFor(() => expect(screen.getByTestId("message-topic-label").textContent).toBe("q-7 Fix the relay"));
    fireEvent.click(screen.getByTestId("message-topic-label").querySelector("button")!);
    expect(window.location.hash).toBe("#/session/l1/msg/m-1?thread=q-7");
  });

  it("is absent where the message is at home, and shown in another quest's thread", () => {
    const { rerender } = render(<MessageTopicLabel message={MOVED} sessionId="l1" currentThreadKey="q-7" />);
    expect(screen.queryByTestId("message-topic-label")).toBeNull();
    rerender(<MessageTopicLabel message={MOVED} sessionId="l1" currentThreadKey="q-9" />);
    expect(screen.getByTestId("message-topic-label").textContent).toBe("q-7");
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
  it("is named by its topic in its thread header, and opens the topic's page beside", async () => {
    // Seen in All, a message written in a topic's conversation (from before topics became tags)
    // names the topic instead of the raw `thread:topic:<handle>` key. Its first version re-rendered
    // forever (a new object per store read).
    rememberTopicList("l1", [{ id: "aaaaaaaa-1111", name: "Relay", questIds: ["q-7", "q-9"], activityAt: 1 } as never]);
    render(<MessageThreadHeader threadKey="topic:aaaaaaaa" message={{ sessionId: "l1", id: "m-2" }} />);
    const label = await screen.findByTestId("message-topic-label");
    expect(label.textContent).toContain("Relay");
    fireEvent.click(label.querySelector("button")!);
    expect(useSideColumnStore.getState().items).toEqual([
      expect.objectContaining({ kind: "topic", topicId: "aaaaaaaa-1111" }),
    ]);
  });

  it("is named by its thread when the user started it, and opens the thread at it", async () => {
    // A thread the user started (New thread) shares the topic key form but is no topic; in All its
    // messages read "Topic" with a dead link until they named the thread and opened it.
    rememberThreads("l1", [
      { id: "bbbbbbbb-2222", key: "topic:bbbbbbbb", name: "Prod memory", leaderId: "l1", createdAt: 1, activityAt: 1 },
    ]);
    render(<MessageThreadHeader threadKey="topic:bbbbbbbb" message={{ sessionId: "l1", id: "m-3" }} />);
    const label = await screen.findByTestId("message-topic-label");
    expect(label.textContent).toBe("Prod memory");
    fireEvent.click(label.querySelector("button")!);
    await waitFor(() => expect(window.location.hash).toBe("#/session/l1/msg/m-3?thread=topic%3Abbbbbbbb"));
  });
});
