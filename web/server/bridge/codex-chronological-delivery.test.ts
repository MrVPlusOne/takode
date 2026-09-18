import { describe, expect, it, vi } from "vitest";
import type { CodexOutboundTurn, PendingCodexInput } from "../session-types.js";
import { createCodexHistoryIncorporation } from "./codex-history-incorporation.js";
import { rebuildQueuedCodexPendingStartBatch, trySteerPendingCodexInputs } from "./codex-recovery-orchestrator.js";
import { selectCodexSteeringInputs, pruneSupersededCompactionInputs } from "./codex-pending-start-batch.js";
import {
  recordCodexHistoryIncorporationReceipt,
  recordCodexHistoryReceiptObservation,
  recordSteeredCodexTurn,
} from "./codex-pending-input-history.js";
import { completeCodexTurnsForResult } from "./codex-turn-queue.js";

function input(id: string, source?: string): PendingCodexInput {
  return { id, content: id, timestamp: 1, cancelable: true, ...(source ? { agentSource: { sessionId: source } } : {}) };
}

describe("chronological Codex delivery", () => {
  it("supersedes only provably unsent recovery context, preserving humans and accepted owners", () => {
    const recovery = input("old-recovery", "system:compaction-recovery");
    const accepted = input("accepted-recovery", "system:compaction-recovery");
    const human = input("human");
    const session: any = {
      messageHistory: [{ type: "compact_marker", id: "new-boundary", timestamp: 2 }],
      pendingCodexInputs: [recovery, accepted, human],
      pendingCodexTurns: [{ userMessageId: accepted.id, status: "backend_acknowledged", dispatchCount: 1 }],
    };
    expect(pruneSupersededCompactionInputs(session)).toBe(true);
    expect(session.pendingCodexInputs).toEqual([accepted, human]);
    session.codexAdapter = { hasNativeCompactionRecovery: () => true };
    session.pendingCodexInputs.push({ ...recovery, id: "unsent-current-boundary", timestamp: 3 });
    expect(pruneSupersededCompactionInputs(session)).toBe(true);
    expect(session.pendingCodexInputs).toEqual([accepted, human]);
  });
  it("allows the human-triggered prefix, preserving older events and holding newer background input", () => {
    const earlier = input("earlier", "herd-events"),
      human = input("human"),
      later = input("later", "herd-events");
    expect(selectCodexSteeringInputs([earlier])).toEqual([]);
    expect(selectCodexSteeringInputs([earlier, human, later])).toEqual([earlier, human]);
    // A second human trigger includes observations between the two humans.
    const second = input("second");
    expect(selectCodexSteeringInputs([earlier, human, later, second])).toEqual([earlier, human, later, second]);
  });

  it("retires a queued-start snapshot when its input transfers to steering, including receipt before ACK", () => {
    // Reproduces the incident's duplicate-owner shape through real queue helpers.
    const earlier = input("earlier", "herd-events"),
      human = input("human"),
      later = input("later", "herd-events");
    const ownerHistory = createCodexHistoryIncorporation(["active"]);
    ownerHistory.providerTurnId = "active-turn";
    ownerHistory.recordedAt = 1;
    const owner = {
      adapterMsg: { type: "codex_start_pending", pendingInputIds: ["active"], inputs: [{ content: "active" }] },
      userMessageId: "active",
      pendingInputIds: ["active"],
      turnId: "active-turn",
      status: "backend_acknowledged",
      dispatchCount: 1,
      turnTarget: "current",
      historyIncorporation: ownerHistory,
    } as CodexOutboundTurn;
    const sent: any[] = [];
    const session: any = {
      id: "test",
      backendType: "codex",
      state: { backend_state: "connected", cwd: "/tmp" },
      isGenerating: true,
      messageHistory: [],
      notifications: [],
      pendingCodexInputs: [earlier, human, later],
      pendingCodexTurns: [owner],
      codexAdapter: {
        getCurrentTurnId: () => "active-turn",
        isConnected: () => true,
        onUserMessageRecorded: () => {},
        sendBrowserMessage: (message: any) => {
          sent.push(message);
          return true;
        },
      },
    };
    const deps: any = {
      getCodexHeadTurn: (s: any) => s.pendingCodexTurns[0] ?? null,
      persistSession: vi.fn(),
      isCodexWorkerV2DeliveryFrozen: () => false,
      pruneStalePendingCodexHerdInputs: () => false,
      formatVsCodeSelectionPrompt: () => "",
      broadcastPendingCodexInputs: vi.fn(),
      broadcastToBrowsers: vi.fn(),
      trackUserMessageForTurn: vi.fn(),
      touchUserMessage: vi.fn(),
    };
    rebuildQueuedCodexPendingStartBatch(session, deps);
    expect(session.pendingCodexTurns[1].pendingInputIds).toEqual(["earlier", "human", "later"]);
    expect(trySteerPendingCodexInputs(session, "human", deps)).toBe(true);
    expect(sent[0].pendingInputIds).toEqual(["earlier", "human"]);
    expect(
      session.pendingCodexTurns
        .filter((turn: CodexOutboundTurn) => turn.status === "queued")
        .map((turn: CodexOutboundTurn) => turn.pendingInputIds),
    ).toEqual([["later"]]);
    recordCodexHistoryReceiptObservation(
      session,
      { turnId: "active-turn", clientUserMessageId: sent[0].clientUserMessageId },
      deps,
    );
    recordSteeredCodexTurn(session, "active-turn", [earlier, human], sent[0].clientUserMessageId, deps);
    recordCodexHistoryIncorporationReceipt(
      session,
      { turnId: "active-turn", clientUserMessageId: sent[0].clientUserMessageId },
      deps,
    );
    completeCodexTurnsForResult(session, { codex_turn_id: "active-turn" } as any);
    expect(session.pendingCodexTurns).toHaveLength(1);
    expect(session.pendingCodexTurns[0].pendingInputIds).toEqual(["later"]);
    expect(session.pendingCodexInputs.map((item: PendingCodexInput) => item.id)).toEqual(["later"]);
    expect(
      session.messageHistory.filter((item: any) => item.type === "user_message").map((item: any) => item.id),
    ).toEqual(["earlier", "human"]);
  });
});
