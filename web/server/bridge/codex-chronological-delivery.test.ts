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

function timerInput(id: string, scheduledFireAt: number): PendingCodexInput {
  return {
    ...input(id, "timer:t1"),
    content: "[⏰ Timer t1 reminder] Check progress",
    timerFiring: { timerId: "t1", scheduledFireAt },
  };
}

describe("chronological Codex delivery", () => {
  it("lets distinct timer firings trigger the chronological prefix without accelerating later background work", () => {
    // Timer identity comes from the producer, not repeated reminder text. Each
    // occurrence remains its own input even when both have identical contents.
    const earlier = input("earlier", "herd-events");
    const first = timerInput("first-firing", 1);
    const between = input("between", "herd-events");
    const second = timerInput("second-firing", 2);
    const later = input("later", "system:reminder");
    expect(selectCodexSteeringInputs([earlier, first, between, second, later])).toEqual([
      earlier,
      first,
      between,
      second,
    ]);
    expect(selectCodexSteeringInputs([first])).toEqual([first]);
    expect(selectCodexSteeringInputs([earlier, later])).toEqual([]);
  });

  it("does not promote cancellations, forged sources, invalid firing provenance or failed inputs", () => {
    // Cancellation shares timer:tN but is not a new time-sensitive firing.
    const cancelled = { ...timerInput("cancelled", 1), content: "[⏰ Timer t1 cancelled] Check progress" };
    const unproven = { ...timerInput("unproven", 1), timerFiring: undefined };
    const mismatched = { ...timerInput("mismatched", 1), agentSource: { sessionId: "timer:t2" } };
    const invalid = timerInput("invalid", Number.NaN);
    const failed = { ...timerInput("failed", 1), deliveryState: "failed" as const };
    expect(selectCodexSteeringInputs([cancelled, unproven, mismatched, invalid, failed])).toEqual([]);
    expect(selectCodexSteeringInputs([{ ...timerInput("accepted", 1), cancelable: false }])).toEqual([]);
  });
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

  it.each([
    "human",
    "timer",
  ])("retires a queued-start snapshot after %s steering, including receipt before ACK", (trigger) => {
    // Reproduces the incident's duplicate-owner shape through real queue helpers.
    const earlier = input("earlier", "herd-events"),
      human = trigger === "timer" ? timerInput("human", 1) : input("human"),
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

  it.each([
    "paused",
    "interrupted",
    "fresh-turn",
    "recovery-preload",
    "disconnected",
    "frozen",
  ])("keeps timer input queued behind the %s safety boundary", (boundary) => {
    // Eligibility is not permission to interrupt work or bypass an existing
    // recovery/pause barrier. Preserve the exact pending input for later drain.
    const timer = timerInput("firing", 1);
    const send = vi.fn(() => true);
    const session: any = {
      id: "timer-safety",
      state: { backend_state: "connected" },
      pendingCodexInputs: [timer],
      pendingCodexTurns: [],
      codexAdapter: { getCurrentTurnId: () => "active", isConnected: () => true, sendBrowserMessage: send },
    };
    if (boundary === "paused") session.state.pause = { pausedAt: 1, queuedMessages: [] };
    if (boundary === "interrupted") session.interruptedDuringTurn = true;
    if (boundary === "fresh-turn") session.codexFreshTurnRequiredUntilTurnId = "active";
    if (boundary === "recovery-preload")
      session.state.codex_turn_recovery = { status: "continuation_pending", continuationOwnerId: null };
    if (boundary === "disconnected") session.state.backend_state = "disconnected";

    expect(
      trySteerPendingCodexInputs(session, "timer", {
        isCodexWorkerV2DeliveryFrozen: () => boundary === "frozen",
      } as any),
    ).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(session.pendingCodexInputs).toEqual([timer]);
    expect(timer.cancelable).toBe(true);
  });
});
