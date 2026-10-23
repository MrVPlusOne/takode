import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import { sendHistoryWindowSync } from "./browser-transport-controller.js";

// A leader's All Threads view shows the session history window, cut at backend
// turns. Every herd event is a backend turn, but the leader feed starts a turn
// only at a human (or peer-leader) message, so a window starting at a herd event
// clips the turn that event belongs to. Without the window naming that turn, the
// browser gave the clipped turn a window-local id; loading an older window
// changed it, the scroll anchor vanished and the feed jumped to the top, where
// scrolling up could no longer load anything older.

const result = () =>
  ({
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
      session_id: "leader",
    },
  }) as BrowserIncomingMessage;

const assistant = (id: string) =>
  ({
    type: "assistant",
    timestamp: 2,
    parent_tool_use_id: null,
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "gpt-5",
      content: [{ type: "text", text: id }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
  }) as BrowserIncomingMessage;

const herdEvent = (id: string) =>
  ({
    type: "user_message",
    id,
    content: `1 event from 1 session\n\n#7 | turn_end | ${id}`,
    timestamp: 1,
    agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
  }) as BrowserIncomingMessage;

/** A human request followed by many herd-event turns, as a busy leader's history is stored. */
function herdHeavyHistory(): BrowserIncomingMessage[] {
  const history: BrowserIncomingMessage[] = [
    { type: "user_message", id: "human-request", content: "Run the evals", timestamp: 1 },
    assistant("answer"),
    result(),
  ];
  for (let index = 0; index < 20; index++) {
    history.push(herdEvent(`herd-${index}`), assistant(`ack-${index}`), result());
  }
  return history;
}

function sendWindow(messageHistory: BrowserIncomingMessage[], fromTurn: number, turnCount: number) {
  const send = vi.fn();
  sendHistoryWindowSync(
    { messageHistory },
    { send },
    { fromTurn, turnCount, sectionTurnCount: turnCount, visibleSectionCount: 1 },
  );
  return JSON.parse(send.mock.calls[0]![0]) as Extract<BrowserIncomingMessage, { type: "history_window_sync" }>;
}

describe("history window leading turn", () => {
  it("names the human turn a window starting at a herd event belongs to, in every window that clips it", () => {
    const history = herdHeavyHistory();
    // The latest window and two older ones that still start inside the same leader turn.
    for (const [fromTurn, turnCount] of [
      [16, 5],
      [10, 11],
      [1, 20],
    ]) {
      const sync = sendWindow(history, fromTurn!, turnCount!);
      expect(sync.window).toMatchObject({ from_turn: fromTurn, leading_turn_id: "human-request" });
      // The id only names the turn; the window does not pull in the human message.
      expect(sync.messages.some((message) => (message as { id?: string }).id === "human-request")).toBe(false);
    }
  });

  it("names nothing extra for a window that starts at a human message or at the history's beginning", () => {
    const history = [
      ...herdHeavyHistory(),
      { type: "user_message", id: "next-request", content: "Next", timestamp: 3 },
    ];
    // Turn 21 is the second human request: the window's first turn is a whole leader turn.
    expect(sendWindow(history as BrowserIncomingMessage[], 21, 1).window.leading_turn_id).toBe("next-request");
    expect(sendWindow(herdHeavyHistory(), 0, 5).window.leading_turn_id).toBeUndefined();
  });
});
