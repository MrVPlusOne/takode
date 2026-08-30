import { describe, expect, it, vi } from "vitest";
import {
  CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_ID,
  CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_LABEL,
  CODEX_TURN_RECOVERY_SOURCE_LABEL,
  codexTurnRecoverySourceId,
} from "../../shared/injected-event-message.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import { sendThreadWindowSync, type BrowserTransportSessionLike } from "./browser-transport-controller.js";

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

describe("browser thread windows for Codex recovery", () => {
  it("hydrates one owner-scoped fallback with its separately owned continuation", () => {
    const threadKey = "main";
    const diagnostic: BrowserIncomingMessage = {
      type: "user_message",
      id: "diagnostic-a",
      content: "Automatic replay stopped; inspect the partial continuation above.",
      timestamp: 3,
      threadKey,
      agentSource: {
        sessionId: CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_ID,
        sessionLabel: CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_LABEL,
      },
    };
    const session = {
      messageHistory: [
        { type: "user_message", id: "user-a", content: "inspect", timestamp: 1, threadKey },
        assistant("partial-a", "Partial response", threadKey),
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
        diagnostic,
      ],
    } as BrowserTransportSessionLike;
    const send = vi.fn();

    sendThreadWindowSync(
      session,
      { send },
      {
        threadKey,
        fromItem: -1,
        itemCount: 1,
        sectionItemCount: 1,
        visibleItemCount: 1,
      },
    );

    const payload = JSON.parse(send.mock.calls[0]?.[0] as string);
    expect(payload.type).toBe("thread_window_sync");
    expect(payload.entries.map((entry: any) => entry.history_index)).toEqual([2, 3, 4]);
    expect(
      payload.entries.filter(
        (entry: any) => entry.message.agentSource?.sessionId === CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_ID,
      ),
    ).toHaveLength(1);
    expect(payload.window).toMatchObject({ from_item: 1, item_count: 1, total_items: 2, has_older_items: true });
    expect(payload.entries.some((entry: any) => entry.message.type === "error")).toBe(false);
  });
});
