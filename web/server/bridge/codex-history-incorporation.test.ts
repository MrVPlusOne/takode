import { describe, expect, it } from "vitest";
import type { CodexOutboundTurn } from "../session-types.js";
import {
  beginCodexHistoryAbsentReplay,
  chooseCodexRecoveryContinuationMode,
  createCodexHistoryIncorporation,
  inspectCodexHistoryIncorporation,
  markCodexHistoryRecorded,
} from "./codex-history-incorporation.js";

function turn(): CodexOutboundTurn {
  const historyIncorporation = createCodexHistoryIncorporation(["owner-1", "owner-2"]);
  historyIncorporation.providerTurnId = "turn-1";
  historyIncorporation.rpcAcceptedAt = 2;
  return {
    adapterMsg: {
      type: "codex_start_pending",
      pendingInputIds: ["owner-1", "owner-2"],
      inputs: [{ content: "first" }, { content: "second" }],
      clientUserMessageId: historyIncorporation.clientUserMessageId,
    },
    userMessageId: "owner-1",
    pendingInputIds: ["owner-1", "owner-2"],
    userContent: "first\n\nsecond",
    historyIndex: 1,
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

function snapshot(items: Record<string, unknown>[], itemsView: "full" | "summary" | "notLoaded" = "full") {
  const lastTurn = { id: "turn-1", status: "interrupted", error: null, items, itemsView };
  return { threadId: "thread", threadStatus: "idle", turnCount: 1, turns: [lastTurn], lastTurn };
}

describe("Codex history incorporation evidence", () => {
  it("distinguishes exact receipt presence, proven absence, and incomplete snapshots", () => {
    const pending = turn();
    expect(
      inspectCodexHistoryIncorporation(
        snapshot([
          { type: "userMessage", clientId: pending.historyIncorporation!.clientUserMessageId, content: [] },
          { type: "reasoning", summary: ["working"] },
        ]),
        pending,
      ),
    ).toMatchObject({ presence: "present", receiptItemIndex: 0, completeItems: true });
    expect(inspectCodexHistoryIncorporation(snapshot([], "full"), pending)).toMatchObject({ presence: "absent" });
    expect(inspectCodexHistoryIncorporation(snapshot([], "summary"), pending)).toMatchObject({
      presence: "unknown",
      completeItems: false,
    });
    expect(inspectCodexHistoryIncorporation(snapshot([], "notLoaded"), pending)).toMatchObject({
      presence: "unknown",
      reason: "items_notLoaded",
    });
    const missingView = snapshot([]) as any;
    delete missingView.lastTurn.itemsView;
    delete missingView.turns[0].itemsView;
    expect(inspectCodexHistoryIncorporation(missingView, pending)).toMatchObject({
      presence: "unknown",
      reason: "items_view_missing",
    });
  });

  it("treats duplicate or mismatched receipts as unknown", () => {
    const pending = turn();
    const receipt = { type: "userMessage", clientId: pending.historyIncorporation!.clientUserMessageId, content: [] };
    expect(inspectCodexHistoryIncorporation(snapshot([receipt, receipt]), pending)).toMatchObject({
      presence: "unknown",
      reason: "duplicate_receipt",
    });
    const otherTurn = {
      id: "turn-other",
      status: "interrupted",
      error: null,
      itemsView: "full" as const,
      items: [receipt],
    };
    expect(
      inspectCodexHistoryIncorporation(
        {
          threadId: "thread",
          threadStatus: "idle",
          turnCount: 1,
          turns: [otherTurn],
          lastTurn: otherTurn,
        },
        pending,
      ),
    ).toMatchObject({ presence: "unknown", reason: "receipt_turn_mismatch" });
  });

  it("never treats compaction or an active turn as absence proof", () => {
    const pending = turn();
    expect(inspectCodexHistoryIncorporation(snapshot([{ type: "contextCompaction" }]), pending)).toMatchObject({
      presence: "unknown",
      reason: "compacted_turn",
    });
    const active = snapshot([]);
    active.threadStatus = "active";
    active.lastTurn.status = "inProgress";
    expect(inspectCodexHistoryIncorporation(active, pending)).toMatchObject({
      presence: "unknown",
      reason: "turn_still_active",
    });
  });

  it("permits one exact absent replay and selects verification-first for effect-capable evidence", () => {
    const pending = turn();
    expect(beginCodexHistoryAbsentReplay(pending)).toBe(true);
    expect(beginCodexHistoryAbsentReplay(pending)).toBe(false);

    const evidence = inspectCodexHistoryIncorporation(
      snapshot([
        { type: "userMessage", client_id: pending.historyIncorporation!.clientUserMessageId, content: [] },
        { type: "functionCall", id: "call-1" },
      ]),
      pending,
    )!;
    expect(
      chooseCodexRecoveryContinuationMode({
        evidence,
        activity: { count: 1, kinds: ["tool_use"], firstHistoryIndex: null, lastHistoryIndex: null },
      }),
    ).toBe("verify_then_continue");
    expect(
      chooseCodexRecoveryContinuationMode({
        evidence: { ...evidence, activityItems: [{ type: "reasoning" }] },
        activity: { count: 1, kinds: ["reasoning"], firstHistoryIndex: null, lastHistoryIndex: null },
      }),
    ).toBe("finish_response");
  });

  it("retains live recorded proof over an incomplete resume snapshot", () => {
    const pending = turn();
    expect(markCodexHistoryRecorded(pending, "live", 12, 10)).toBe(true);
    expect(pending.historyIncorporation).toMatchObject({
      recordedAt: 10,
      recordedSource: "live",
      activityStartHistoryIndex: 12,
    });
  });
});
