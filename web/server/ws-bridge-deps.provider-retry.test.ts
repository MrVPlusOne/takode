import { describe, expect, it, vi } from "vitest";
import type { CodexOutboundTurn } from "./session-types.js";
import { getCodexRecoveryOrchestratorDeps } from "./ws-bridge-deps.js";

function turn(): CodexOutboundTurn {
  return {
    adapterMsg: { type: "codex_start_pending", pendingInputIds: ["input-1"], inputs: [] },
    userMessageId: "input-1",
    pendingInputIds: ["input-1"],
    userContent: "continue",
    historyIndex: 0,
    status: "backend_acknowledged",
    dispatchCount: 1,
    createdAt: 1,
    updatedAt: 2,
    acknowledgedAt: 2,
    turnTarget: "current",
    lastError: null,
    turnId: "turn-1",
    disconnectedAt: null,
    resumeConfirmedAt: null,
  };
}

describe("Codex provider retry settlement", () => {
  it("retires matching retry state when exact-once recovery completes the owner", () => {
    const broadcastToBrowsers = vi.fn();
    const host = {
      getGenerationLifecycleDeps: () => ({}),
      getCommonCodexRuntimeDeps: () => ({}),
      broadcastToBrowsers,
    };
    const deps = getCodexRecoveryOrchestratorDeps(host);
    const pending = turn();
    const session = {
      state: {
        codex_provider_retry: {
          family: "model_backend_stream_error",
          ownerId: "input-1",
          attempt: 1,
          maxAttempts: 2,
          startedAt: 10,
        },
      },
      pendingCodexTurns: [pending],
    } as any;

    expect(deps.completeCodexTurn(session, pending)).toBe(true);
    expect(session.state.codex_provider_retry).toBeNull();
    expect(broadcastToBrowsers).toHaveBeenCalledWith(session, {
      type: "session_update",
      session: { codex_provider_retry: null },
    });
  });
});
