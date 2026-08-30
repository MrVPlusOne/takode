import { describe, expect, it } from "vitest";
import {
  CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_ID,
  CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_LABEL,
  CODEX_TURN_RECOVERY_SOURCE_LABEL,
  codexTurnRecoverySourceId,
} from "../shared/injected-event-message.js";
import type { BrowserIncomingMessage } from "./session-types.js";
import { findTurnBoundaries } from "./turn-boundaries.js";

function assistant(id: string, text: string): BrowserIncomingMessage {
  return {
    type: "assistant",
    message: {
      id,
      type: "message",
      role: "assistant",
      model: "gpt-5.6-sol",
      content: [{ type: "text", text }],
      stop_reason: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    },
    parent_tool_use_id: null,
  };
}

function successfulResult(): BrowserIncomingMessage {
  return { type: "result", data: { type: "result", subtype: "success", is_error: false } } as BrowserIncomingMessage;
}

describe("turn boundaries", () => {
  it("keeps neutral recovery diagnostics inside their owner while preserving continuation turns", () => {
    // The browser-only diagnostic must stay with the interrupted continuation
    // it explains. The separately model-bound continuation remains a real turn.
    const history: BrowserIncomingMessage[] = [
      { type: "user_message", id: "user-a", content: "inspect", timestamp: 1, threadKey: "main" },
      assistant("partial-a", "Partial response"),
      successfulResult(),
      {
        type: "user_message",
        id: "continuation-a",
        content: "Continue without replaying completed work.",
        timestamp: 2,
        threadKey: "main",
        agentSource: {
          sessionId: codexTurnRecoverySourceId("user-a"),
          sessionLabel: CODEX_TURN_RECOVERY_SOURCE_LABEL,
        },
      },
      assistant("partial-continuation-a", "Continuation also stopped before a final response."),
      {
        type: "user_message",
        id: "diagnostic-a",
        content: "Automatic replay stopped; inspect the partial continuation above.",
        timestamp: 3,
        threadKey: "main",
        agentSource: {
          sessionId: CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_ID,
          sessionLabel: CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_LABEL,
        },
      },
      successfulResult(),
    ];

    expect(findTurnBoundaries(history)).toEqual([
      { startIdx: 0, endIdx: 2 },
      { startIdx: 3, endIdx: 6 },
    ]);
  });
});
