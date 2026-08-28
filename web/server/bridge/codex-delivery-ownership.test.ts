import { describe, expect, it } from "vitest";
import type { BrowserIncomingMessage, CodexOutboundTurn } from "../session-types.js";
import {
  hasInterruptedAssistantRecoveryWithoutTerminalEvidence,
  summarizeLocalCodexDeliveryActivity,
} from "./codex-delivery-ownership.js";

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

describe("Codex interrupted recovery classification", () => {
  const interruptedTurn = {
    status: "interrupted",
    items: [
      { type: "userMessage", content: [{ type: "text", text: "create the quest" }] },
      { type: "agentMessage", id: "partial-1", text: "I am preparing the quest." },
      { type: "reasoning", summary: ["Checking the existing work first."] },
      { type: "agentMessage", id: "partial-2", text: "I will create it now." },
    ],
  };

  it("keeps reasoning-interleaved recovered text settled unless an omitted tool fallback is known", () => {
    // Reasoning items alone are accepted same-turn recovery evidence. The
    // reconnect incident becomes incomplete only when Takode also knows a
    // locally started tool was omitted from the provider resume snapshot.
    expect(hasInterruptedAssistantRecoveryWithoutTerminalEvidence(interruptedTurn, "idle")).toBe(false);
    expect(hasInterruptedAssistantRecoveryWithoutTerminalEvidence(interruptedTurn, "idle", 1)).toBe(true);
  });

  it("does not classify terminal or still-active snapshots as incomplete", () => {
    expect(
      hasInterruptedAssistantRecoveryWithoutTerminalEvidence({ ...interruptedTurn, status: "completed" }, "idle", 1),
    ).toBe(false);
    expect(hasInterruptedAssistantRecoveryWithoutTerminalEvidence(interruptedTurn, "active", 1)).toBe(false);
  });
});
