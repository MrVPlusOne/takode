import { describe, expect, it, vi } from "vitest";
import {
  buildCodexPendingDeliveryDiagnostics,
  recordCodexPendingDeliveryProofSignal,
  type CodexPendingDeliveryDiagnosticsSessionLike,
} from "./codex-pending-delivery-diagnostics.js";
import type { CodexOutboundTurn, PendingCodexInput } from "./session-types.js";

function makePendingInput(id = "input-1", timestamp = 1_000): PendingCodexInput {
  return {
    id,
    content: "hidden payload must not appear in diagnostics",
    timestamp,
    cancelable: true,
  };
}

function makeTurn(status: CodexOutboundTurn["status"] = "backend_acknowledged"): CodexOutboundTurn {
  return {
    adapterMsg: {
      type: "codex_start_pending",
      pendingInputIds: ["input-1"],
      inputs: [{ content: "hidden pending batch payload" }],
    },
    userMessageId: "input-1",
    pendingInputIds: ["input-1"],
    userContent: "hidden recovery text",
    historyIndex: -1,
    status,
    dispatchCount: 1,
    createdAt: 1_000,
    updatedAt: 1_000,
    acknowledgedAt: status === "backend_acknowledged" ? 1_100 : null,
    turnTarget: "current",
    lastError: null,
    turnId: status === "queued" ? null : "turn-1",
    disconnectedAt: null,
    resumeConfirmedAt: null,
  };
}

function makeSession(
  overrides: Partial<CodexPendingDeliveryDiagnosticsSessionLike> = {},
): CodexPendingDeliveryDiagnosticsSessionLike {
  return {
    backendType: "codex",
    isGenerating: false,
    state: { backend_state: "connected" },
    pendingCodexInputs: [makePendingInput()],
    pendingCodexTurns: [makeTurn()],
    codexFreshTurnRequiredUntilTurnId: null,
    codexAdapter: {
      getCurrentTurnId: vi.fn(() => null),
      isConnected: vi.fn(() => true),
    },
    ...overrides,
  };
}

describe("buildCodexPendingDeliveryDiagnostics", () => {
  it("classifies no pending work as unblocked and omits payload text", () => {
    const diagnostics = buildCodexPendingDeliveryDiagnostics(
      makeSession({ pendingCodexInputs: [], pendingCodexTurns: [] }),
      { now: 10_000, details: true },
    );

    expect(diagnostics.blockerReason).toBe("none");
    expect(diagnostics.pendingInputCount).toBe(0);
    expect(JSON.stringify(diagnostics)).not.toContain("hidden");
  });

  it("classifies failed-only input as user-actionable rather than blocked delivery", () => {
    const failed = makePendingInput();
    failed.deliveryState = "failed";
    failed.failureReason = "nonrecoverable_turn_start";
    const diagnostics = buildCodexPendingDeliveryDiagnostics(
      makeSession({ pendingCodexInputs: [failed], pendingCodexTurns: [], codexAdapter: null }),
      { now: 10_000 },
    );

    expect(diagnostics).toMatchObject({ blockerReason: "failed_input", pendingInputCount: 1, pendingTurnCount: 0 });
  });

  it("classifies active current turn id as the pending-delivery blocker", () => {
    const diagnostics = buildCodexPendingDeliveryDiagnostics(
      makeSession({
        codexAdapter: {
          getCurrentTurnId: vi.fn(() => "turn-active"),
          isConnected: vi.fn(() => true),
        },
      }),
      { now: 11_000 },
    );

    expect(diagnostics).toMatchObject({
      blockerReason: "active_turn_id_present",
      currentTurnId: "turn-active",
      pendingInputCount: 1,
      pendingTurnCount: 1,
      oldestPendingAgeMs: 10_000,
      head: {
        status: "backend_acknowledged",
        turnId: "turn-1",
        turnTarget: "current",
        dispatchCount: 1,
      },
    });
  });

  it("classifies no-active-turn backend-ack head as stale backend-ack blockage", () => {
    const diagnostics = buildCodexPendingDeliveryDiagnostics(makeSession(), { now: 11_000 });

    expect(diagnostics.blockerReason).toBe("stale_backend_ack_head");
  });

  it("classifies disconnected, broken, and recovery-suppressed states before queue shape", () => {
    expect(
      buildCodexPendingDeliveryDiagnostics(makeSession({ codexAdapter: null }), { now: 11_000 }).blockerReason,
    ).toBe("adapter_missing");
    expect(
      buildCodexPendingDeliveryDiagnostics(
        makeSession({
          codexAdapter: {
            getCurrentTurnId: vi.fn(() => null),
            isConnected: vi.fn(() => false),
          },
        }),
        { now: 11_000 },
      ).blockerReason,
    ).toBe("adapter_disconnected");
    expect(
      buildCodexPendingDeliveryDiagnostics(makeSession({ state: { backend_state: "broken" } }), { now: 11_000 })
        .blockerReason,
    ).toBe("broken");
    expect(
      buildCodexPendingDeliveryDiagnostics(makeSession({ state: { backend_state: "recovery_suppressed" } }), {
        now: 11_000,
      }).blockerReason,
    ).toBe("recovery_suppressed");
  });

  it("reports payload-free owner, route, and local model-activity evidence", () => {
    const turn = makeTurn();
    turn.historyIndex = 100;
    const diagnostics = buildCodexPendingDeliveryDiagnostics(
      makeSession({
        _frozenCount: 100,
        messageHistory: [
          {
            type: "user_message",
            id: "input-1",
            content: "hidden source content",
            timestamp: 1_000,
            threadKey: "q-sanitized",
            questId: "q-sanitized",
          },
          {
            type: "assistant",
            message: {
              id: "tool-call",
              type: "message",
              role: "assistant",
              model: "gpt-test",
              content: [{ type: "tool_use", id: "call-1", name: "Bash", input: { command: "hidden" } }],
              stop_reason: null,
              usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
            },
            parent_tool_use_id: null,
            timestamp: 1_100,
          },
          { type: "tool_result_preview", previews: [] },
        ],
        pendingCodexTurns: [turn],
      }),
      { details: true },
    );

    expect(diagnostics.head).toMatchObject({
      userMessageId: "input-1",
      historyIndex: 100,
      threadKey: "q-sanitized",
      questId: "q-sanitized",
      localActivity: { count: 2, kinds: ["tool_use", "tool_result"], firstHistoryIndex: 101, lastHistoryIndex: 102 },
    });
    expect(JSON.stringify(diagnostics)).not.toContain("hidden");
  });

  it("retains a bounded payload-free proof signal trail", () => {
    const session = makeSession();
    for (let i = 0; i < 10; i++) {
      recordCodexPendingDeliveryProofSignal(session, {
        kind: "turn_started",
        turnId: `turn-${i}`,
        timestamp: i,
      });
    }

    const diagnostics = buildCodexPendingDeliveryDiagnostics(session, { details: true });

    expect(diagnostics.proofSignals).toHaveLength(8);
    expect(diagnostics.proofSignals[0]?.turnId).toBe("turn-2");
    expect(JSON.stringify(diagnostics)).not.toContain("hidden");
  });
});
