import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import { setTopicViewSource } from "../topic-views.js";
import {
  sendThreadWindowSync,
  type BrowserTransportSessionLike,
  type BrowserTransportSocketLike,
} from "./browser-transport-controller.js";

/**
 * A thread handed off to a quest reads in the quest's conversation. The server's window for the
 * quest asks the topic store which threads became part of it, so a message still routed to such a
 * thread (another leader's message sent to the thread's old address) shows in the quest's tab, as
 * live delivery already showed it.
 */
afterEach(() => setTopicViewSource(null));

describe("quest thread windows", () => {
  it("include messages still routed to a thread handed off to the quest", () => {
    setTopicViewSource({
      topicOf: (handle) =>
        handle === "5d1e7a20" ? { id: "5d1e7a20-0000", name: "Slack updates", thread: { quest: "q-40" } } : null,
      questsOf: () => [],
      handlesOf: () => [],
      topicOfQuest: () => null,
      threadsOfQuest: (questId) => (questId === "q-40" ? ["5d1e7a20"] : []),
    });
    const messageHistory = [
      {
        type: "user_message",
        id: "peer-after-handoff",
        content: "A data point from the other leader",
        timestamp: 1,
        agentSource: { sessionId: "peer-leader", sessionLabel: "#7 Briefing Leader" },
        threadKey: "topic:5d1e7a20",
        threadRefs: [{ threadKey: "topic:5d1e7a20", source: "explicit", attachedAt: 1 }],
      },
    ] as BrowserIncomingMessage[];
    const send = vi.fn();

    sendThreadWindowSync(
      { id: "leader", messageHistory } as BrowserTransportSessionLike,
      {
        send,
      } as BrowserTransportSocketLike,
      {
        threadKey: "q-40",
        fromItem: -1,
        sectionItemCount: 10,
        visibleItemCount: 1,
      },
    );

    const payload = JSON.parse(send.mock.calls.at(-1)![0]);
    expect(payload.type).toBe("thread_window_sync");
    expect(payload.entries.map((entry: { message: { id?: string } }) => entry.message.id)).toEqual([
      "peer-after-handoff",
    ]);
  });
});
