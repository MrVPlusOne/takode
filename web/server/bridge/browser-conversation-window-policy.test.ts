import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import {
  configureBoundedConversationSubscribe,
  prepareBoundedConversationSubscribe,
  recordBoundedConversationRequest,
  recordBoundedConversationViewUpdate,
  shouldDeliverBrowserEventToSocket,
  type BrowserConversationWindowSocketData,
} from "./browser-conversation-window-policy.js";

function threadSocket(threadKey: string): BrowserConversationWindowSocketData {
  return {
    boundedConversation: true,
    conversationView: {
      kind: "thread",
      request: {
        threadKey,
        fromItem: -1,
        itemCount: 30,
        sectionItemCount: 10,
        visibleItemCount: 3,
      },
    },
  };
}

describe("bounded browser conversation delivery", () => {
  it("prepares the initial history window from root turns instead of a child-owned tail", () => {
    const history: BrowserIncomingMessage[] = [];
    const result = (codexSubagent?: BrowserIncomingMessage["codexSubagent"]): BrowserIncomingMessage =>
      ({
        type: "result",
        data: { type: "result", subtype: "success", is_error: false },
        ...(codexSubagent ? { codexSubagent } : {}),
      }) as BrowserIncomingMessage;
    for (let index = 0; index < 10; index++) {
      history.push({ type: "user_message", id: `root-${index}`, content: "root", timestamp: index });
      history.push(result());
    }
    const ownership = { childId: "opaque-child", rootTurnId: "root-9" };
    for (let index = 0; index < 20; index++) {
      history.push({
        type: "user_message",
        id: `child-${index}`,
        content: "child",
        timestamp: 100 + index,
        codexSubagent: ownership,
      });
      history.push(result(ownership));
    }

    const prepared = prepareBoundedConversationSubscribe({
      session: { messageHistory: history, eventBuffer: [], nextEventSeq: 1 },
      socketData: {},
      feedWindowSyncVersion: 1,
      initialThreadWindow: null,
      historyWindowSectionTurnCount: 1,
      historyWindowVisibleSectionCount: 3,
      historyWindowTargetMessageId: undefined,
      historyWindowTargetIndex: undefined,
      lastAckSeq: 0,
      running: false,
      isHistoryBackedEvent: () => false,
    });

    expect(prepared.historyView).toMatchObject({ fromTurn: 7, turnCount: 3 });
    expect(prepared.boundedView).toMatchObject({ kind: "history", request: { fromTurn: 7, turnCount: 3 } });
  });

  it("fails closed to legacy delivery when capability metadata has no bounded view", () => {
    const socketData: BrowserConversationWindowSocketData = {};
    expect(
      configureBoundedConversationSubscribe({
        socketData,
        feedWindowSyncVersion: 1,
        initialThreadWindow: null,
        historyWindow: null,
      }),
    ).toBeNull();
    expect(socketData.boundedConversation).toBe(false);
  });

  it("keeps legacy sockets on unfiltered delivery", () => {
    const message = { type: "user_message", content: "q", timestamp: 1, threadKey: "q-1" } as BrowserIncomingMessage;
    expect(shouldDeliverBrowserEventToSocket({ messageHistory: [] }, message, {})).toBe(true);
  });

  it("does not change live routing for a non-active background window request", () => {
    const socketData = threadSocket("q-1");
    recordBoundedConversationRequest(socketData, {
      type: "thread_window_request",
      thread_key: "q-2",
      from_item: 0,
      item_count: 30,
      section_item_count: 10,
      visible_item_count: 3,
      feed_window_sync_version: 1,
    });
    expect(socketData.conversationView).toMatchObject({ kind: "thread", request: { threadKey: "q-1" } });
  });

  it("changes live routing only for an explicitly active window request", () => {
    const socketData = threadSocket("q-1");
    recordBoundedConversationRequest(socketData, {
      type: "thread_window_request",
      thread_key: "q-2",
      from_item: 0,
      item_count: 30,
      section_item_count: 10,
      visible_item_count: 3,
      activate_view: true,
      feed_window_sync_version: 1,
    });
    expect(socketData.conversationView).toMatchObject({ kind: "thread", request: { threadKey: "q-2" } });
  });

  it("ignores invalid view updates instead of promoting a legacy socket", () => {
    const socketData: BrowserConversationWindowSocketData = {};
    recordBoundedConversationViewUpdate(socketData, {
      type: "conversation_view_update",
      view: "thread",
      thread_key: "not-a-thread",
      from: 0,
      count: 0,
      section_count: 10,
      visible_count: 3,
      feed_window_sync_version: 1,
    });
    expect(socketData).toEqual({});
  });

  it("filters routed live messages to the selected thread", () => {
    const message = { type: "user_message", content: "q", timestamp: 1, threadKey: "q-1" } as BrowserIncomingMessage;
    expect(shouldDeliverBrowserEventToSocket({ messageHistory: [] }, message, threadSocket("q-1"))).toBe(true);
    expect(shouldDeliverBrowserEventToSocket({ messageHistory: [] }, message, threadSocket("q-2"))).toBe(false);
    expect(shouldDeliverBrowserEventToSocket({ messageHistory: [] }, message, threadSocket("main"))).toBe(false);
  });

  it("uses the active turn route for streaming and tool progress", () => {
    const session = { messageHistory: [], activeTurnRoute: { threadKey: "q-1", questId: "q-1" } };
    const stream = { type: "stream_event", event: {}, parent_tool_use_id: null } as BrowserIncomingMessage;
    const progress = {
      type: "tool_progress",
      tool_use_id: "tool-1",
      tool_name: "Bash",
      elapsed_time_seconds: 1,
    } as BrowserIncomingMessage;
    expect(shouldDeliverBrowserEventToSocket(session, stream, threadSocket("q-1"))).toBe(true);
    expect(shouldDeliverBrowserEventToSocket(session, progress, threadSocket("q-2"))).toBe(false);
  });

  it("routes terminal results from the recent history turn after the active route clears", () => {
    const history = [
      { type: "user_message", content: "q", timestamp: 1, threadKey: "q-1" } as BrowserIncomingMessage,
      {
        type: "assistant",
        message: { id: "a-1", role: "assistant", content: [] },
        parent_tool_use_id: null,
        threadKey: "q-1",
      } as unknown as BrowserIncomingMessage,
    ];
    const result = {
      type: "result",
      data: { type: "result", subtype: "success", is_error: false },
    } as BrowserIncomingMessage;
    expect(shouldDeliverBrowserEventToSocket({ messageHistory: history }, result, threadSocket("q-1"))).toBe(true);
    expect(shouldDeliverBrowserEventToSocket({ messageHistory: history }, result, threadSocket("main"))).toBe(false);
  });

  it("uses recent tool ownership when a preview arrives without an active route", () => {
    const history = [
      {
        type: "assistant",
        message: {
          id: "a-tool",
          role: "assistant",
          content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: {} }],
        },
        parent_tool_use_id: null,
        threadKey: "q-1",
      } as unknown as BrowserIncomingMessage,
    ];
    const preview = {
      type: "tool_result_preview",
      previews: [{ tool_use_id: "tool-1", content: "done", is_error: false }],
    } as BrowserIncomingMessage;
    expect(shouldDeliverBrowserEventToSocket({ messageHistory: history }, preview, threadSocket("q-1"))).toBe(true);
    expect(shouldDeliverBrowserEventToSocket({ messageHistory: history }, preview, threadSocket("q-2"))).toBe(false);
  });
});
