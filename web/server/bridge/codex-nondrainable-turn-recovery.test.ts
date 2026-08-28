import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage, CodexOutboundTurn } from "../session-types.js";
import { recoverNonDrainableCodexHeadTurn } from "./codex-nondrainable-turn-recovery.js";

function user(id: string, content: string, timestamp: number): BrowserIncomingMessage {
  return { type: "user_message", id, content, timestamp };
}

function assistant(id: string, text: string, timestamp: number): BrowserIncomingMessage {
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
    timestamp,
  };
}

function acknowledgedTurn(owner: string, historyIndex: number, turnId: string): CodexOutboundTurn {
  return {
    adapterMsg: { type: "codex_start_pending", pendingInputIds: [owner], inputs: [{ content: owner }] },
    userMessageId: owner,
    pendingInputIds: [owner],
    userContent: owner,
    historyIndex,
    status: "backend_acknowledged",
    dispatchCount: 1,
    createdAt: 1,
    updatedAt: 1,
    acknowledgedAt: 1,
    turnTarget: historyIndex === 0 ? "current" : "queued",
    lastError: null,
    turnId,
    disconnectedAt: null,
    resumeConfirmedAt: null,
    autoPauseSourceKind: "manual",
  };
}

describe("recoverNonDrainableCodexHeadTurn", () => {
  it("settles every consecutive acknowledged owner with local activity before queued work", () => {
    // The retained false-running incident accumulated three distinct acknowledged
    // owners before the newest instruction. One reconnect metadata pass must
    // retire all proven-delivered heads so the queued successor can dispatch.
    const turns = [
      acknowledgedTurn("owner-1", 0, "turn-1"),
      acknowledgedTurn("owner-2", 2, "turn-2"),
      acknowledgedTurn("owner-3", 4, "turn-3"),
      { ...acknowledgedTurn("queued-owner", -1, ""), status: "queued" as const, turnId: null, turnTarget: null },
    ];
    const session = {
      id: "session",
      isGenerating: false,
      state: { backend_state: "connected" },
      codexAdapter: { getCurrentTurnId: () => null, isConnected: () => true },
      messageHistory: [
        user("owner-1", "first", 1),
        assistant("assistant-1", "first complete", 2),
        user("owner-2", "second", 3),
        assistant("assistant-2", "second complete", 4),
        user("owner-3", "third", 5),
        assistant("assistant-3", "third complete", 6),
      ],
    };
    const settleObservedActivity = vi.fn((head: CodexOutboundTurn) => {
      head.status = "completed";
    });
    const retry = vi.fn();

    expect(
      recoverNonDrainableCodexHeadTurn(session, "session_meta_stale_ack_head", {
        getHead: () => turns.find((turn) => turn.status !== "completed") ?? null,
        settleObservedActivity,
        retry,
      }),
    ).toBe(true);

    expect(settleObservedActivity.mock.calls.map(([turn]) => turn.userMessageId)).toEqual([
      "owner-1",
      "owner-2",
      "owner-3",
    ]);
    expect(retry).not.toHaveBeenCalled();
    expect(turns[3]).toMatchObject({ userMessageId: "queued-owner", status: "queued" });
  });

  it("retries only the first acknowledged owner when no delivery activity exists", () => {
    const turn = acknowledgedTurn("owner", 0, "turn");
    const session = {
      id: "session",
      isGenerating: false,
      state: { backend_state: "connected" },
      codexAdapter: { getCurrentTurnId: () => null, isConnected: () => true },
      messageHistory: [user("owner", "not yet delivered", 1)],
    };
    const settleObservedActivity = vi.fn();
    const retry = vi.fn();

    expect(
      recoverNonDrainableCodexHeadTurn(session, "stale_ack", {
        getHead: () => turn,
        settleObservedActivity,
        retry,
      }),
    ).toBe(true);

    expect(retry).toHaveBeenCalledOnce();
    expect(retry).toHaveBeenCalledWith(turn);
    expect(settleObservedActivity).not.toHaveBeenCalled();
  });
});
