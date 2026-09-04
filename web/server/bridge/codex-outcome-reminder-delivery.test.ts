import { describe, expect, it, vi } from "vitest";
import type { BrowserIncomingMessage, CodexOutboundTurn, PendingCodexInput } from "../session-types.js";
import { dispatchQueuedCodexTurns, trySteerPendingCodexInputs } from "./codex-recovery-orchestrator.js";
import { refreshPendingCodexThreadOutcomeReminders } from "./codex-outcome-reminder-delivery.js";

const guard = {
  version: 1 as const,
  pendingResponseTargets: [
    {
      threadKey: "main",
      earliestTimestamp: 10,
      pendingAnswerCount: 1,
      pendingAnswerUserMessageIds: ["u1"],
    },
  ],
  missingOutcomeTargets: [],
  missingNeedsInputTargets: [],
};

function coveredHistory(): BrowserIncomingMessage[] {
  return [
    {
      type: "user_message",
      id: "direct-u1",
      content: "Question",
      timestamp: 10,
      threadKey: "main",
      leaderResponseCoverageVersion: 1,
      leaderUserMessageId: "u1",
    } as BrowserIncomingMessage,
    {
      type: "assistant",
      message: {
        id: "answer-u1",
        type: "message",
        role: "assistant",
        model: "test",
        content: [{ type: "text", text: "Answered." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      timestamp: 20,
      threadKey: "main",
      leaderThreadRole: "answer",
      threadAnswer: { version: 2, answerUserMessageIds: ["u1"], observedHistoryLength: 1 },
    } as BrowserIncomingMessage,
  ];
}

function reminderInput(): PendingCodexInput {
  return {
    id: "reminder",
    content: "old reminder",
    deliveryContent: "[System 10:00 PM] [thread:main] old reminder",
    timestamp: 15,
    cancelable: false,
    threadKey: "main",
    agentSource: { sessionId: "system:leader-thread-outcome-reminder" },
    leaderThreadOutcomeReminderGuard: structuredClone(guard),
    autoPauseSourceKind: "automatic",
  };
}

function ordinaryInput(): PendingCodexInput {
  return { id: "ordinary", content: "keep me", timestamp: 16, cancelable: false, autoPauseSourceKind: "manual" };
}

describe("Codex deferred Thread Outcome Reminder delivery", () => {
  it("prunes a stale reminder after ingress and rebuilds a mixed reconnect batch before dispatch", () => {
    const reminder = reminderInput();
    const ordinary = ordinaryInput();
    const turn: CodexOutboundTurn = {
      adapterMsg: {
        type: "codex_start_pending",
        pendingInputIds: [reminder.id, ordinary.id],
        inputs: [{ content: reminder.deliveryContent! }, { content: ordinary.content }],
        clientUserMessageId: "client-old",
      },
      userMessageId: reminder.id,
      pendingInputIds: [reminder.id, ordinary.id],
      userContent: `${reminder.deliveryContent}\n\n${ordinary.content}`,
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
    };
    const sendBrowserMessage = vi.fn(() => true);
    const session = {
      id: "leader",
      backendType: "codex",
      state: {
        backend_state: "connected",
        cwd: "/tmp",
        leaderThreadStatuses: {
          main: {
            kind: "ready",
            label: "Thread Ready",
            threadKey: "main",
            summary: "answered",
            messageId: "answer-u1",
            timestamp: 20,
            updatedAt: 20,
          },
        },
      },
      messageHistory: coveredHistory(),
      notifications: [],
      pendingMessages: [],
      pendingCodexInputs: [reminder, ordinary],
      pendingCodexTurns: [turn],
      codexFreshTurnRequiredUntilTurnId: null,
      isGenerating: false,
      cliInitReceived: true,
      consecutiveAdapterFailures: 0,
      lastAdapterFailureAt: null,
      queuedTurnStarts: 0,
      queuedTurnReasons: [],
      queuedTurnUserMessageIds: [],
      queuedTurnInterruptSources: [],
      codexAdapter: { getCurrentTurnId: () => null, isConnected: () => true, sendBrowserMessage, disconnect: vi.fn() },
    } as any;
    const deps = {
      getCodexHeadTurn: (target: any) => target.pendingCodexTurns[0] ?? null,
      isCodexWorkerV2DeliveryFrozen: () => false,
      persistSession: vi.fn(),
      broadcastPendingCodexInputs: vi.fn(),
      pruneStalePendingCodexHerdInputs: vi.fn(() => false),
      formatVsCodeSelectionPrompt: vi.fn(() => ""),
    } as any;

    dispatchQueuedCodexTurns(session, "reconnect", deps);

    expect(session.pendingCodexInputs.map((input: PendingCodexInput) => input.id)).toEqual(["ordinary"]);
    expect(sendBrowserMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "codex_start_pending",
        pendingInputIds: ["ordinary"],
        inputs: [{ content: "keep me" }],
      }),
    );
  });

  it("prunes stale reminder input immediately before an active-turn steer", () => {
    const reminder = reminderInput();
    reminder.cancelable = true;
    const ordinary = ordinaryInput();
    ordinary.cancelable = true;
    const sendBrowserMessage = vi.fn(() => true);
    const session = {
      id: "leader",
      backendType: "codex",
      state: {
        backend_state: "connected",
        cwd: "/tmp",
        leaderThreadStatuses: {
          main: { kind: "ready", threadKey: "main", timestamp: 20, updatedAt: 20 },
        },
      },
      messageHistory: coveredHistory(),
      notifications: [],
      pendingMessages: [],
      pendingCodexInputs: [reminder, ordinary],
      pendingCodexTurns: [],
      codexFreshTurnRequiredUntilTurnId: null,
      isGenerating: true,
      codexAdapter: { getCurrentTurnId: () => "turn-current", isConnected: () => true, sendBrowserMessage },
    } as any;
    const deps = {
      isCodexWorkerV2DeliveryFrozen: () => false,
      clearCodexFreshTurnRequirement: vi.fn(),
      pruneStalePendingCodexHerdInputs: vi.fn(() => false),
      broadcastPendingCodexInputs: vi.fn(),
      persistSession: vi.fn(),
    } as any;

    expect(trySteerPendingCodexInputs(session, "test", deps)).toBe(true);
    expect(session.pendingCodexInputs.map((input: PendingCodexInput) => input.id)).toEqual(["ordinary"]);
    expect(sendBrowserMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "codex_steer_pending", pendingInputIds: ["ordinary"] }),
    );
  });

  it("refreshes both visible and provider content when a bundled primary target changes", () => {
    const input = reminderInput();
    input.cancelable = true;
    input.leaderThreadOutcomeReminderGuard = {
      version: 1,
      pendingResponseTargets: [
        ...guard.pendingResponseTargets,
        { threadKey: "q-42", earliestTimestamp: 11, pendingAnswerCount: 1, pendingAnswerUserMessageIds: ["u2"] },
      ],
      missingOutcomeTargets: [],
      missingNeedsInputTargets: [],
    };
    const session = {
      id: "leader",
      state: {
        cwd: "/tmp",
        leaderThreadStatuses: {
          main: { kind: "ready", threadKey: "main", timestamp: 20, updatedAt: 20 },
        },
      },
      messageHistory: [
        ...coveredHistory(),
        {
          type: "user_message",
          id: "direct-u2",
          content: "Other question",
          timestamp: 11,
          threadKey: "q-42",
          questId: "q-42",
          threadRefs: [{ threadKey: "q-42", questId: "q-42", source: "explicit" }],
          leaderResponseCoverageVersion: 1,
          leaderUserMessageId: "u2",
        },
      ],
      notifications: [],
      pendingCodexInputs: [input],
      pendingCodexTurns: [],
      lastMessagePreviewAt: 15,
    } as any;
    const deps = { broadcastPendingCodexInputs: vi.fn(), persistSession: vi.fn() };

    expect(refreshPendingCodexThreadOutcomeReminders(session, deps).changed).toBe(true);
    expect(input.threadKey).toBe("q-42");
    expect(input.content).toContain("q-42 (u2)");
    expect(input.content).not.toContain("Main (u1)");
    expect(input.deliveryContent).toContain("[thread:q-42]");
    expect(input.deliveryContent).toContain("q-42 (u2)");
    expect(input.deliveryContent).not.toContain("old reminder");
  });
});
