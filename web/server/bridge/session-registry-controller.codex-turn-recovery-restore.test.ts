import { describe, expect, it, vi } from "vitest";
import { restorePersistedSessions } from "./session-registry-controller.js";
import { injectCompactionRecovery } from "./compaction-recovery.js";

const recovery = {
  recoveryId: "original-owner",
  originalOwnerId: "original-owner",
  originalProviderTurnId: "turn-original",
  originalHistoryIndex: 0,
  continuationOwnerId: null,
  threadKey: "q-recovery",
  questId: "q-recovery",
  status: "continuation_pending",
  reason: "interrupted_after_activity",
  attempt: 1,
  maxAttempts: 1,
  createdAt: 10,
  updatedAt: 20,
} as const;

function persisted(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-recovery",
    state: {
      backend_type: "codex",
      backend_state: "disconnected",
      backend_error: null,
      isOrchestrator: true,
      codex_turn_recovery: recovery,
    },
    messageHistory: [
      {
        type: "user_message",
        id: "original-owner",
        content: "finish the work",
        timestamp: 1,
        threadKey: "q-recovery",
        questId: "q-recovery",
      },
    ],
    pendingPermissions: [],
    pendingMessages: [],
    pendingCodexInputs: [],
    pendingCodexTurns: [],
    ...overrides,
  };
}

const deps = () => ({
  recoverToolStartTimesFromHistory: vi.fn(),
  finalizeRecoveredDisconnectedTerminalTools: vi.fn(),
  scheduleCodexToolResultWatchdogs: vi.fn(),
  reconcileRestoredBoardState: vi.fn(async () => {}),
});

describe("restored session activity", () => {
  it("repairs human activity while restoring the latest committed or pending preview owner", async () => {
    const sessions = new Map<string, any>();
    const setLastUserMessageAt = vi.fn();
    await restorePersistedSessions(
      sessions,
      [
        persisted({
          messageHistory: [
            { type: "user_message", id: "human", content: "Human", timestamp: 100 },
            {
              type: "user_message",
              id: "injected",
              content: "Timer",
              timestamp: 400,
              agentSource: { sessionId: "timer:t1" },
            },
          ],
          pendingCodexInputs: [
            { id: "pending", content: "Pending human", timestamp: 300, cancelable: true },
            {
              id: "pending-injected",
              content: "Herd event",
              timestamp: 500,
              cancelable: false,
              agentSource: { sessionId: "herd-events" },
            },
          ],
        }),
      ],
      { ...deps(), setLastUserMessageAt },
    );

    expect(setLastUserMessageAt).toHaveBeenCalledOnce();
    expect(setLastUserMessageAt).toHaveBeenCalledWith("session-recovery", 300);
    expect(sessions.get("session-recovery")).toMatchObject({
      lastUserMessage: "Herd event",
      lastMessagePreviewAt: 500,
    });
  });
});

