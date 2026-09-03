import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage } from "../session-types.js";
import {
  findMatchingRecoveredCodexAssistantReplay,
  recoverAgentMessagesFromResumedTurn,
} from "./codex-recovered-assistant-routing.js";
import { buildLeaderThreadResponseState } from "../leader-thread-response.js";

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
      state: { isOrchestrator: true, model: "gpt-5.6-sol", leaderThreadStatuses: {} as Record<string, any> },
      messageHistory: [existing],
    };
    const resumedText = "[thread:main:C] I am reading the screenshot first.";

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
      state: { isOrchestrator: true, model: "gpt-5.6-sol", leaderThreadStatuses: {} as Record<string, any> },
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
        items: [{ type: "agentMessage", id: "item-1", text: "[thread:main:C] Genuinely new partial." }],
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

    expect(findMatchingRecoveredCodexAssistantReplay(session, "[thread:main:C] Repeated status text.", 10, 51)).toEqual(
      [currentAssistant],
    );
  });
});

describe("Codex recovered routed final responses", () => {
  function pendingHuman(): Extract<BrowserIncomingMessage, { type: "user_message" }> {
    return {
      type: "user_message",
      id: "current-user",
      content: "Please finish the answer.",
      timestamp: 20,
      threadKey: "main",
      leaderResponseCoverageVersion: 1,
    };
  }

  it("finalizes a completed recovered final against the exact pending owner", () => {
    const session = {
      id: "leader-recovered",
      state: { isOrchestrator: true, model: "gpt-5.6-sol", leaderThreadStatuses: {} as Record<string, any> },
      messageHistory: [pendingHuman()] as BrowserIncomingMessage[],
    };
    const broadcastToBrowsers = vi.fn();
    const refreshBrowserConversationViews = vi.fn();
    const invalidateLeaderThreadTabsForSession = vi.fn();

    recoverAgentMessagesFromResumedTurn(
      session,
      {
        id: "turn-completed",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            id: "final-item",
            text: "[thread:main:F] Completed recovered answer.\n{[(Thread Ready: main | recovered answer complete)]}",
          },
        ],
      },
      { disconnectedAt: 30, historyIndex: 0, userMessageId: "current-user" },
      {
        codexAssistantReplayScanLimit: 10,
        broadcastToBrowsers,
        refreshBrowserConversationViews,
        invalidateLeaderThreadTabsForSession,
      },
    );

    const response = session.messageHistory.find(
      (message): message is Extract<BrowserIncomingMessage, { type: "assistant" }> => message.type === "assistant",
    )!;
    expect(response).toMatchObject({
      leaderThreadRole: "response",
      threadResponse: { coveredUserMessageIds: ["current-user"], revisionNumber: 1 },
    });
    expect(response.leaderResponseObservedHistoryLength).toBeUndefined();
    expect(session.state.leaderThreadStatuses?.main).toMatchObject({ kind: "ready", messageId: response.message.id });
    expect(refreshBrowserConversationViews).toHaveBeenCalledWith(session);
    expect(invalidateLeaderThreadTabsForSession).toHaveBeenCalledWith(session.id);
  });

  it("restores completed replay-matched final controls exactly once after retry cleanup", () => {
    const response: Extract<BrowserIncomingMessage, { type: "assistant" }> = {
      type: "assistant",
      message: {
        id: "retained-partial-final",
        type: "message",
        role: "assistant",
        model: "gpt-5.6-sol",
        content: [{ type: "text", text: "Recovered final answer." }],
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      timestamp: 25,
      threadKey: "main",
      leaderThreadRole: "response",
    };
    const session = {
      id: "leader-replay-match",
      state: { isOrchestrator: true, model: "gpt-5.6-sol", leaderThreadStatuses: {} as Record<string, any> },
      messageHistory: [pendingHuman(), response] as BrowserIncomingMessage[],
    };
    const turn = {
      id: "turn-completed-replay",
      status: "completed" as const,
      error: null,
      items: [
        {
          type: "agentMessage" as const,
          id: "item-1",
          text: "[thread:main:F] Recovered final answer.\n{[(Thread Ready: main | recovered replay complete)]}",
        },
      ],
    };
    const broadcastToBrowsers = vi.fn();
    const refreshBrowserConversationViews = vi.fn();
    const invalidateLeaderThreadTabsForSession = vi.fn();
    const deps = {
      codexAssistantReplayScanLimit: 10,
      broadcastToBrowsers,
      refreshBrowserConversationViews,
      invalidateLeaderThreadTabsForSession,
    };

    expect(
      recoverAgentMessagesFromResumedTurn(
        session,
        turn,
        { disconnectedAt: 30, historyIndex: 0, userMessageId: "current-user" },
        deps,
      ),
    ).toEqual({ count: 1, latestLeaderRoute: { threadKey: "main" } });

    expect(session.messageHistory).toHaveLength(2);
    expect(response).toMatchObject({
      leaderThreadRole: "response",
      threadResponse: { coveredUserMessageIds: ["current-user"], revisionNumber: 1 },
      threadStatusMarkers: [expect.objectContaining({ kind: "ready", messageId: response.message.id })],
    });
    expect(response.leaderResponseObservedHistoryLength).toBeUndefined();
    expect(response.deferredThreadStatusMarkers).toBeUndefined();
    expect(buildLeaderThreadResponseState(session, "main").projection.ready).toBe(true);
    expect(session.state.leaderThreadStatuses.main).toMatchObject({
      kind: "ready",
      messageId: response.message.id,
    });
    expect(invalidateLeaderThreadTabsForSession).toHaveBeenCalledTimes(1);
    expect(refreshBrowserConversationViews).toHaveBeenCalledTimes(1);
    expect(broadcastToBrowsers).toHaveBeenCalledTimes(1);

    invalidateLeaderThreadTabsForSession.mockClear();
    refreshBrowserConversationViews.mockClear();
    broadcastToBrowsers.mockClear();
    recoverAgentMessagesFromResumedTurn(
      session,
      turn,
      { disconnectedAt: 30, historyIndex: 0, userMessageId: "current-user" },
      deps,
    );

    expect(session.messageHistory).toHaveLength(2);
    expect(invalidateLeaderThreadTabsForSession).not.toHaveBeenCalled();
    expect(refreshBrowserConversationViews).not.toHaveBeenCalled();
    expect(broadcastToBrowsers).not.toHaveBeenCalled();
  });

  it("matches recovery only after the latest exact member of a merged owner batch", () => {
    const first = pendingHuman();
    first.id = "merged-user-1";
    const second = pendingHuman();
    second.id = "merged-user-2";
    second.timestamp = 30;
    const unrelated: Extract<BrowserIncomingMessage, { type: "assistant" }> = {
      type: "assistant",
      message: {
        id: "unrelated-between-owners",
        type: "message",
        role: "assistant",
        model: "gpt-5.6-sol",
        content: [{ type: "text", text: "Shared final wording." }],
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      timestamp: 25,
      threadKey: "main",
      leaderThreadRole: "response",
    };
    const session = {
      id: "leader-merged-owner",
      state: { isOrchestrator: true, model: "gpt-5.6-sol", leaderThreadStatuses: {} as Record<string, any> },
      messageHistory: [first, unrelated, second] as BrowserIncomingMessage[],
    };

    recoverAgentMessagesFromResumedTurn(
      session,
      {
        id: "turn-merged-owner",
        status: "completed",
        error: null,
        items: [{ type: "agentMessage", id: "item-1", text: "[thread:main:F] Shared final wording." }],
      },
      {
        disconnectedAt: 40,
        historyIndex: 0,
        userMessageId: "merged-user-1",
        pendingInputIds: ["merged-user-1", "merged-user-2"],
        historyIncorporation: {
          inputIds: ["merged-user-1", "merged-user-2"],
          historyIndexes: [0, 2],
        } as any,
      },
      { codexAssistantReplayScanLimit: 10, broadcastToBrowsers: vi.fn() },
    );

    const responses = session.messageHistory.filter(
      (entry): entry is Extract<BrowserIncomingMessage, { type: "assistant" }> => entry.type === "assistant",
    );
    expect(responses).toHaveLength(2);
    expect(unrelated.threadResponse).toBeUndefined();
    expect(responses[1]).toMatchObject({
      message: { id: "codex-agent-turn-merged-owner-item-1" },
      threadResponse: { coveredUserMessageIds: ["merged-user-1", "merged-user-2"] },
    });
  });

  it("does not restore Ready when a completed replay match lacks exact response observation proof", () => {
    const response: Extract<BrowserIncomingMessage, { type: "assistant" }> = {
      type: "assistant",
      message: {
        id: "unproven-replay-final",
        type: "message",
        role: "assistant",
        model: "gpt-5.6-sol",
        content: [{ type: "text", text: "Unproven recovered answer." }],
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      timestamp: 25,
      threadKey: "main",
      leaderThreadRole: "response",
    };
    const session = {
      id: "leader-unproven-replay",
      state: { isOrchestrator: true, model: "gpt-5.6-sol", leaderThreadStatuses: {} as Record<string, any> },
      messageHistory: [pendingHuman(), response] as BrowserIncomingMessage[],
      pendingLeaderRejectedReadyThreadKeys: [] as string[],
    };
    const invalidateLeaderThreadTabsForSession = vi.fn();

    recoverAgentMessagesFromResumedTurn(
      session,
      {
        id: "turn-unproven-replay",
        status: "completed",
        error: null,
        items: [
          {
            type: "agentMessage",
            id: "item-1",
            text: "[thread:main:F] Unproven recovered answer.\n{[(Thread Ready: main | should be rejected)]}",
          },
        ],
      },
      { disconnectedAt: 30, historyIndex: -1 },
      { codexAssistantReplayScanLimit: 10, broadcastToBrowsers: vi.fn(), invalidateLeaderThreadTabsForSession },
    );

    expect(response.threadResponse).toBeUndefined();
    expect(response.threadStatusMarkers).toBeUndefined();
    expect(session.state.leaderThreadStatuses.main).toBeUndefined();
    expect(buildLeaderThreadResponseState(session, "main").projection.pendingMessageCount).toBe(1);
    // Historical replay must not inject a fresh reminder turn. Preserve the
    // rejection so the next normal outcome-validation boundary can do so.
    expect(session.pendingLeaderRejectedReadyThreadKeys).toEqual(["main"]);
    expect(invalidateLeaderThreadTabsForSession).not.toHaveBeenCalled();
  });

  it("keeps an interrupted recovered final non-authoritative", () => {
    const session = {
      id: "leader-interrupted",
      state: { isOrchestrator: true, model: "gpt-5.6-sol" },
      messageHistory: [pendingHuman()] as BrowserIncomingMessage[],
    };

    recoverAgentMessagesFromResumedTurn(
      session,
      {
        id: "turn-interrupted",
        status: "interrupted",
        error: null,
        items: [{ type: "agentMessage", id: "partial-item", text: "[thread:main:F] Partial recovered answer." }],
      },
      { disconnectedAt: 30, historyIndex: 0, userMessageId: "current-user" },
      { codexAssistantReplayScanLimit: 10, broadcastToBrowsers: vi.fn() },
    );

    const response = session.messageHistory.find(
      (message): message is Extract<BrowserIncomingMessage, { type: "assistant" }> => message.type === "assistant",
    )!;
    expect(response.leaderThreadRole).toBe("response");
    expect(response.threadResponse).toBeUndefined();
    expect(response.leaderResponseObservedHistoryLength).toBeUndefined();
  });

  it("does not replay-dedupe a final marker onto an older roleless commentary row", () => {
    const existing: Extract<BrowserIncomingMessage, { type: "assistant" }> = {
      type: "assistant",
      message: {
        id: "old-commentary",
        type: "message",
        role: "assistant",
        model: "gpt-5.6-sol",
        content: [{ type: "text", text: "Same body." }],
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      timestamp: 100,
      threadKey: "main",
    };
    const session = { state: { isOrchestrator: true, model: "gpt-5.6-sol" }, messageHistory: [existing] };

    expect(findMatchingRecoveredCodexAssistantReplay(session, "[thread:main:F] Same body.", 10)).toBeNull();
    expect(findMatchingRecoveredCodexAssistantReplay(session, "[thread:main:C] Same body.", 10)).toEqual([existing]);
  });
});
