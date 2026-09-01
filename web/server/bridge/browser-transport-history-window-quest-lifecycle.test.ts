import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import { sendHistoryWindowSync } from "./browser-transport-controller.js";

const result = {
  type: "result",
  data: {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "",
    duration_ms: 1,
    duration_api_ms: 1,
    num_turns: 1,
    total_cost_usd: 0,
    session_id: "test-session",
  },
} as BrowserIncomingMessage;

const lifecycle: Extract<BrowserIncomingMessage, { type: "quest_lifecycle_event" }> = {
  type: "quest_lifecycle_event",
  id: "quest_submitted-q-2003-leader-1500",
  timestamp: 1500,
  kind: "submitted",
  quest: { questId: "q-2003", title: "Diagnose recurring alerts", status: "done" },
  threadKey: "q-2003",
  questId: "q-2003",
  threadRefs: [{ threadKey: "q-2003", questId: "q-2003", source: "explicit" }],
};

function sendWindow(
  messageHistory: BrowserIncomingMessage[],
  options: Parameters<typeof sendHistoryWindowSync>[2],
): ReturnType<typeof JSON.parse> {
  const send = vi.fn();
  sendHistoryWindowSync({ messageHistory }, { send }, options);
  return JSON.parse(send.mock.calls[0]![0]);
}

describe("history window quest lifecycle ownership", () => {
  it("hydrates an idle between-turn lifecycle row without leaking child rows or overlapping the next turn", () => {
    const codexSubagent = { childId: "child-1", rootTurnId: "u-q2003" };
    const history = [
      { type: "user_message", id: "u-q2003", content: "Complete q-2003", timestamp: 1000 },
      result,
      { type: "user_message", id: "child-user", content: "private child", timestamp: 1200, codexSubagent },
      { ...result, codexSubagent },
      lifecycle,
      { type: "user_message", id: "u-q2006", content: "Dispatch q-2006", timestamp: 2000 },
      result,
    ] as BrowserIncomingMessage[];

    const first = sendWindow(history, {
      fromTurn: 0,
      turnCount: 1,
      sectionTurnCount: 1,
      visibleSectionCount: 1,
    });
    expect(first.messages.map((message: BrowserIncomingMessage) => message.type)).toEqual([
      "user_message",
      "result",
      "quest_lifecycle_event",
    ]);
    expect(first.messages.at(-1)).toMatchObject({ id: lifecycle.id, history_index: 4 });
    expect(first.messages.every((message: BrowserIncomingMessage) => message.codexSubagent == null)).toBe(true);

    const second = sendWindow(history, {
      fromTurn: 1,
      turnCount: 1,
      sectionTurnCount: 1,
      visibleSectionCount: 1,
    });
    expect(second.messages.map((message: BrowserIncomingMessage) => (message as { id?: string }).id)).toEqual([
      "u-q2006",
      undefined,
    ]);

    for (const target of [{ targetMessageId: lifecycle.id }, { targetHistoryIndex: 4 }]) {
      const targeted = sendWindow(history, {
        fromTurn: -1,
        turnCount: 1,
        sectionTurnCount: 1,
        visibleSectionCount: 1,
        ...target,
      });
      expect(targeted.window.from_turn).toBe(0);
      expect(
        targeted.messages.some((message: BrowserIncomingMessage) => (message as { id?: string }).id === lifecycle.id),
      ).toBe(true);
    }
  });

  it("includes a lifecycle row before the first user turn with exact raw indexes", () => {
    const payload = sendWindow(
      [
        lifecycle,
        { type: "user_message", id: "u-q2003", content: "Begin", timestamp: 1600 },
        result,
        { type: "user_message", id: "u-q2006", content: "Later", timestamp: 2000 },
        result,
      ] as BrowserIncomingMessage[],
      {
        fromTurn: -1,
        turnCount: 1,
        sectionTurnCount: 1,
        visibleSectionCount: 1,
        targetMessageId: lifecycle.id,
      },
    );

    expect(payload.window).toMatchObject({ from_turn: 0, start_index: 0 });
    expect(payload.messages.map((message: BrowserIncomingMessage) => message.history_index)).toEqual([0, 1, 2]);
    expect(payload.messages.map((message: BrowserIncomingMessage) => message.type)).toEqual([
      "quest_lifecycle_event",
      "user_message",
      "result",
    ]);
  });

  it("stops an unfinished turn at the next user boundary", () => {
    const payload = sendWindow(
      [
        { type: "user_message", id: "u-1", content: "first", timestamp: 1 },
        {
          type: "assistant",
          message: {
            id: "a-1",
            type: "message",
            role: "assistant",
            model: "test",
            content: [{ type: "text", text: "still working" }],
            stop_reason: null,
            usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          },
          parent_tool_use_id: null,
        },
        { type: "user_message", id: "u-2", content: "second", timestamp: 2 },
        result,
      ] as BrowserIncomingMessage[],
      { fromTurn: 0, turnCount: 1, sectionTurnCount: 1, visibleSectionCount: 1 },
    );

    expect(payload.messages.map((message: BrowserIncomingMessage) => (message as { id?: string }).id)).toEqual([
      "u-1",
      undefined,
    ]);
  });
});
