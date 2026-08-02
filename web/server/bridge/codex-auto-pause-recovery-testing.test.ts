import { describe, expect, it, vi } from "vitest";
import type { CodexOutboundTurn, SessionState } from "../session-types.js";
import { markAcceptedCodexAutoPauseRecoveryDispatch } from "./codex-auto-pause-recovery-testing.js";

function activePause(): NonNullable<SessionState["codex_result_error_auto_pause"]> {
  return {
    family: "copilot_auth_refresh_exhausted",
    fingerprint: "copilot_auth_refresh_exhausted:github_copilot",
    streak: 1,
    threshold: 1,
    pausedAt: 100,
    lastError: "GitHub Copilot API-key refresh exhausted its retry budget.",
    lastErrorAt: 100,
    lastSourceKind: "automatic",
    totalMatchingErrors: 1,
    heldInputs: [],
  };
}

function turn(id: string, source: "manual" | "automatic", target: "current" | "queued" | null): CodexOutboundTurn {
  return {
    adapterMsg: { type: "codex_start_pending", pendingInputIds: [id], inputs: [{ content: id }] },
    userMessageId: id,
    pendingInputIds: [id],
    userContent: id,
    historyIndex: -1,
    status: "dispatched",
    dispatchCount: 1,
    createdAt: 1,
    updatedAt: 1,
    acknowledgedAt: null,
    turnTarget: target,
    lastError: null,
    turnId: null,
    disconnectedAt: null,
    resumeConfirmedAt: null,
    autoPauseSourceKind: source,
  };
}

describe("accepted Codex auto-pause recovery dispatch", () => {
  it("does not claim unrelated automatic or explicitly queued manual turns", () => {
    // Ownership must match both the exact accepted input and its lifecycle
    // target; generic running state cannot convert another turn into a probe.
    const automatic = turn("automatic-input", "automatic", null);
    const queuedManual = turn("queued-manual-input", "manual", "queued");
    const session = {
      state: { codex_result_error_auto_pause: activePause() },
      pendingCodexTurns: [automatic, queuedManual],
      isGenerating: true,
    };
    const deps = { broadcastToBrowsers: vi.fn(), persistSession: vi.fn() };

    expect(markAcceptedCodexAutoPauseRecoveryDispatch(session, automatic.userMessageId, "current", deps)).toBe(false);
    expect(markAcceptedCodexAutoPauseRecoveryDispatch(session, queuedManual.userMessageId, "current", deps)).toBe(
      false,
    );
    expect(markAcceptedCodexAutoPauseRecoveryDispatch(session, queuedManual.userMessageId, "queued", deps)).toBe(false);
    expect(automatic.turnTarget).toBeNull();
    expect(queuedManual.turnTarget).toBe("queued");
    expect(deps.broadcastToBrowsers).not.toHaveBeenCalled();
    expect(deps.persistSession).not.toHaveBeenCalled();
  });
});