describe("restored Codex interrupted-turn recovery", () => {
  it("repairs the durable continuation owner and active status", async () => {
    const source = "system:codex-turn-recovery:original-owner";
    const sessions = new Map<string, any>();
    await restorePersistedSessions(
      sessions,
      [
        persisted({
          messageHistory: [
            ...persisted().messageHistory,
            {
              type: "user_message",
              id: "continuation-owner",
              content: "visible continuation",
              timestamp: 2,
              agentSource: { sessionId: source, sessionLabel: "Interrupted Turn Recovery" },
              threadKey: "q-recovery",
              questId: "q-recovery",
            },
          ],
          pendingCodexInputs: [
            {
              id: "continuation-owner",
              content: "visible continuation",
              timestamp: 2,
              cancelable: false,
              agentSource: { sessionId: source, sessionLabel: "Interrupted Turn Recovery" },
              threadKey: "q-recovery",
              questId: "q-recovery",
            },
          ],
          pendingCodexTurns: [
            {
              adapterMsg: { type: "codex_start_pending", pendingInputIds: ["continuation-owner"], inputs: [] },
              userMessageId: "continuation-owner",
              pendingInputIds: ["continuation-owner"],
              userContent: "recovery",
              historyIndex: 1,
              status: "backend_acknowledged",
              dispatchCount: 1,
              createdAt: 2,
              updatedAt: 3,
              acknowledgedAt: 3,
              turnTarget: "current",
              lastError: null,
              turnId: "turn-continuation",
              disconnectedAt: 4,
              resumeConfirmedAt: null,
            },
          ],
        }),
      ],
      deps(),
    );

    expect(sessions.get("session-recovery").state.codex_turn_recovery).toMatchObject({
      continuationOwnerId: "continuation-owner",
      status: "continuation_active",
    });
    expect(sessions.get("session-recovery").attentionReason).toBeNull();
  });

  it("preserves exact recycle-transfer ownership across restart and injection", async () => {
    const sessions = new Map<string, any>();
    await restorePersistedSessions(
      sessions,
      [
        persisted({
          codexLeaderRecycleContinuation: {
            trigger: "manual_compact",
            requestedAt: 30,
            content: "inspect retained work before continuing",
            recoveryId: "original-owner",
            threadKey: "q-recovery",
            questId: "q-recovery",
          },
        }),
      ],
      deps(),
    );
    const restored = sessions.get("session-recovery");
    expect(restored.state.codex_turn_recovery).toMatchObject({
      status: "continuation_pending",
      recoveryId: "original-owner",
    });
    expect(restored.codexLeaderRecycleContinuation).toMatchObject({ recoveryId: "original-owner" });

    const injectUserMessage = vi.fn();
    injectCompactionRecovery(restored, {
      isLeaderSession: () => true,
      isSystemSourceTag: (source) => source?.sessionId?.startsWith("system:") === true,
      injectUserMessage,
    });
    expect(injectUserMessage).toHaveBeenCalledWith(
      restored.id,
      "inspect retained work before continuing",
      {
        sessionId: "system:codex-turn-recovery:original-owner",
        sessionLabel: "Resuming Interrupted Work",
      },
      { threadKey: "q-recovery", questId: "q-recovery" },
      expect.objectContaining({ deliveryContent: expect.stringContaining("inspect retained work") }),
    );
  });

  it("retires stale action-required state from persisted same-thread success and persists the metadata repair", async () => {
    const sessions = new Map<string, any>();
    const persistHistoryMetadataRepair = vi.fn(async () => {});
    await restorePersistedSessions(
      sessions,
      [
        persisted({
          _frozenCount: 2,
          state: {
            backend_type: "codex",
            backend_state: "disconnected",
            backend_error: null,
            isOrchestrator: true,
            codex_turn_recovery: {
              ...recovery,
              threadKey: "main",
              questId: undefined,
              status: "action_required",
              reason: "continuation_dispatch_failed",
              updatedAt: 20,
            },
          },
          messageHistory: [
            {
              type: "user_message",
              id: "original-owner",
              content: "finish the work",
              timestamp: 1,
              threadKey: "main",
            },
            {
              type: "user_message",
              id: "recovery-diagnostic",
              content: "Review the interrupted work.",
              timestamp: 30,
              agentSource: { sessionId: "system:codex-leader-recovery-diagnostic" },
              threadKey: "main",
            },
            {
              type: "user_message",
              id: "fresh-follow-up",
              content: "The connection is back; finish anything still missing.",
              timestamp: 40,
              threadKey: "main",
            },
            {
              type: "result",
              data: {
                type: "result",
                subtype: "success",
                is_error: false,
                duration_ms: 1,
                duration_api_ms: 1,
                num_turns: 1,
                total_cost_usd: 0,
                stop_reason: "completed",
                usage: {
                  input_tokens: 0,
                  output_tokens: 0,
                  cache_creation_input_tokens: 0,
                  cache_read_input_tokens: 0,
                },
                uuid: "fresh-follow-up-result",
                session_id: "session-recovery",
              },
            },
          ],
        }),
      ],
      { ...deps(), persistHistoryMetadataRepair },
    );

    const restored = sessions.get("session-recovery");
    expect(restored.state.codex_turn_recovery).toBeNull();
    expect(restored.messageHistory[1]).toMatchObject({
      id: "recovery-diagnostic",
      codexTurnRecoveryId: "original-owner",
      codexTurnRecoveryResolvedAt: expect.any(Number),
    });
    expect(persistHistoryMetadataRepair).toHaveBeenCalledWith(restored, 2);
  });

  it("fails an ownerless crash window closed and raises navigation attention", async () => {
    const sessions = new Map<string, any>();
    await restorePersistedSessions(sessions, [persisted()], deps());

    expect(sessions.get("session-recovery").state.codex_turn_recovery).toMatchObject({
      status: "action_required",
      reason: "continuation_dispatch_failed",
    });
    expect(sessions.get("session-recovery").attentionReason).toBe("error");
  });

  it("does not fabricate executable recovery for archived search-only sessions", async () => {
    const sessions = new Map<string, any>();
    await restorePersistedSessions(sessions, [persisted({ _searchDataOnly: true })], deps());

    expect(sessions.get("session-recovery").state.codex_turn_recovery).toMatchObject({
      status: "continuation_pending",
      attempt: 1,
    });
    expect(sessions.get("session-recovery").searchDataOnly).toBe(true);
  });
});
