import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import { refreshBrowserConversationViews, type BrowserTransportSessionLike } from "./browser-transport-controller.js";

function threadSocket(threadKey: string) {
  return {
    data: {
      sessionId: "refresh-session",
      subscribed: true,
      conversationView: {
        kind: "thread" as const,
        request: {
          threadKey,
          fromItem: -1,
          itemCount: 30,
          sectionItemCount: 10,
          visibleItemCount: 3,
        },
      },
    },
    send: vi.fn(),
  };
}

function parseCalls(socket: ReturnType<typeof threadSocket>) {
  return socket.send.mock.calls.map(([raw]) => JSON.parse(String(raw)));
}

describe("browser conversation refresh", () => {
  it("refreshes each socket from its own selected view without serializing the full conversation", () => {
    const first = threadSocket("q-1");
    const second = threadSocket("q-2");
    const poisonedOutsideBothViews = {
      type: "user_message",
      id: "main-poison",
      content: "unselected main content",
      timestamp: 3,
      // If refresh regresses to whole-history serialization, this makes the test
      // fail before any payload can be mistaken for bounded evidence.
      toJSON() {
        throw new Error("unselected history must not be serialized");
      },
    } as unknown as BrowserIncomingMessage;
    const session = {
      id: "refresh-session",
      browserSockets: new Set([first, second]),
      nextEventSeq: 11,
      messageHistory: [
        {
          type: "user_message",
          id: "q-1-message",
          content: "first selected view",
          timestamp: 1,
          threadKey: "q-1",
          questId: "q-1",
        } as BrowserIncomingMessage,
        {
          type: "user_message",
          id: "q-2-message",
          content: "second selected view",
          timestamp: 2,
          threadKey: "q-2",
          questId: "q-2",
        } as BrowserIncomingMessage,
        poisonedOutsideBothViews,
      ],
    } as BrowserTransportSessionLike;

    expect(() => refreshBrowserConversationViews(session)).not.toThrow();

    const firstCalls = parseCalls(first);
    const secondCalls = parseCalls(second);
    expect(firstCalls.map((message) => message.type)).toEqual(["thread_window_sync", "conversation_sync_complete"]);
    expect(secondCalls.map((message) => message.type)).toEqual(["thread_window_sync", "conversation_sync_complete"]);
    expect(firstCalls[0]).toMatchObject({
      thread_key: "q-1",
      entries: [expect.objectContaining({ message: expect.objectContaining({ id: "q-1-message" }) })],
    });
    expect(secondCalls[0]).toMatchObject({
      thread_key: "q-2",
      entries: [expect.objectContaining({ message: expect.objectContaining({ id: "q-2-message" }) })],
    });
    expect(firstCalls[1]).toEqual({ type: "conversation_sync_complete", through_seq: 11 });
    expect(secondCalls[1]).toEqual({ type: "conversation_sync_complete", through_seq: 11 });
    expect(session.nextEventSeq).toBe(12);

    const forbiddenOrdinaryFrames = new Set(["feed_window_sync", "message_history", "history_sync"]);
    expect([...firstCalls, ...secondCalls].some((message) => forbiddenOrdinaryFrames.has(message.type))).toBe(false);

    first.send.mockClear();
    second.send.mockClear();
    refreshBrowserConversationViews(session);
    expect(parseCalls(first).at(-1)).toEqual({ type: "conversation_sync_complete", through_seq: 12 });
    expect(parseCalls(second).at(-1)).toEqual({ type: "conversation_sync_complete", through_seq: 12 });
    expect(session.nextEventSeq).toBe(13);
  });
});
