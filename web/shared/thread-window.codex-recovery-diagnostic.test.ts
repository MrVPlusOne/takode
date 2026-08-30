import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage } from "../server/session-types.js";
import {
  CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_ID,
  CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_LABEL,
  CODEX_TURN_RECOVERY_SOURCE_LABEL,
  codexTurnRecoverySourceId,
} from "./injected-event-message.js";
import { buildThreadWindowSync } from "./thread-window.js";

function assistant(id: string, text: string, threadKey: string): BrowserIncomingMessage {
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
    threadKey,
  };
}

function successfulResult(threadKey: string): BrowserIncomingMessage {
  return {
    type: "result",
    data: { type: "result", subtype: "success", is_error: false },
    threadKey,
  } as BrowserIncomingMessage;
}

describe("thread windows for Codex recovery diagnostics", () => {
  it("keeps the latest continuation and its diagnostic together without erasing the continuation boundary", () => {
    const threadKey = "main";
    const history: BrowserIncomingMessage[] = [
      { type: "user_message", id: "user-a", content: "inspect", timestamp: 1, threadKey },
      assistant("partial-a", "Partial response", threadKey),
      successfulResult(threadKey),
      {
        type: "user_message",
        id: "continuation-a",
        content: "Continue without replaying completed work.",
        timestamp: 2,
        threadKey,
        agentSource: {
          sessionId: codexTurnRecoverySourceId("user-a"),
          sessionLabel: CODEX_TURN_RECOVERY_SOURCE_LABEL,
        },
      },
      assistant("partial-continuation-a", "Continuation also stopped before a final response.", threadKey),
      {
        type: "user_message",
        id: "diagnostic-a",
        content: "Automatic replay stopped; inspect the partial continuation above.",
        timestamp: 3,
        threadKey,
        agentSource: {
          sessionId: CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_ID,
          sessionLabel: CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_LABEL,
        },
      },
      successfulResult(threadKey),
    ];

    const sync = buildThreadWindowSync({
      messageHistory: history,
      threadKey,
      fromItem: -1,
      itemCount: 1,
      sectionItemCount: 1,
      visibleItemCount: 1,
    });

    expect(sync.entries.map((entry) => entry.history_index)).toEqual([3, 4, 5, 6]);
    expect(sync.entries.filter((entry) => entry.message.type === "user_message")).toHaveLength(2);
    expect(sync.window).toMatchObject({ from_item: 1, item_count: 1, total_items: 2, has_older_items: true });
  });
});
