import { describe, expect, it, vi } from "vitest";
import { dispatchQueuedCodexTurns } from "./codex-recovery-orchestrator.js";

describe("Codex model-switch queued dispatch activity", () => {
  it("marks queued post-switch input as substantive only when the replacement adapter accepts dispatch", () => {
    // A user message can wait through the model-switch relaunch. The migration
    // guard must survive that queue, then become ineligible for suppression at
    // the authoritative adapter-accepted dispatch boundary.
    const pending = {
      adapterMsg: { type: "codex_start_pending", pendingInputIds: ["input-1"], inputs: [{ content: "continue" }] },
      userMessageId: "input-1",
      pendingInputIds: ["input-1"],
      userContent: "continue",
      historyIndex: -1,
      status: "queued",
      dispatchCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      acknowledgedAt: null,
      turnTarget: null,
      lastError: null,
      turnId: null,
      disconnectedAt: null,
      resumeConfirmedAt: null,
    };
    const session = {
      id: "test-session",
      backendType: "codex",
      state: { backend_state: "connected", backend_type: "codex" },
      pendingCodexInputs: [],
      pendingCodexTurns: [pending],
      codexFreshTurnRequiredUntilTurnId: null,
      isGenerating: false,
      codexModelSwitchCompactionGuard: {
        previousModel: "gpt-5.5",
        nextModel: "gpt-5.6-sol",
        createdAt: Date.now(),
        expiresAt: Date.now() + 60_000,
        modelActivityObserved: false,
      },
      codexAdapter: {
        isConnected: () => true,
        getCurrentTurnId: () => null,
        sendBrowserMessage: vi.fn(() => true),
      },
    } as any;
    const persistSession = vi.fn();
    const deps = {
      broadcastPendingCodexInputs: vi.fn(),
      broadcastToBrowsers: vi.fn(),
      pruneStalePendingCodexHerdInputs: vi.fn(() => false),
      setPendingCodexInputsCancelable: vi.fn(),
      persistSession,
      isCodexWorkerV2DeliveryFrozen: vi.fn(() => false),
    } as any;

    dispatchQueuedCodexTurns(session, "session_meta", deps);

    expect(pending.status).toBe("dispatched");
    expect(session.codexModelSwitchCompactionGuard.modelActivityObserved).toBe(true);
    expect(persistSession).toHaveBeenCalledWith(session);
  });
});
