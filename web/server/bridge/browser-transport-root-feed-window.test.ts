import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import {
  sendHistoryWindowSync,
  sendThreadWindowSync,
  type BrowserTransportSessionLike,
  type BrowserTransportSocketLike,
} from "./browser-transport-controller.js";

function rootTurn(): BrowserIncomingMessage[] {
  return [
    { type: "user_message", id: "root-user", content: "Visible root request", timestamp: 1 },
    {
      type: "assistant",
      message: {
        id: "root-answer",
        type: "message",
        role: "assistant",
        model: "gpt-5.5",
        content: [{ type: "text", text: "Visible root answer" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      timestamp: 2,
    },
    {
      type: "result",
      data: {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Done",
        duration_ms: 1,
        duration_api_ms: 1,
        num_turns: 1,
        total_cost_usd: 0,
        session_id: "test-session",
      },
    } as BrowserIncomingMessage,
  ];
}

function childTurn(index: number): BrowserIncomingMessage[] {
  const codexSubagent = { childId: "opaque-child", rootTurnId: "root-user" };
  return [
    {
      type: "user_message",
      id: `child-user-${index}`,
      content: `Hidden child request ${index}`,
      timestamp: 10 + index * 2,
      codexSubagent,
    },
    {
      type: "assistant",
      message: {
        id: `child-answer-${index}`,
        type: "message",
        role: "assistant",
        model: "gpt-5.5",
        content: [{ type: "text", text: `Hidden child answer ${index}` }],
        stop_reason: "end_turn",
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      timestamp: 11 + index * 2,
      codexSubagent,
    },
    {
      type: "result",
      data: {
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Done",
        duration_ms: 1,
        duration_api_ms: 1,
        num_turns: 1,
        total_cost_usd: 0,
        session_id: "test-session",
      },
      codexSubagent,
    } as BrowserIncomingMessage,
  ];
}

describe("browser root-feed bounded windows", () => {
  it("keeps a child-owned history tail from consuming the latest root turn", () => {
    const messageHistory = [...rootTurn(), ...childTurn(0), ...childTurn(1), ...childTurn(2)];
    const session = { messageHistory } as BrowserTransportSessionLike;
    const send = vi.fn();

    sendHistoryWindowSync(session, { send } as BrowserTransportSocketLike, {
      fromTurn: -1,
      turnCount: 1,
      sectionTurnCount: 1,
      visibleSectionCount: 1,
    });

    const payload = JSON.parse(send.mock.calls[0]![0]);
    expect(payload.type).toBe("history_window_sync");
    expect(payload.window).toEqual(
      expect.objectContaining({ from_turn: 0, turn_count: 1, total_turns: 1, start_index: 0 }),
    );
    expect(payload.messages.map((message: BrowserIncomingMessage) => message.codexSubagent)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("spends the latest window budget on root conversations while preserving raw indexes", () => {
    // The browser producer owns the root-only selection boundary. Otherwise a
    // child-heavy tail can consume the whole bounded window before React filters it.
    const messageHistory = [...rootTurn(), ...childTurn(0), ...childTurn(1), ...childTurn(2)];
    const session = { messageHistory } as BrowserTransportSessionLike;
    const send = vi.fn();
    const socket = { send } as BrowserTransportSocketLike;

    sendThreadWindowSync(session, socket, {
      threadKey: "main",
      fromItem: -1,
      itemCount: 1,
      sectionItemCount: 1,
      visibleItemCount: 1,
    });

    const payload = JSON.parse(send.mock.calls[0]![0]);
    expect(payload.type).toBe("thread_window_sync");
    expect(payload.window).toEqual(
      expect.objectContaining({
        total_items: 1,
        item_count: 1,
        source_history_length: messageHistory.length,
        has_older_items: false,
        has_newer_items: false,
      }),
    );
    expect(payload.entries.map((entry: { history_index: number }) => entry.history_index)).toEqual([0, 1, 2]);
    expect(
      payload.entries.every((entry: { message: BrowserIncomingMessage }) => entry.message.codexSubagent == null),
    ).toBe(true);
  });
});
