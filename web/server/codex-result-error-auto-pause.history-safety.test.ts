import { describe, expect, it } from "vitest";
import type { CodexOutboundTurn, PendingCodexInput } from "./session-types.js";
import { sweepCodexAutoPausedQueuedBacklog } from "./codex-result-error-auto-pause.js";
import { normalizePersistedCodexTurn } from "./bridge/session-registry-controller.js";
import {
  beginCodexHistoryAbsentReplay,
  createCodexHistoryIncorporation,
} from "./bridge/codex-history-incorporation.js";

function activePause() {
  return {
    family: "model_backend_stream_error" as const,
    fingerprint: "model_backend_stream_error:responses",
    streak: 3,
    threshold: 3,
    pausedAt: 100,
    lastError: "Model backend stream disconnected before completion.",
    lastErrorAt: 100,
    lastSourceKind: "automatic" as const,
    totalMatchingErrors: 3,
    heldInputs: [],
  };
}

function queuedTurn(ids: string[]): CodexOutboundTurn {
  const historyIncorporation = createCodexHistoryIncorporation(ids);
  return {
    adapterMsg: {
      type: "codex_start_pending",
      pendingInputIds: ids,
      inputs: ids.map((id) => ({ content: id })),
      clientUserMessageId: historyIncorporation.clientUserMessageId,
    },
    userMessageId: ids[0]!,
    pendingInputIds: ids,
    userContent: ids.join("\n\n"),
    historyIndex: -1,
    status: "queued",
    dispatchCount: 0,
    createdAt: 1,
    updatedAt: 1,
    acknowledgedAt: null,
    turnTarget: null,
    lastError: null,
    turnId: null,
    disconnectedAt: null,
    resumeConfirmedAt: null,
    historyIncorporation,
  };
}

function automaticInput(id: string): PendingCodexInput {
  return {
    id,
    content: id,
    timestamp: 1,
    cancelable: true,
    autoPauseSourceKind: "automatic",
    agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
  };
}

describe("Codex auto-pause history safety", () => {
  it("regenerates never-dispatched batch identity after pruning an automatic member", () => {
    const manual: PendingCodexInput = {
      id: "manual",
      content: "manual",
      timestamp: 1,
      cancelable: true,
      autoPauseSourceKind: "manual",
    };
    const automatic = automaticInput("automatic");
    const turn = queuedTurn([manual.id, automatic.id]);
    const oldClientId = turn.historyIncorporation!.clientUserMessageId;
    const session = {
      state: { codex_result_error_auto_pause: activePause() },
      pendingCodexInputs: [manual, automatic],
      pendingCodexTurns: [turn],
    };

    const swept = sweepCodexAutoPausedQueuedBacklog(session);

    expect(swept).toMatchObject({ changed: true, heldInputIds: ["automatic"] });
    expect(session.pendingCodexInputs.map((input) => input.id)).toEqual(["manual"]);
    expect(turn).toMatchObject({
      userMessageId: "manual",
      pendingInputIds: ["manual"],
      autoPauseSourceKind: "manual",
      historyTrackingUnknown: undefined,
    });
    expect(turn.historyIncorporation).toMatchObject({ inputIds: ["manual"], attempt: 0 });
    expect(turn.historyIncorporation!.clientUserMessageId).not.toBe(oldClientId);
    expect(turn.adapterMsg).toMatchObject({
      pendingInputIds: ["manual"],
      clientUserMessageId: turn.historyIncorporation!.clientUserMessageId,
    });
  });

  it("keeps queued continuation and replay batches out of generic automatic holding", () => {
    const continuation = automaticInput("continuation");
    continuation.requireFreshSuccessor = true;
    const replay = automaticInput("replay");
    const continuationTurn = queuedTurn([continuation.id]);
    continuationTurn.requiresFreshSuccessor = true;
    const replayTurn = queuedTurn([replay.id]);
    expect(beginCodexHistoryAbsentReplay(replayTurn)).toBe(true);
    const session = {
      state: { codex_result_error_auto_pause: activePause() },
      pendingCodexInputs: [continuation, replay],
      pendingCodexTurns: [continuationTurn, replayTurn],
    };

    expect(sweepCodexAutoPausedQueuedBacklog(session)).toEqual({
      changed: false,
      heldInputCount: 0,
      heldInputIds: [],
    });
    expect(session.pendingCodexInputs.map((input) => input.id)).toEqual(["continuation", "replay"]);
    expect(continuationTurn.requiresFreshSuccessor).toBe(true);
    expect(replayTurn.historyIncorporation?.attempt).toBe(1);
  });

  it("preserves a malformed restored batch instead of regenerating uncertain history identity", () => {
    const manual: PendingCodexInput = {
      id: "manual-restored",
      content: "manual-restored",
      timestamp: 1,
      cancelable: true,
      autoPauseSourceKind: "manual",
    };
    const automatic = automaticInput("automatic-restored");
    const rawTurn = queuedTurn([manual.id, automatic.id]);
    rawTurn.historyIncorporation!.inputIds = [manual.id, manual.id];
    const originalClientId = rawTurn.historyIncorporation!.clientUserMessageId;
    const turn = normalizePersistedCodexTurn(rawTurn, 10);
    const session = {
      state: { codex_result_error_auto_pause: activePause() },
      pendingCodexInputs: [manual, automatic],
      pendingCodexTurns: [turn],
    };

    expect(turn).toMatchObject({
      pendingInputIds: [manual.id, automatic.id],
      historyTrackingUnknown: true,
      historyIncorporation: undefined,
    });
    expect(sweepCodexAutoPausedQueuedBacklog(session)).toEqual({
      changed: false,
      heldInputCount: 0,
      heldInputIds: [],
    });
    expect(session.pendingCodexInputs.map((input) => input.id)).toEqual([manual.id, automatic.id]);
    expect(turn.pendingInputIds).toEqual([manual.id, automatic.id]);
    expect(turn.historyTrackingUnknown).toBe(true);
    expect((turn.adapterMsg as { clientUserMessageId?: string }).clientUserMessageId).toBe(originalClientId);
  });

  it("preserves an acknowledgement-lost batch identity instead of pruning a member", () => {
    const manual: PendingCodexInput = {
      id: "manual-lost-ack",
      content: "manual-lost-ack",
      timestamp: 1,
      cancelable: true,
      autoPauseSourceKind: "manual",
    };
    const automatic = automaticInput("automatic-lost-ack");
    const turn = queuedTurn([manual.id, automatic.id]);
    turn.status = "blocked_broken_session";
    turn.dispatchCount = 1;
    const originalClientId = turn.historyIncorporation!.clientUserMessageId;
    const session = {
      state: { codex_result_error_auto_pause: activePause() },
      pendingCodexInputs: [manual, automatic],
      pendingCodexTurns: [turn],
    };

    expect(sweepCodexAutoPausedQueuedBacklog(session)).toEqual({
      changed: false,
      heldInputCount: 0,
      heldInputIds: [],
    });
    expect(session.pendingCodexInputs.map((input) => input.id)).toEqual([manual.id, automatic.id]);
    expect(turn.pendingInputIds).toEqual([manual.id, automatic.id]);
    expect(turn.historyIncorporation?.clientUserMessageId).toBe(originalClientId);
    expect((turn.adapterMsg as { clientUserMessageId?: string }).clientUserMessageId).toBe(originalClientId);
  });
});
