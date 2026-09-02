import { describe, expect, it } from "vitest";
import { createCodexHistoryIncorporation } from "./codex-history-incorporation.js";
import { normalizePersistedCodexTurn } from "./session-registry-controller.js";

function persistedTurn() {
  const historyIncorporation = createCodexHistoryIncorporation(["owner-a", "owner-b"]);
  historyIncorporation.providerTurnId = "turn-1";
  historyIncorporation.rpcAcceptedAt = 2;
  return {
    adapterMsg: {
      type: "codex_start_pending",
      pendingInputIds: ["owner-a", "owner-b"],
      inputs: [{ content: "a" }, { content: "b" }],
      clientUserMessageId: historyIncorporation.clientUserMessageId,
    },
    userMessageId: "owner-a",
    pendingInputIds: ["owner-a", "owner-b"],
    userContent: "a\n\nb",
    historyIndex: -1,
    status: "backend_acknowledged",
    dispatchCount: 1,
    createdAt: 1,
    updatedAt: 2,
    acknowledgedAt: 2,
    turnTarget: "current",
    lastError: null,
    turnId: "turn-1",
    disconnectedAt: 3,
    resumeConfirmedAt: null,
    historyIncorporation,
  };
}

describe("persisted Codex history tracking", () => {
  it("round-trips valid ordered history-incorporation state", () => {
    const turn = persistedTurn();
    const normalized = normalizePersistedCodexTurn(turn, 10);

    expect(normalized.historyIncorporation).toEqual(turn.historyIncorporation);
    expect(normalized.historyTrackingUnknown).toBeUndefined();
  });

  it("keeps restored accepted or recorded tracking out of the dispatch queue", () => {
    const accepted = persistedTurn();
    accepted.status = "queued";
    const recorded = structuredClone(accepted);
    recorded.historyIncorporation.recordedAt = 3;
    recorded.historyIncorporation.recordedSource = "live";
    recorded.historyIncorporation.historyIndexes = [0, 1];

    expect(normalizePersistedCodexTurn(accepted, 10)).toMatchObject({
      status: "backend_acknowledged",
      turnId: "turn-1",
      acknowledgedAt: 2,
      historyTrackingUnknown: undefined,
    });
    expect(normalizePersistedCodexTurn(recorded, 10)).toMatchObject({
      status: "backend_acknowledged",
      historyIncorporation: { recordedAt: 3, recordedSource: "live" },
      historyTrackingUnknown: undefined,
    });
  });

  it("preserves only explicit clean provider retries and proven-absent replays as queued", () => {
    const providerRetry = persistedTurn();
    providerRetry.status = "queued";
    (providerRetry as any).turnId = null;
    (providerRetry as any).acknowledgedAt = null;
    providerRetry.historyIncorporation.providerTurnId = null;
    providerRetry.historyIncorporation.rpcAcceptedAt = null;
    (providerRetry as any).providerRecoveryFamily = "model_backend_stream_error";
    (providerRetry as any).providerRecoveryAttempts = 1;

    const absentReplay = structuredClone(providerRetry);
    delete (absentReplay as any).providerRecoveryFamily;
    delete (absentReplay as any).providerRecoveryAttempts;
    absentReplay.historyIncorporation.attempt = 1;
    absentReplay.historyIncorporation.clientUserMessageId = `${absentReplay.historyIncorporation.batchId}:1`;
    absentReplay.adapterMsg.clientUserMessageId = absentReplay.historyIncorporation.clientUserMessageId;

    expect(normalizePersistedCodexTurn(providerRetry, 10)).toMatchObject({ status: "queued" });
    expect(normalizePersistedCodexTurn(absentReplay, 10)).toMatchObject({
      status: "queued",
      historyIncorporation: { attempt: 1 },
    });

    providerRetry.dispatchCount = 2;
    absentReplay.dispatchCount = 2;
    expect(normalizePersistedCodexTurn(providerRetry, 10)).toMatchObject({ status: "backend_acknowledged" });
    expect(normalizePersistedCodexTurn(absentReplay, 10)).toMatchObject({ status: "backend_acknowledged" });
  });

  it.each([
    ["reordered membership", (turn: any) => (turn.pendingInputIds = ["owner-b", "owner-a"])],
    ["mismatched adapter client id", (turn: any) => (turn.adapterMsg.clientUserMessageId = "other:0")],
    ["mismatched provider turn id", (turn: any) => (turn.historyIncorporation.providerTurnId = "turn-other")],
    ["duplicate input membership", (turn: any) => (turn.historyIncorporation.inputIds = ["owner-a", "owner-a"])],
    [
      "malformed replay attempt",
      (turn: any) => {
        turn.historyIncorporation.attempt = 2;
        turn.historyIncorporation.clientUserMessageId = `${turn.historyIncorporation.batchId}:2`;
        turn.adapterMsg.clientUserMessageId = turn.historyIncorporation.clientUserMessageId;
      },
    ],
  ])("fails %s closed instead of restoring replayable tracking", (_label, mutate) => {
    const turn = persistedTurn();
    mutate(turn);

    const normalized = normalizePersistedCodexTurn(turn, 10);

    expect(normalized).toMatchObject({
      status: "backend_acknowledged",
      historyIncorporation: undefined,
      historyTrackingUnknown: true,
      terminalHistoryReconciliation: undefined,
    });
  });

  it("marks submitted legacy turns unknown while leaving never-submitted queued work deliverable", () => {
    const submitted = persistedTurn();
    delete (submitted as any).historyIncorporation;
    delete (submitted.adapterMsg as any).clientUserMessageId;
    const queued = {
      ...structuredClone(submitted),
      status: "queued",
      dispatchCount: 0,
      turnId: null,
      acknowledgedAt: null,
    };

    expect(normalizePersistedCodexTurn(submitted, 10)).toMatchObject({
      status: "backend_acknowledged",
      historyTrackingUnknown: true,
      terminalHistoryReconciliation: undefined,
    });
    expect(normalizePersistedCodexTurn(queued, 10)).toMatchObject({
      status: "queued",
      historyTrackingUnknown: undefined,
      terminalHistoryReconciliation: undefined,
    });
  });

  it("repairs malformed persisted terminal plans to verification-first recovery", () => {
    const turn = persistedTurn();
    turn.status = "recovery_pending";
    (turn as any).terminalHistoryReconciliation = { action: "replay", presence: "present" };

    expect(normalizePersistedCodexTurn(turn, 10)).toMatchObject({
      status: "recovery_pending",
      terminalHistoryReconciliation: {
        presence: "unknown",
        reason: "invalid_restored_terminal_reconciliation",
        action: "continue",
        continuationMode: "verify_then_continue",
        classifiedAt: 10,
      },
    });
  });
});
