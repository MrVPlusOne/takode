import { describe, expect, it, vi } from "vitest";
import type { CodexResumeSnapshot } from "../codex-adapter.js";
import type { BrowserIncomingMessage, CodexOutboundTurn, PendingCodexInput } from "../session-types.js";
import {
  hydrateCodexResumedHistory,
  reconcileCodexResumedTurn,
  type CodexRecoveryOrchestratorDeps,
  type CodexRecoveryOrchestratorSessionLike,
} from "./codex-recovery-orchestrator.js";

function sessionWithPendingInputs(pendingCodexInputs: PendingCodexInput[]): CodexRecoveryOrchestratorSessionLike {
  return {
    id: "phase-recovery-session",
    backendType: "codex",
    state: {
      backend_state: "connected",
      backend_type: "codex",
      cwd: "/tmp",
      model: "gpt-5.6-sol",
      is_compacting: false,
    },
    messageHistory: [],
    pendingMessages: [],
    pendingCodexInputs,
    pendingCodexTurns: [],
    codexFreshTurnRequiredUntilTurnId: null,
    isGenerating: false,
    cliInitReceived: true,
    consecutiveAdapterFailures: 0,
    lastAdapterFailureAt: null,
    queuedTurnStarts: 0,
    queuedTurnReasons: [],
    queuedTurnUserMessageIds: [],
    queuedTurnInterruptSources: [],
    codexAdapter: null,
  };
}

function recoveryDeps(pending?: CodexOutboundTurn): CodexRecoveryOrchestratorDeps {
  return {
    codexAssistantReplayScanLimit: 0,
    formatVsCodeSelectionPrompt: () => "",
    broadcastPendingCodexInputs: vi.fn(),
    broadcastToBrowsers: vi.fn(),
    persistSession: vi.fn(),
    touchUserMessage: vi.fn(),
    onUserMessage: vi.fn(),
    enqueueCodexTurn: vi.fn(),
    getCodexHeadTurn: vi.fn(() => null),
    getCodexTurnInRecovery: vi.fn(() => pending ?? null),
    completeCodexTurn: vi.fn((_session, turn) => {
      if (turn) turn.status = "completed";
      return true;
    }),
    completeCodexTurnsForResult: vi.fn(() => false),
    clearCodexFreshTurnRequirement: vi.fn(),
    dispatchQueuedCodexTurns: vi.fn(),
    maybeFlushQueuedCodexMessages: vi.fn(),
    pruneStalePendingCodexHerdInputs: vi.fn(() => false),
    synthesizeCodexToolResultsFromResumedTurn: vi.fn(() => ({ count: 0, omittedFromResumeSnapshotCount: 0 })),
    handleRecoveredCodexAutoPauseSuccess: vi.fn(),
    trackUserMessageForTurn: vi.fn(),
    setPendingCodexInputCancelable: vi.fn(),
    setPendingCodexInputsCancelable: vi.fn(),
    getCodexTurnAwaitingAck: vi.fn(() => null),
    armCodexFreshTurnRequirement: vi.fn(),
    flushQueuedMessagesToCodexAdapter: vi.fn(),
    emitTakodeEvent: vi.fn(),
    requestCliRelaunch: vi.fn(),
    requestCodexAutoRecovery: vi.fn(),
    setGenerating: vi.fn(),
    markTurnInterrupted: vi.fn(),
    broadcastStatusChange: vi.fn(),
    markRunningFromUserDispatch: vi.fn(() => "current" as const),
    isCodexWorkerV2DeliveryFrozen: vi.fn(() => false),
  } as unknown as CodexRecoveryOrchestratorDeps;
}

function pendingTurn(): CodexOutboundTurn {
  return {
    adapterMsg: { type: "user_message", content: "Continue" } as never,
    userMessageId: "input-1",
    pendingInputIds: ["input-1"],
    userContent: "Continue",
    historyIndex: -1,
    status: "backend_acknowledged",
    dispatchCount: 1,
    createdAt: 1,
    updatedAt: 1,
    acknowledgedAt: 1,
    turnTarget: "current",
    lastError: null,
    turnId: "turn-1",
    disconnectedAt: 2,
    resumeConfirmedAt: null,
  };
}

function snapshot(phase: "commentary" | "final_answer"): CodexResumeSnapshot {
  const turn = {
    id: "turn-1",
    status: "completed",
    error: null,
    items: [
      { type: "userMessage", content: [{ type: "text", text: "Continue" }] },
      { type: "agentMessage", id: `agent-${phase}`, text: "Recovered response", phase },
    ],
  };
  return { threadId: "thread-history", threadStatus: "idle", turnCount: 1, turns: [turn], lastTurn: turn };
}

function recoveredAssistant(messages: BrowserIncomingMessage[]) {
  return messages.find((message) => message.type === "assistant") as
    | Extract<BrowserIncomingMessage, { type: "assistant" }>
    | undefined;
}

describe("Codex recovered message phases", () => {
  it("preserves final-answer phase while hydrating an empty resumed history", () => {
    const session = sessionWithPendingInputs([]);

    expect(hydrateCodexResumedHistory(session, snapshot("final_answer"), recoveryDeps())).toBe(2);
    expect(recoveredAssistant(session.messageHistory)?.codexMessagePhase).toBe("final_answer");
  });

  it("preserves commentary phase while recovering a previously dispatched turn", () => {
    // This path reconstructs a missing assistant from official resume items;
    // legacy rows already recognized by replay dedupe remain untouched elsewhere.
    const pending = pendingTurn();
    const session = sessionWithPendingInputs([{ id: "input-1", content: "Continue", timestamp: 1, cancelable: false }]);
    session.pendingCodexTurns = [pending];
    session.isGenerating = true;

    reconcileCodexResumedTurn(session, snapshot("commentary"), recoveryDeps(pending));

    expect(recoveredAssistant(session.messageHistory)?.codexMessagePhase).toBe("commentary");
  });
});
