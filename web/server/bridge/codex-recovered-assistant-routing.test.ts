import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import {
  findMatchingRecoveredCodexAssistantReplay,
  recoverAgentMessagesFromResumedTurn,
} from "./codex-recovered-assistant-routing.js";

describe("Codex recovered assistant routing", () => {
  it("recovers the routed owner from a generic replay match without duplicating the assistant row", () => {
    // The retained incident already had the partial leader response in browser
    // history, while Codex resumed it under a generic item-N id. The replay
    // match must carry the existing route forward so recovery can replace the
    // unowned red error with one routed actionable diagnostic.
    const existing: BrowserIncomingMessage = {
      type: "assistant",
      message: {
        id: "live-partial",
        type: "message",
        role: "assistant",
        model: "gpt-5.6-sol",
        content: [{ type: "text", text: "I am reading the screenshot first." }],
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      timestamp: 100,
      threadKey: "main",
    };
    const session = {
      state: { isOrchestrator: true, model: "gpt-5.6-sol" },
      messageHistory: [existing],
    };
    const resumedText = "[thread:main] I am reading the screenshot first.";

    expect(findMatchingRecoveredCodexAssistantReplay(session, resumedText, 10)).toEqual([existing]);

    const broadcastToBrowsers = vi.fn();
    const result = recoverAgentMessagesFromResumedTurn(
      session,
      {
        id: "turn-interrupted",
        status: "interrupted",
        error: null,
        items: [{ type: "agentMessage", id: "item-1", text: resumedText }],
      },
      { disconnectedAt: 200, historyIndex: -1 },
      { codexAssistantReplayScanLimit: 10, broadcastToBrowsers },
    );

    expect(result).toEqual({ count: 1, latestLeaderRoute: { threadKey: "main" } });
    expect(session.messageHistory).toEqual([existing]);
    expect(broadcastToBrowsers).not.toHaveBeenCalled();
  });

  it("does not use an identical pre-owner assistant as routed recovery evidence", () => {
    // Once a replay match controls whether the generic browser error is
    // suppressed, matches must stay inside the pending owner's history range.
    const priorAssistant: BrowserIncomingMessage = {
      type: "assistant",
      message: {
        id: "prior-assistant",
        type: "message",
        role: "assistant",
        model: "gpt-5.6-sol",
        content: [{ type: "text", text: "Repeated status text." }],
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      timestamp: 10,
      threadKey: "q-old",
      questId: "q-old",
    };
    const currentUser: BrowserIncomingMessage = {
      type: "user_message",
      id: "current-user",
      content: "new request",
      timestamp: 20,
      threadKey: "main",
    };
    const session = {
      state: { isOrchestrator: true, model: "gpt-5.6-sol" },
      messageHistory: [priorAssistant, currentUser],
    };

    expect(findMatchingRecoveredCodexAssistantReplay(session, "Repeated status text.", 10, 1)).toBeNull();

    const broadcastToBrowsers = vi.fn();
    const result = recoverAgentMessagesFromResumedTurn(
      session,
      {
        id: "turn-current",
        status: "interrupted",
        error: null,
        items: [{ type: "agentMessage", id: "item-1", text: "Repeated status text." }],
      },
      { disconnectedAt: 30, historyIndex: 1 },
      { codexAssistantReplayScanLimit: 10, broadcastToBrowsers },
    );

    expect(result.latestLeaderRoute).toBeNull();
    expect(session.messageHistory).toHaveLength(3);
    expect(broadcastToBrowsers).toHaveBeenCalledTimes(1);
  });

  it("does not let a reused generic item id bypass owner-bounded matching", () => {
    const priorAssistant: BrowserIncomingMessage = {
      type: "assistant",
      message: {
        id: "codex-agent-item-1",
        type: "message",
        role: "assistant",
        model: "gpt-5.6-sol",
        content: [{ type: "text", text: "Old partial response." }],
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      timestamp: 10,
      threadKey: "q-old",
      questId: "q-old",
    };
    const session = {
      state: { isOrchestrator: true, model: "gpt-5.6-sol" },
      messageHistory: [
        priorAssistant,
        { type: "user_message" as const, id: "current-user", content: "new request", timestamp: 20 },
      ],
    };
    const broadcastToBrowsers = vi.fn();

    const result = recoverAgentMessagesFromResumedTurn(
      session,
      {
        id: "turn-current",
        status: "interrupted",
        error: null,
        items: [{ type: "agentMessage", id: "item-1", text: "[thread:main] Genuinely new partial." }],
      },
      { disconnectedAt: 30, historyIndex: 1 },
      { codexAssistantReplayScanLimit: 10, broadcastToBrowsers },
    );

    expect(result).toEqual({ count: 1, latestLeaderRoute: { threadKey: "main" } });
    expect(session.messageHistory).toHaveLength(3);
    expect(session.messageHistory[2]).toMatchObject({
      type: "assistant",
      message: { id: "codex-agent-turn-current-item-1" },
      threadKey: "main",
    });
    expect(broadcastToBrowsers).toHaveBeenCalledTimes(1);
  });

  it("applies the owner bound to a hot tail with a frozen absolute offset", () => {
    const oldAssistant: BrowserIncomingMessage = {
      type: "assistant",
      message: {
        id: "old",
        type: "message",
        role: "assistant",
        model: "gpt-5.6-sol",
        content: [{ type: "text", text: "Repeated status text." }],
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      threadKey: "q-old",
      questId: "q-old",
    };
    const currentAssistant: BrowserIncomingMessage = {
      ...oldAssistant,
      message: { ...oldAssistant.message, id: "current" },
      threadKey: "main",
      questId: undefined,
    };
    const session = {
      state: { isOrchestrator: true, model: "gpt-5.6-sol" },
      _frozenCount: 50,
      messageHistory: [
        oldAssistant,
        { type: "user_message" as const, id: "current-user", content: "new request", timestamp: 20 },
        currentAssistant,
      ],
    };

    expect(findMatchingRecoveredCodexAssistantReplay(session, "[thread:main] Repeated status text.", 10, 51)).toEqual([
      currentAssistant,
    ]);
  });
});
