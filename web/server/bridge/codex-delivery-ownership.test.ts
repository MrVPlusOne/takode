import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage, CodexOutboundTurn } from "../session-types.js";
import { summarizeLocalCodexDeliveryActivity } from "./codex-delivery-ownership.js";

const user: BrowserIncomingMessage = {
  type: "user_message",
  id: "input-1",
  content: "continue",
  timestamp: 1,
};

const turn = {
  userMessageId: "input-1",
  historyIndex: 0,
} as Pick<CodexOutboundTurn, "userMessageId" | "historyIndex">;

function transientResult(ownerId: string): BrowserIncomingMessage {
  return {
    type: "result",
    data: {
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      result: "stream disconnected before completion",
      duration_ms: 0,
      duration_api_ms: 0,
      num_turns: 0,
      total_cost_usd: 0,
      stop_reason: "failed",
      usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      uuid: "retry-result",
      session_id: "session",
      codex_provider_retry: {
        family: "model_backend_stream_error",
        ownerId,
        attempt: 1,
        maxAttempts: 2,
        startedAt: 10,
      },
    },
  };
}

describe("Codex local delivery ownership", () => {
  it("ignores only the matching Takode retry marker while retaining real activity proof", () => {
    expect(summarizeLocalCodexDeliveryActivity({ messageHistory: [user, transientResult("input-1")] }, turn)).toEqual({
      count: 0,
      kinds: [],
      firstHistoryIndex: null,
      lastHistoryIndex: null,
    });

    expect(
      summarizeLocalCodexDeliveryActivity({ messageHistory: [user, transientResult("other-input")] }, turn),
    ).toMatchObject({
      count: 1,
      kinds: ["result"],
    });

    const assistant: BrowserIncomingMessage = {
      type: "assistant",
      parent_tool_use_id: null,
      timestamp: 3,
      message: {
        id: "assistant-1",
        type: "message",
        role: "assistant",
        model: "gpt-5.6-sol",
        content: [{ type: "text", text: "I started processing this request." }],
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    };
    expect(
      summarizeLocalCodexDeliveryActivity({ messageHistory: [user, transientResult("input-1"), assistant] }, turn),
    ).toMatchObject({ count: 1, kinds: ["assistant_text"] });
  });
});
