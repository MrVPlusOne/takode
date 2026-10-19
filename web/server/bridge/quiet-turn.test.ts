/**
 * Tests for the server-side quiet decision at turn end: the worker's marker is a
 * request, and Takode delivers the turn normally whenever the leader may need it.
 */
import { describe, it, expect } from "vitest";
import { resolveQuietTurn, type QuietTurnSession } from "./quiet-turn.js";
import type { TakodeTurnEndEventData } from "../session-types.js";

const MARKED_TEXT = "No alert (2 PM check).\n\n{[(Quiet: 2 PM check, nothing new)]}";

function assistant(text: string, extra: Record<string, unknown> = {}) {
  return { type: "assistant", message: { content: [{ type: "text", text }] }, ...extra };
}

/** A worker turn started by its own timer firing, ending with `lastText`. */
function timerTurn(lastText = MARKED_TEXT, overrides: Partial<QuietTurnSession> = {}): QuietTurnSession {
  return {
    id: "worker-1",
    messageCountAtTurnStart: 1,
    userMessageIdsThisTurn: [1],
    messageHistory: [
      assistant("earlier turn"),
      { type: "user_message", content: "[⏰ Timer t1 reminder]", agentSource: { sessionId: "timer:t1" } },
      assistant(lastText),
    ],
    ...overrides,
  };
}

const RESULT: TakodeTurnEndEventData = { reason: "result", duration_ms: 1000 };
const WITH_TIMER = { hasResumeSource: () => true };

describe("resolveQuietTurn", () => {
  it("accepts the marker on a timer-started turn that something will resume", () => {
    expect(resolveQuietTurn(timerTurn(), RESULT, 0, WITH_TIMER)).toEqual({
      quiet: { summary: "2 PM check, nothing new" },
    });
  });

  it("returns nothing for a turn without the marker, so it reaches the leader as today", () => {
    expect(resolveQuietTurn(timerTurn("Found a new alert."), RESULT, 0, WITH_TIMER)).toEqual({});
  });

  it("ignores a marker that is not in the turn's last text", () => {
    // A finding written after the marker must not hide behind it.
    const session = timerTurn();
    session.messageHistory.push(assistant("Wait, a new alert appeared."));
    expect(resolveQuietTurn(session, RESULT, 0, WITH_TIMER)).toEqual({});
  });

  it("ignores subagent messages when finding the turn's last text", () => {
    const session = timerTurn();
    session.messageHistory.push(assistant("subagent output", { parent_tool_use_id: "tool-1" }));
    expect(resolveQuietTurn(session, RESULT, 0, WITH_TIMER).quiet?.summary).toBe("2 PM check, nothing new");
  });

  it("delivers turns that answered a leader or user message", () => {
    const fromLeader = timerTurn(MARKED_TEXT, {
      messageHistory: [
        assistant("earlier turn"),
        { type: "user_message", content: "status?", agentSource: { sessionId: "leader-session-id" } },
        assistant(MARKED_TEXT),
      ],
    });
    const fromUser = timerTurn(MARKED_TEXT, {
      messageHistory: [assistant("earlier turn"), { type: "user_message", content: "hi" }, assistant(MARKED_TEXT)],
    });
    for (const session of [fromLeader, fromUser]) {
      expect(resolveQuietTurn(session, RESULT, 0, WITH_TIMER)).toEqual({
        quiet_ignored: "the turn answered a leader or user message",
      });
    }
  });

  it("delivers when nothing will resume the worker", () => {
    // Without a timer, job or queue, a quiet worker would silently stop.
    expect(resolveQuietTurn(timerTurn(), RESULT, 0, { hasResumeSource: () => false })).toEqual({
      quiet_ignored: "nothing will resume the worker",
    });
  });

  it.each<[string, TakodeTurnEndEventData, Partial<QuietTurnSession>, string]>([
    ["interrupted", { ...RESULT, interrupted: true }, {}, "the turn was interrupted"],
    ["ended without a result", { ...RESULT, reason: "cli_disconnect" }, {}, "the turn was interrupted"],
    ["failed", { ...RESULT, is_error: true }, {}, "the turn failed"],
    ["asked a decision", { ...RESULT, awaiting_decision: true }, {}, "the turn asked a question"],
    [
      "created a needs-input notification",
      RESULT,
      { notifications: [{ category: "needs-input", timestamp: 500 }] },
      "the turn asked a question",
    ],
    ["has an open permission", RESULT, { pendingPermissions: { size: 1 } }, "a permission request is open"],
    [
      "changed the quest status",
      { ...RESULT, questChange: { questId: "q-1", from: "in_progress", to: "done" } },
      {},
      "the quest status changed",
    ],
  ])("delivers a quiet-marked turn that %s", (_label, turn, overrides, reason) => {
    expect(resolveQuietTurn(timerTurn(MARKED_TEXT, overrides), turn, 100, WITH_TIMER)).toEqual({
      quiet_ignored: reason,
    });
  });
});
