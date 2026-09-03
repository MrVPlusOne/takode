import { describe, expect, it, vi } from "vitest";
import {
  CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_ID,
  CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_LABEL,
  CODEX_TURN_RECOVERY_SOURCE_LABEL,
  codexTurnRecoverySourceId,
} from "../../shared/injected-event-message.js";
import type { BrowserIncomingMessage } from "../session-types.js";
import { sendThreadWindowSync, type BrowserTransportSessionLike } from "./browser-transport-controller.js";
import { commitPendingCodexInputs } from "./codex-recovery-orchestrator.js";

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
  it("preserves exact committed recovery delivery content in the authoritative thread window", () => {
    const threadKey = "q-2033";
    const exactModelDeliveryContent =
      "[System Thu, Sep 3 11:20 AM] [thread:q-2033] Private recovery instruction\n\nMemory catalog preloaded";
    const session = {
      id: "leader-session",
      state: { backend_state: "connected", cwd: "/tmp" },
      messageHistory: [
        { type: "user_message", id: "original-owner", content: "Original request", timestamp: 1, threadKey },
      ],
      notifications: [],
      pendingCodexInputs: [
        {
          id: "continuation-owner",
          content: "Takode added a separate follow-up.",
          deliveryContent: exactModelDeliveryContent,
          timestamp: 2,
          cancelable: false,
          agentSource: {
            sessionId: codexTurnRecoverySourceId("original-owner"),
            sessionLabel: CODEX_TURN_RECOVERY_SOURCE_LABEL,
          },
          threadKey,
          questId: threadKey,
          requireFreshSuccessor: true,
        },
      ],
      pendingCodexTurns: [],
      isGenerating: false,
    } as any;

    commitPendingCodexInputs(session, ["continuation-owner"], {
      broadcastPendingCodexInputs: vi.fn(),
      broadcastToBrowsers: vi.fn(),
      persistSession: vi.fn(),
      touchUserMessage: vi.fn(),
      onUserMessage: vi.fn(),
    } as any);
    expect(session.messageHistory[1]).toMatchObject({
      type: "user_message",
      content: "Takode added a separate follow-up.",
      modelDeliveryContent: exactModelDeliveryContent,
    });

    const send = vi.fn();
    sendThreadWindowSync(
      session,
      { send },
      {
        threadKey,
        fromItem: 0,
        itemCount: 2,
        sectionItemCount: 2,
        visibleItemCount: 2,
      },
    );

    const payload = JSON.parse(send.mock.calls[0]?.[0] as string);
    const recoveryEntry = payload.entries.find((entry: any) => entry.message.id === "continuation-owner");
    expect(recoveryEntry.message.content).toBe("Takode added a separate follow-up.");
    expect(recoveryEntry.message.modelDeliveryContent).toBe(exactModelDeliveryContent);
  });

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
      codexTurnRecoveryId: "user-a",
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

    if (diagnostic.type !== "user_message") throw new Error("expected diagnostic user message");
    diagnostic.codexTurnRecoveryResolvedAt = 4;
    send.mockClear();
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

    const resolvedPayload = JSON.parse(send.mock.calls[0]?.[0] as string);
    expect(resolvedPayload.entries.map((entry: any) => entry.history_index)).toEqual([2, 3]);
    expect(
      resolvedPayload.entries.some(
        (entry: any) => entry.message.agentSource?.sessionId === CODEX_LEADER_RECOVERY_DIAGNOSTIC_SOURCE_ID,
      ),
    ).toBe(false);
    expect(session.messageHistory).toContain(diagnostic);
  });
});
