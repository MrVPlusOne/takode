import { afterEach, describe, expect, it, vi } from "vitest";
import {
  addPendingCodexInput,
  clearStaleCodexCompactionState,
  commitPendingCodexInputs,
  dispatchQueuedCodexTurns,
  handleCodexAdapterInitError,
  hydrateCodexResumedHistory,
  markCodexIntentionalRelaunch,
  pokeStaleCodexPendingDelivery,
  reconcileCodexResumedTurn,
  registerCodexAdapterRecoveryLifecycle,
  type CodexRecoveryOrchestratorSessionLike,
  type CodexRecoveryOrchestratorDeps,
} from "./codex-recovery-orchestrator.js";
import type { PendingCodexInput, BrowserIncomingMessage, CodexOutboundTurn } from "../session-types.js";
import { injectReplyContext } from "../../shared/reply-context.js";
import type { CodexResumeSnapshot } from "../codex-adapter.js";

function makeSession(pendingInputs: PendingCodexInput[]): CodexRecoveryOrchestratorSessionLike {
  return {
    id: "test-session",
    backendType: "codex",
    state: { backend_state: "connected", backend_type: "codex", cwd: "/tmp", model: "gpt-5.4", is_compacting: false },
    messageHistory: [] as BrowserIncomingMessage[],
    pendingMessages: [],
    pendingCodexInputs: pendingInputs,
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

function makeDeps(): CodexRecoveryOrchestratorDeps {
  return {
    codexAssistantReplayScanLimit: 0,
    formatVsCodeSelectionPrompt: () => "",
    broadcastPendingCodexInputs: vi.fn(),
    broadcastToBrowsers: vi.fn(),
    persistSession: vi.fn(),
    refreshBrowserConversationViews: vi.fn(),
    touchUserMessage: vi.fn(),
    onUserMessage: vi.fn(),
    enqueueCodexTurn: vi.fn(),
    getCodexHeadTurn: vi.fn(() => null),
    getCodexTurnInRecovery: vi.fn(() => null),
    completeCodexTurn: vi.fn(() => false),
    completeCodexTurnsForResult: vi.fn(() => false),
    clearCodexFreshTurnRequirement: vi.fn(),
    dispatchQueuedCodexTurns: vi.fn(),
    maybeFlushQueuedCodexMessages: vi.fn(),
    pruneStalePendingCodexHerdInputs: vi.fn(() => false),
    synthesizeCodexToolResultsFromResumedTurn: vi.fn(() => ({
      count: 0,
      omittedFromResumeSnapshotCount: 0,
    })),
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
    injectUserMessage: vi.fn(() => "sent" as const),
  } as unknown as CodexRecoveryOrchestratorDeps;
}

function makeRecoveryDeps(overrides: Record<string, unknown> = {}) {
  return {
    ...makeDeps(),
    clearCodexDisconnectGraceTimer: vi.fn(),
    setBackendState: vi.fn((session: any, state: string, error: string | null) => {
      session.state.backend_state = state;
      session.state.backend_error = error;
    }),
    getCodexTurnInRecovery: vi.fn((session: any) => session.pendingCodexTurns[0] ?? null),
    getLauncherSessionInfo: vi.fn(() => ({ cliSessionId: "thread-existing" })),
    rebuildQueuedCodexPendingStartBatch: vi.fn(),
    setAttentionError: vi.fn(),
    setGenerating: vi.fn(),
    hasCliRelaunchCallback: true,
    adapterFailureResetWindowMs: 120_000,
    maxAdapterRelaunchFailures: 5,
    ...overrides,
  } as any;
}

function makeLifecycleDeps(overrides: Record<string, unknown> = {}) {
  return {
    ...makeRecoveryDeps(),
    setCliSessionIdFromMeta: vi.fn(),
    beforeSessionMetaDispatch: vi.fn(() => true),
    completeCodexLeaderRecycle: vi.fn(),
    hydrateCodexResumedHistory: vi.fn(),
    injectCompactionRecovery: vi.fn(),
    finalizeCodexRollback: vi.fn(),
    getCancelablePendingCodexInputs: vi.fn((session: any) => session.pendingCodexInputs),
    getPendingCodexInputsByIds: vi.fn(() => []),
    queueCodexPendingStartBatch: vi.fn(),
    recordSteeredCodexTurn: vi.fn(),
    scheduleCodexToolResultWatchdogs: vi.fn(),
    logCodexProcessSnapshot: vi.fn(),
    markTurnInterrupted: vi.fn(),
    isCurrentSession: vi.fn(() => true),
    refreshGitInfoThenRecomputeDiff: vi.fn(),
    ...overrides,
  } as any;
}

function prepareLifecycleSession(session: CodexRecoveryOrchestratorSessionLike): void {
  (session as any).pendingPermissions = new Map();
  (session as any).pendingQuestCommands = new Map();
  (session as any).browserSockets = new Set();
  (session as any).intentionalCodexRelaunchUntil = null;
  (session as any).intentionalCodexRelaunchReason = null;
}

function makeLifecycleAdapter(disconnectDiagnostics: Record<string, unknown> | null = null) {
  let currentTurnId: string | null = null;
  const callbacks = {
    sessionMeta: null as ((meta: any) => void) | null,
    turnStarted: null as ((turnId: string, source?: "local" | "codex_goal_continuation") => void) | null,
    turnSteered: null as ((turnId: string, pendingInputIds: string[]) => void) | null,
    turnSteerFailed: null as ((pendingInputIds: string[]) => void) | null,
    initError: null as ((error: string) => void) | null,
    disconnect: null as (() => void) | null,
    turnStartFailed: null as ((msg: any) => void) | null,
  };
  return {
    onSessionMeta: vi.fn((callback: (meta: any) => void) => {
      callbacks.sessionMeta = callback;
    }),
    onTurnStarted: vi.fn((callback: (turnId: string, source?: "local" | "codex_goal_continuation") => void) => {
      callbacks.turnStarted = callback;
    }),
    onTurnSteered: vi.fn((callback: (turnId: string, pendingInputIds: string[]) => void) => {
      callbacks.turnSteered = callback;
    }),
    onTurnSteerFailed: vi.fn((callback: (pendingInputIds: string[]) => void) => {
      callbacks.turnSteerFailed = callback;
    }),
    onInitError: vi.fn((callback: (error: string) => void) => {
      callbacks.initError = callback;
    }),
    onDisconnect: vi.fn((callback: () => void) => {
      callbacks.disconnect = callback;
    }),
    onTurnStartFailed: vi.fn((callback: (msg: any) => void) => {
      callbacks.turnStartFailed = callback;
    }),
    getCurrentTurnId: vi.fn<() => string | null>(() => currentTurnId),
    getLastDisconnectDiagnostics: vi.fn(() => disconnectDiagnostics),
    isConnected: vi.fn(() => true),
    sendBrowserMessage: vi.fn(() => true),
    disconnect: vi.fn(async () => {}),
    rollbackTurns: vi.fn(async () => {}),
    emitDisconnect: () => callbacks.disconnect?.(),
    emitSessionMeta: (meta: any) => callbacks.sessionMeta?.(meta),
    emitTurnStarted: (turnId: string, source?: "local" | "codex_goal_continuation") => {
      currentTurnId = turnId;
      callbacks.turnStarted?.(turnId, source);
    },
    emitTurnSteerFailed: (pendingInputIds: string[]) => callbacks.turnSteerFailed?.(pendingInputIds),
  };
}

function makePendingTurn(): CodexOutboundTurn {
  return {
    adapterMsg: { type: "user_message", content: "continue" } as any,
    userMessageId: "user-1",
    pendingInputIds: ["input-1"],
    userContent: "continue",
    historyIndex: -1,
    status: "dispatched",
    dispatchCount: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    acknowledgedAt: null,
    turnTarget: null,
    lastError: null,
    turnId: null,
    disconnectedAt: null,
    resumeConfirmedAt: null,
  };
}

function activateAutoPause(session: CodexRecoveryOrchestratorSessionLike): void {
  session.state.codex_result_error_auto_pause = {
    family: "copilot_auth_refresh_exhausted",
    fingerprint: "copilot_auth_refresh_exhausted:github_copilot",
    streak: 1,
    threshold: 1,
    pausedAt: 900,
    lastError: "GitHub Copilot API-key refresh exhausted its retry budget.",
    lastErrorAt: 900,
    lastSourceKind: "automatic",
    totalMatchingErrors: 1,
    heldInputs: [],
  };
}

describe("clearStaleCodexCompactionState", () => {
  it("does not inject compaction recovery after a failed Codex compaction turn", () => {
    const session = makeSession([]);
    session.state.is_compacting = true;
    session.messageHistory.push({
      type: "compact_marker",
      id: "compact-boundary-1",
      timestamp: 1,
    });
    session.codexAdapter = {
      isConnected: () => true,
      getCurrentTurnId: () => null,
    } as any;
    const deps = makeLifecycleDeps();

    const cleared = clearStaleCodexCompactionState(session, "codex_turn_completed_stale_compaction", deps);

    expect(cleared).toBe(true);
    expect(session.state.is_compacting).toBe(false);
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(session, { type: "status_change", status: null });
    expect(deps.injectCompactionRecovery).not.toHaveBeenCalled();
    expect(deps.persistSession).toHaveBeenCalledWith(session);
  });

  it("keeps injecting compaction recovery when clearing stale non-error compaction state", () => {
    const session = makeSession([]);
    session.state.is_compacting = true;
    session.messageHistory.push({
      type: "compact_marker",
      id: "compact-boundary-1",
      timestamp: 1,
    });
    session.codexAdapter = {
      isConnected: () => true,
      getCurrentTurnId: () => null,
    } as any;
    const deps = makeLifecycleDeps();

    const cleared = clearStaleCodexCompactionState(session, "session_meta_stale_compaction", deps);

    expect(cleared).toBe(true);
    expect(deps.injectCompactionRecovery).toHaveBeenCalledWith(session);
  });
});

describe("commitPendingCodexInputs", () => {
  it("touches lastUserMessageAt with the pending timestamp for direct human input", () => {
    // Direct Codex inputs can sit in the pending queue before they are sent.
    // The sidebar timestamp should still reflect when the human submitted it.
    const input: PendingCodexInput = {
      id: "user-msg-human",
      content: "Human request",
      timestamp: 12345,
      cancelable: false,
    };
    const session = makeSession([input]);
    const deps = makeDeps();

    commitPendingCodexInputs(session, ["user-msg-human"], deps);

    expect(deps.touchUserMessage).toHaveBeenCalledWith("test-session", 12345);
  });

  it("does not touch lastUserMessageAt when committing agentSource pending input", () => {
    // Agent/herd/timer inputs are user-shaped for adapter transport, but they
    // must not reorder the session sidebar as human activity.
    const input: PendingCodexInput = {
      id: "user-msg-agent",
      content: "Herd event summary",
      timestamp: 12345,
      cancelable: false,
      agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
    };
    const session = makeSession([input]);
    const deps = makeDeps();

    commitPendingCodexInputs(session, ["user-msg-agent"], deps);

    expect(deps.touchUserMessage).not.toHaveBeenCalled();
  });

  it("includes client_msg_id in the broadcast when pending input has clientMsgId", () => {
    // This test verifies the fix for q-578: ghost pending-upload messages.
    // When a Codex pending input carries a clientMsgId (set during the
    // browser's pending-upload flow), commitPendingCodexInput must include
    // client_msg_id in the user_message broadcast so the browser can call
    // consumePendingUserUpload and clear the "PENDING UPLOAD" ghost.
    const input: PendingCodexInput = {
      id: "user-msg-1",
      clientMsgId: "pending-upload-abc123",
      content: "Tell me what you see",
      timestamp: Date.now(),
      cancelable: false,
    };
    const session = makeSession([input]);
    const deps = makeDeps();

    const indexes = commitPendingCodexInputs(session, ["user-msg-1"], deps);

    expect(indexes).toEqual([0]);
    expect(deps.broadcastToBrowsers).toHaveBeenCalledTimes(1);
    const broadcastedMsg = (deps.broadcastToBrowsers as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(broadcastedMsg.type).toBe("user_message");
    expect(broadcastedMsg.client_msg_id).toBe("pending-upload-abc123");
  });

  it("omits client_msg_id when pending input has no clientMsgId", () => {
    // Non-image messages (e.g. plain text from agent sources) don't set
    // clientMsgId, so the broadcast should not include client_msg_id.
    const input: PendingCodexInput = {
      id: "user-msg-2",
      content: "Hello",
      timestamp: Date.now(),
      cancelable: false,
    };
    const session = makeSession([input]);
    const deps = makeDeps();

    commitPendingCodexInputs(session, ["user-msg-2"], deps);

    const broadcastedMsg = (deps.broadcastToBrowsers as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(broadcastedMsg.type).toBe("user_message");
    expect(broadcastedMsg.client_msg_id).toBeUndefined();
  });

  it("commits programmatic history follow-ups after the model-bound pending input", () => {
    const input: PendingCodexInput = {
      id: "leader-kickoff",
      content: "Leader kickoff",
      deliveryContent: "Leader kickoff\n\nRequired leader skill preloaded: quest\nquest skill body",
      timestamp: 12345,
      cancelable: false,
      agentSource: { sessionId: "system:leader-kickoff", sessionLabel: "Leader Kickoff" },
      historyFollowUps: [
        {
          content: "Required leader skill preloaded: quest\nquest skill body",
          agentSource: { sessionId: "system:leader-skill-preload:quest", sessionLabel: "Required quest" },
          threadKey: "main",
        },
      ],
    };
    const session = makeSession([input]);
    const deps = makeDeps();

    const indexes = commitPendingCodexInputs(session, ["leader-kickoff"], deps);

    expect(indexes).toEqual([0]);
    expect(session.messageHistory).toHaveLength(2);
    expect(session.messageHistory[0]).toMatchObject({
      type: "user_message",
      id: "leader-kickoff",
      content: "Leader kickoff",
      agentSource: { sessionId: "system:leader-kickoff" },
    });
    expect(session.messageHistory[1]).toMatchObject({
      type: "user_message",
      id: "leader-kickoff-followup-0",
      content: expect.stringContaining("Required leader skill preloaded: quest"),
      agentSource: { sessionId: "system:leader-skill-preload:quest" },
      threadKey: "main",
    });
    expect(deps.broadcastToBrowsers).toHaveBeenCalledTimes(2);
    expect(deps.touchUserMessage).not.toHaveBeenCalled();
  });
});

describe("addPendingCodexInput", () => {
  it("touches lastUserMessageAt for direct human pending input", () => {
    const deps = makeDeps();
    const session = makeSession([]);

    addPendingCodexInput(
      session,
      {
        id: "pending-human",
        content: "Human request",
        timestamp: 23456,
        cancelable: true,
      },
      deps,
    );

    expect(deps.touchUserMessage).toHaveBeenCalledWith("test-session", 23456);
  });

  it("does not touch lastUserMessageAt for agentSource pending input", () => {
    const deps = makeDeps();
    const session = makeSession([]);

    addPendingCodexInput(
      session,
      {
        id: "pending-agent",
        content: "Leader instruction",
        timestamp: 23456,
        cancelable: true,
        agentSource: { sessionId: "leader-1", sessionLabel: "#1 Leader" },
      },
      deps,
    );

    expect(deps.touchUserMessage).not.toHaveBeenCalled();
  });
});

describe("pokeStaleCodexPendingDelivery", () => {
  function makeStalePendingDeliverySession() {
    const session = makeSession([
      { id: "head-input", content: "stale head", timestamp: 1_000, cancelable: true },
      { id: "new-input", content: "new herd event", timestamp: 2_000, cancelable: true },
    ]);
    session.codexAdapter = {
      getCurrentTurnId: vi.fn(() => null),
      isConnected: vi.fn(() => true),
      sendBrowserMessage: vi.fn(() => true),
    } as any;
    const head = makePendingTurn();
    head.adapterMsg = {
      type: "codex_start_pending",
      pendingInputIds: ["head-input"],
      inputs: [{ content: "stale head" }],
    } as any;
    head.userMessageId = "head-input";
    head.pendingInputIds = ["head-input"];
    head.status = "backend_acknowledged";
    head.turnTarget = "current";
    head.turnId = "turn-stale";
    head.acknowledgedAt = 1_500;
    session.pendingCodexTurns = [head];
    const deps = makeDeps();
    deps.getCodexHeadTurn = vi.fn(
      (target: CodexRecoveryOrchestratorSessionLike) => target.pendingCodexTurns[0] ?? null,
    );
    return { session, deps, head };
  }

  it("retries a stale backend-acknowledged head when a different input is queued behind it", () => {
    // This is the approved faster-recovery envelope: a connected, idle Codex
    // session with no active turn id and a new pending input behind a stale
    // backend-acknowledged codex_start_pending head.
    const { session, deps, head } = makeStalePendingDeliverySession();

    const poked = pokeStaleCodexPendingDelivery(session, "herd_event_message", deps, {
      triggeringInputId: "new-input",
    });

    expect(poked).toBe(true);
    expect(head.status).toBe("queued");
    expect(head.turnId).toBeNull();
    expect(deps.dispatchQueuedCodexTurns).toHaveBeenCalledWith(session, "codex_retry_pending_turn");
    expect(deps.dispatchQueuedCodexTurns).toHaveBeenCalledWith(session, "herd_event_message");
  });

  it("does not poke or dispatch while the worker V2 cutover gate is frozen", () => {
    const { session, deps } = makeStalePendingDeliverySession();
    deps.isCodexWorkerV2DeliveryFrozen = vi.fn(() => true);

    const poked = pokeStaleCodexPendingDelivery(session, "worker_v2_cutover", deps, {
      triggeringInputId: "new-input",
    });

    expect(poked).toBe(false);
    expect(deps.dispatchQueuedCodexTurns).not.toHaveBeenCalled();
  });

  it("refuses unsafe stale pending delivery poke states", () => {
    const cases: Array<{
      name: string;
      mutate: (session: CodexRecoveryOrchestratorSessionLike, head: CodexOutboundTurn) => void;
      triggeringInputId?: string;
    }> = [
      {
        name: "session is still generating",
        mutate: (session) => {
          session.isGenerating = true;
        },
      },
      {
        name: "adapter reports an active turn id",
        mutate: (session) => {
          session.codexAdapter!.getCurrentTurnId = vi.fn(() => "turn-active");
        },
      },
      {
        name: "triggering input is already part of the stale head",
        mutate: () => undefined,
        triggeringInputId: "head-input",
      },
      {
        name: "adapter is disconnected",
        mutate: (session) => {
          session.codexAdapter!.isConnected = vi.fn(() => false);
        },
      },
      {
        name: "backend is disconnected",
        mutate: (session) => {
          session.state.backend_state = "disconnected";
        },
      },
      {
        name: "backend is broken",
        mutate: (session) => {
          session.state.backend_state = "broken";
        },
      },
      {
        name: "backend recovery is suppressed",
        mutate: (session) => {
          session.state.backend_state = "recovery_suppressed";
        },
      },
      {
        name: "backend is already recovering",
        mutate: (session) => {
          session.state.backend_state = "recovering";
        },
      },
      {
        name: "head is not a codex_start_pending turn",
        mutate: (_session, head) => {
          head.adapterMsg = { type: "user_message", content: "stale head" } as any;
        },
      },
    ];

    for (const testCase of cases) {
      const { session, deps, head } = makeStalePendingDeliverySession();
      testCase.mutate(session, head);

      const poked = pokeStaleCodexPendingDelivery(session, "herd_event_message", deps, {
        triggeringInputId: testCase.triggeringInputId ?? "new-input",
      });

      expect(poked, testCase.name).toBe(false);
      expect(deps.dispatchQueuedCodexTurns, testCase.name).not.toHaveBeenCalled();
    }
  });
});

describe("hydrateCodexResumedHistory", () => {
  it("sanitizes legacy reply markers before storing the session preview", () => {
    // Codex external resume can hydrate historical user text that predates
    // explicit replyContext metadata. The session preview must stay user-facing
    // and never expose the raw legacy marker payload.
    const legacyReply = injectReplyContext("Original answer", "Continue the work", "codex-agent-random-id");
    const session = makeSession([]);
    const deps = makeDeps();

    const snapshot: CodexResumeSnapshot = {
      threadId: "thread-history",
      turnCount: 1,
      turns: [
        {
          id: "turn-1",
          status: "completed",
          error: null,
          items: [{ type: "userMessage", content: [{ type: "text", text: legacyReply }] }],
        },
      ],
      lastTurn: null,
    };

    const hydrated = hydrateCodexResumedHistory(session, snapshot, deps);

    expect(hydrated).toBe(1);
    expect(session.messageHistory[0]).toMatchObject({ type: "user_message", content: legacyReply });
    expect(session.lastUserMessage).toBe("[reply] Continue the work");
    expect(session.lastUserMessage).not.toContain("<<<REPLY_TO");
    expect(session.lastUserMessage).not.toContain("codex-agent-random-id");
  });

  it("routes and strips leader thread prefixes when hydrating recovered assistant messages", () => {
    // External Codex resume can replay assistant text with the leader thread
    // marker still embedded. Store the same routed shape as live assistant
    // messages so Main and quest projections agree after reconnect.
    const session = makeSession([]);
    session.state.isOrchestrator = true;
    const deps = makeDeps();

    const hydrated = hydrateCodexResumedHistory(
      session,
      {
        threadId: "thread-history",
        turnCount: 1,
        turns: [
          {
            id: "turn-1",
            status: "completed",
            error: null,
            items: [{ type: "agentMessage", id: "agent-1", text: "[thread:q-1119:C] Created quest notes" }],
          },
        ],
        lastTurn: null,
      },
      deps,
    );

    expect(hydrated).toBe(1);
    expect(session.messageHistory[0]).toMatchObject({
      type: "assistant",
      threadKey: "q-1119",
      questId: "q-1119",
      threadRefs: [expect.objectContaining({ threadKey: "q-1119", questId: "q-1119", source: "explicit" })],
    });
    const assistant = session.messageHistory[0] as Extract<BrowserIncomingMessage, { type: "assistant" }>;
    expect(assistant.message.content).toEqual([{ type: "text", text: "Created quest notes" }]);
  });

  it("splits mid-message leader thread routes when hydrating recovered assistant messages", () => {
    const session = makeSession([]);
    session.state.isOrchestrator = true;
    const deps = makeDeps();

    const hydrated = hydrateCodexResumedHistory(
      session,
      {
        threadId: "thread-history",
        turnCount: 1,
        turns: [
          {
            id: "turn-1",
            status: "completed",
            error: null,
            items: [
              {
                type: "agentMessage",
                id: "agent-1",
                text: [
                  "[thread:q-1695:C]",
                  "Approved Option A is recorded.",
                  "---",
                  "[thread:q-1693:C]No separator still routes after recovery.",
                ].join("\n"),
              },
            ],
          },
        ],
        lastTurn: null,
      },
      deps,
    );

    expect(hydrated).toBe(2);
    expect(session.messageHistory[0]).toMatchObject({ type: "assistant", threadKey: "q-1695", questId: "q-1695" });
    expect(session.messageHistory[1]).toMatchObject({ type: "assistant", threadKey: "q-1693", questId: "q-1693" });
    const first = session.messageHistory[0] as Extract<BrowserIncomingMessage, { type: "assistant" }>;
    const second = session.messageHistory[1] as Extract<BrowserIncomingMessage, { type: "assistant" }>;
    expect(first.message.id).toBe("codex-agent-agent-1");
    expect(second.message.id).toBe("codex-agent-agent-1:route-1");
    expect(first.message.content).toEqual([{ type: "text", text: "Approved Option A is recorded." }]);
    expect(second.message.content).toEqual([{ type: "text", text: "No separator still routes after recovery." }]);
  });

  it("splits post-quiz recovered assistant routes when markdown spacing leaves a blank line after the divider", () => {
    const session = makeSession([]);
    session.state.isOrchestrator = true;
    const deps = makeDeps();

    // Recovery/replay must not reintroduce the q-1718/q-1721 leak: recovered
    // Codex assistant text with post-quiz markdown spacing is split before it
    // becomes durable browser history.
    const hydrated = hydrateCodexResumedHistory(
      session,
      {
        threadId: "thread-history",
        turnCount: 1,
        turns: [
          {
            id: "turn-1",
            status: "completed",
            error: null,
            items: [
              {
                type: "agentMessage",
                id: "agent-1",
                text: [
                  "[thread:q-1718:C]",
                  "[q-1718](quest:q-1718) is complete.",
                  "",
                  "{[(Quest Quiz: q-1718)]}",
                  "",
                  "---",
                  "",
                  "[thread:q-1721:C] [q-1721](quest:q-1721) is now dispatched.",
                ].join("\n"),
              },
            ],
          },
        ],
        lastTurn: null,
      },
      deps,
    );

    expect(hydrated).toBe(2);
    expect(session.messageHistory[0]).toMatchObject({ type: "assistant", threadKey: "q-1718", questId: "q-1718" });
    expect(session.messageHistory[1]).toMatchObject({ type: "assistant", threadKey: "q-1721", questId: "q-1721" });
    const first = session.messageHistory[0] as Extract<BrowserIncomingMessage, { type: "assistant" }>;
    const second = session.messageHistory[1] as Extract<BrowserIncomingMessage, { type: "assistant" }>;
    expect(first.message.content).toEqual([
      { type: "text", text: "[q-1718](quest:q-1718) is complete.\n\n{[(Quest Quiz: q-1718)]}" },
    ]);
    expect(second.message.content).toEqual([{ type: "text", text: "[q-1721](quest:q-1721) is now dispatched." }]);
    expect(JSON.stringify(session.messageHistory)).not.toContain("[thread:q-1721:C]");
    expect(JSON.stringify(session.messageHistory)).not.toContain("\n---\n");
  });
});

describe("reconcileCodexResumedTurn", () => {
  it("retries an interrupted resume with only user input without waiting for user-message timeout", () => {
    const request = "continue the implementation";
    const session = makeSession([{ id: "input-1", content: request, timestamp: 1_000, cancelable: false }]);
    session.isGenerating = true;
    const pending = makePendingTurn();
    pending.userContent = request;
    pending.status = "backend_acknowledged";
    pending.turnTarget = "current";
    pending.turnId = "turn-user-only";
    pending.acknowledgedAt = 1_500;
    pending.disconnectedAt = 2_000;
    session.pendingCodexTurns = [pending];
    const deps = makeRecoveryDeps({
      dispatchQueuedCodexTurns: vi.fn((session: CodexRecoveryOrchestratorSessionLike) => {
        const head = session.pendingCodexTurns[0];
        if (head) head.status = "dispatched";
      }),
      setGenerating: vi.fn((session: CodexRecoveryOrchestratorSessionLike, generating: boolean) => {
        session.isGenerating = generating;
      }),
    });

    reconcileCodexResumedTurn(
      session,
      {
        threadId: "thread-history",
        turnCount: 1,
        threadStatus: "idle",
        turns: [],
        lastTurn: {
          id: "turn-user-only",
          status: "interrupted",
          error: null,
          items: [{ type: "userMessage", content: [{ type: "text", text: request }] }],
        },
      } as CodexResumeSnapshot,
      deps,
    );

    expect(deps.setGenerating).toHaveBeenCalledWith(session, false, "codex_retry_pending_turn_restart");
    expect(deps.dispatchQueuedCodexTurns).toHaveBeenCalledWith(session, "codex_retry_pending_turn");
    expect(deps.markRunningFromUserDispatch).toHaveBeenCalledWith(session, "codex_retry_pending_turn");
    expect(pending.status).toBe("dispatched");
    expect(pending.turnTarget).toBe("current");
    expect(pending.turnId).toBeNull();
  });

  it("retries a user-only resume when history contains only the matching transient provider result", () => {
    const request = "continue the implementation";
    const session = makeSession([]);
    session.isGenerating = true;
    session.messageHistory = [
      { type: "user_message", id: "user-1", content: request, timestamp: 1_000 },
      {
        type: "result",
        data: {
          type: "result",
          subtype: "error_during_execution",
          is_error: true,
          result: "stream disconnected before completion",
          duration_ms: 0,
          duration_api_ms: 0,
          num_turns: 0,
          total_cost_usd: 0,
          stop_reason: "failed",
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          uuid: "retry-result",
          session_id: "test-session",
          codex_provider_retry: {
            family: "model_backend_stream_error",
            ownerId: "user-1",
            attempt: 1,
            maxAttempts: 2,
            startedAt: 1_500,
          },
        },
      },
    ];
    const pending = makePendingTurn();
    pending.userMessageId = "user-1";
    pending.pendingInputIds = ["user-1"];
    pending.userContent = request;
    pending.historyIndex = 0;
    pending.status = "backend_acknowledged";
    pending.turnTarget = "current";
    pending.turnId = "turn-user-only";
    session.pendingCodexTurns = [pending];
    const deps = makeRecoveryDeps({
      dispatchQueuedCodexTurns: vi.fn((targetSession: CodexRecoveryOrchestratorSessionLike) => {
        const head = targetSession.pendingCodexTurns[0];
        if (head) head.status = "dispatched";
      }),
      setGenerating: vi.fn((targetSession: CodexRecoveryOrchestratorSessionLike, generating: boolean) => {
        targetSession.isGenerating = generating;
      }),
    });

    reconcileCodexResumedTurn(
      session,
      {
        threadId: "thread-history",
        turnCount: 1,
        threadStatus: "idle",
        turns: [],
        lastTurn: {
          id: "turn-user-only",
          status: "interrupted",
          error: null,
          items: [{ type: "userMessage", content: [{ type: "text", text: request }] }],
        },
      } as CodexResumeSnapshot,
      deps,
    );

    expect(deps.dispatchQueuedCodexTurns).toHaveBeenCalledWith(session, "codex_retry_pending_turn");
    expect(pending.status).toBe("dispatched");
    expect(pending.turnId).toBeNull();
  });

  it("surfaces a visible diagnostic when a safe user-only retry cannot dispatch", () => {
    const request = "continue the implementation";
    const session = makeSession([{ id: "input-1", content: request, timestamp: 1_000, cancelable: false }]);
    session.isGenerating = true;
    const pending = makePendingTurn();
    pending.userContent = request;
    pending.status = "backend_acknowledged";
    pending.turnTarget = "current";
    pending.turnId = "turn-user-only";
    session.pendingCodexTurns = [pending];
    const deps = makeRecoveryDeps({
      dispatchQueuedCodexTurns: vi.fn(),
      setGenerating: vi.fn((session: CodexRecoveryOrchestratorSessionLike, generating: boolean) => {
        session.isGenerating = generating;
      }),
    });

    reconcileCodexResumedTurn(
      session,
      {
        threadId: "thread-history",
        turnCount: 1,
        threadStatus: "idle",
        turns: [],
        lastTurn: {
          id: "turn-user-only",
          status: "interrupted",
          error: null,
          items: [{ type: "userMessage", content: [{ type: "text", text: request }] }],
        },
      } as CodexResumeSnapshot,
      deps,
    );

    expect(pending.status).toBe("queued");
    expect(pending.lastError).toContain("automatic retry was not dispatched");
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: "error",
        message: expect.stringContaining("adapter not connected"),
      }),
    );
  });

  it("dedupes routed recovered assistant replay against an already stored stripped leader row", () => {
    // This matches the observed replay shape: the original Main assistant row
    // is already stored without the leader marker, then Codex resume replays
    // the same text as an item-* agentMessage with [thread:main:C] still attached.
    const session = makeSession([
      {
        id: "input-1",
        content: "continue",
        timestamp: 1_000,
        cancelable: false,
      },
    ]);
    session.state.isOrchestrator = true;
    session.isGenerating = true;
    session.messageHistory.push(
      {
        type: "user_message",
        id: "user-1",
        content: "continue",
        timestamp: 800,
        threadKey: "main",
      },
      {
        type: "assistant",
        message: {
          id: "original-main",
          type: "message",
          role: "assistant",
          model: "gpt-5.4",
          content: [{ type: "text", text: "Approved with the Mental Simulation." }],
          stop_reason: null,
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        timestamp: 900,
        threadKey: "main",
      },
    );
    session.pendingCodexInputs = [];
    const pending = makePendingTurn();
    pending.historyIndex = 0;
    pending.disconnectedAt = 2_000;
    session.pendingCodexTurns = [pending];
    const deps = makeRecoveryDeps({
      completeCodexTurn: vi.fn((session: CodexRecoveryOrchestratorSessionLike, turn: CodexOutboundTurn | null) => {
        if (turn) turn.status = "completed";
        session.pendingCodexTurns = [];
        return true;
      }),
    });
    deps.codexAssistantReplayScanLimit = 10;

    reconcileCodexResumedTurn(
      session,
      {
        threadId: "thread-history",
        turnCount: 1,
        threadStatus: "idle",
        turns: [],
        lastTurn: {
          id: "turn-1",
          status: "completed",
          error: null,
          items: [
            { type: "userMessage", content: [{ type: "text", text: "continue" }] },
            { type: "agentMessage", id: "item-1", text: "[thread:main:C] Approved with the Mental Simulation." },
          ],
        },
      } as CodexResumeSnapshot,
      deps,
    );

    const assistantRows = session.messageHistory.filter((message) => message.type === "assistant");
    expect(assistantRows).toHaveLength(1);
    expect(deps.setGenerating).toHaveBeenCalledWith(session, false, "codex_resume_recovered_messages");
    expect(deps.broadcastToBrowsers).not.toHaveBeenCalledWith(session, expect.objectContaining({ type: "assistant" }));
  });

  it("queues a separate leader continuation when resumed assistant text is followed by tool output", () => {
    // This matches the lost /confirm shape: a partial assistant sentence was
    // already visible, a later tool finished, and resume had no final answer.
    const request = "confirm the navigation work";
    const partial = "[thread:main:C] I'm using the confirm workflow because your request includes /confirm.";
    const session = makeSession([
      {
        id: "input-1",
        content: request,
        timestamp: 1_000,
        cancelable: false,
      },
    ]);
    session.state.isOrchestrator = true;
    session.isGenerating = true;
    session.messageHistory.push({
      type: "assistant",
      message: {
        id: "live-partial",
        type: "message",
        role: "assistant",
        model: "gpt-5.4",
        content: [{ type: "text", text: "I'm using the confirm workflow because your request includes /confirm." }],
        stop_reason: null,
        usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      timestamp: 900,
      threadKey: "main",
    });
    const pending = makePendingTurn();
    pending.userContent = request;
    pending.turnId = "turn-confirm";
    pending.disconnectedAt = 2_000;
    session.pendingCodexTurns = [pending];
    const deps = makeRecoveryDeps({
      completeCodexTurn: vi.fn((session: CodexRecoveryOrchestratorSessionLike, turn: CodexOutboundTurn | null) => {
        if (turn) turn.status = "completed";
        session.pendingCodexTurns = [];
        return true;
      }),
    });
    deps.codexAssistantReplayScanLimit = 10;

    reconcileCodexResumedTurn(
      session,
      {
        threadId: "thread-history",
        turnCount: 1,
        threadStatus: "idle",
        turns: [],
        lastTurn: {
          id: "turn-confirm",
          status: "completed",
          error: null,
          items: [
            { type: "userMessage", content: [{ type: "text", text: request }] },
            { type: "functionCall", id: "call-image", status: "completed", name: "view_image" },
            { type: "agentMessage", id: "item-1", text: partial },
            { type: "commandExecution", id: "cmd-sed", status: "completed", aggregatedOutput: "Confirm skill" },
          ],
        },
      } as CodexResumeSnapshot,
      deps,
    );

    expect(deps.setGenerating).toHaveBeenCalledWith(session, false, "codex_interrupted_turn_continuation");
    expect(deps.injectUserMessage).toHaveBeenCalledWith(
      session.id,
      expect.stringContaining("separate follow-up"),
      expect.objectContaining({ sessionId: expect.stringMatching(/^system:codex-turn-recovery:/) }),
      { threadKey: "main" },
      expect.objectContaining({ deliveryContent: expect.stringContaining("verification-first continuation") }),
    );
    expect(session.state.codex_turn_recovery).toMatchObject({
      status: "continuation_pending",
      originalProviderTurnId: "turn-confirm",
      threadKey: "main",
    });
    expect(deps.broadcastToBrowsers).not.toHaveBeenCalledWith(session, expect.objectContaining({ type: "error" }));
  });

  it("continues separately when an interrupted idle resume already contains assistant text", () => {
    // Exact-once delivery: partial assistant output proves the user payload reached
    // the model, so recovery must not inject the same payload as a fresh turn.
    const request = "prepare cartoon portrait icon variants from my reference images";
    const partial = "[thread:main:C] I read all three references and will frame this as a separate quest.";
    const session = makeSession([{ id: "input-1", content: request, timestamp: 1_000, cancelable: false }]);
    session.state.isOrchestrator = true;
    session.isGenerating = true;
    const pending = makePendingTurn();
    pending.userContent = request;
    pending.turnId = "turn-interrupted";
    pending.disconnectedAt = 2_000;
    session.pendingCodexTurns = [pending];
    const deps = makeRecoveryDeps({
      completeCodexTurn: vi.fn((targetSession, turn) => {
        if (turn) turn.status = "completed";
        targetSession.pendingCodexTurns = [];
        return true;
      }),
    });

    reconcileCodexResumedTurn(
      session,
      {
        threadId: "thread-history",
        turnCount: 1,
        threadStatus: "idle",
        turns: [],
        lastTurn: {
          id: "turn-interrupted",
          status: "interrupted",
          error: null,
          items: [
            { type: "userMessage", content: [{ type: "text", text: request }] },
            { type: "agentMessage", id: "item-1", text: partial },
          ],
        },
      } as CodexResumeSnapshot,
      deps,
    );

    expect(deps.dispatchQueuedCodexTurns).not.toHaveBeenCalledWith(session, "codex_retry_pending_turn");
    expect(deps.setGenerating).toHaveBeenCalledWith(session, false, "codex_interrupted_turn_continuation");
    expect(deps.injectUserMessage).toHaveBeenCalledTimes(1);
    expect(session.state.codex_turn_recovery).toMatchObject({
      originalOwnerId: "user-1",
      status: "continuation_pending",
      attempt: 1,
    });
  });

  it("preserves the routed leader thread on automatic continuation", () => {
    const request = "prepare cartoon portrait icon variants from my reference images";
    const partial = "[thread:main:C] I read all three references and will frame this as a separate quest.";
    const session = makeSession([
      {
        id: "input-1",
        content: request,
        timestamp: 1_000,
        cancelable: false,
      },
    ]);
    session.state.isOrchestrator = true;
    session.isGenerating = true;
    const pending = makePendingTurn();
    pending.userContent = request;
    pending.turnId = "turn-interrupted";
    pending.disconnectedAt = 2_000;
    session.pendingCodexTurns = [pending];
    const deps = makeRecoveryDeps({
      completeCodexTurn: vi.fn((session: CodexRecoveryOrchestratorSessionLike, turn: CodexOutboundTurn | null) => {
        if (turn) turn.status = "completed";
        session.pendingCodexTurns = [];
        return true;
      }),
    });

    reconcileCodexResumedTurn(
      session,
      {
        threadId: "thread-history",
        turnCount: 1,
        threadStatus: "idle",
        turns: [],
        lastTurn: {
          id: "turn-interrupted",
          status: "interrupted",
          error: null,
          items: [
            { type: "userMessage", content: [{ type: "text", text: request }] },
            { type: "agentMessage", id: "item-1", text: partial },
          ],
        },
      } as CodexResumeSnapshot,
      deps,
    );

    expect(deps.setGenerating).toHaveBeenCalledWith(session, false, "codex_interrupted_turn_continuation");
    expect(deps.injectUserMessage).toHaveBeenCalledWith(
      session.id,
      expect.stringContaining("separate follow-up"),
      expect.objectContaining({ sessionId: expect.stringMatching(/^system:codex-turn-recovery:/) }),
      { threadKey: "main" },
      expect.objectContaining({ deliveryContent: expect.stringContaining("takode peek") }),
    );
    expect(session.state.codex_turn_recovery).toMatchObject({ threadKey: "main", status: "continuation_pending" });
  });

  it("does not persist the leader diagnostic for non-orchestrator replay suppression", () => {
    const request = "continue the work";
    const partial = "Recovered partial worker text.";
    const session = makeSession([{ id: "input-1", content: request, timestamp: 1_000, cancelable: false }]);
    session.isGenerating = true;
    const pending = makePendingTurn();
    pending.userContent = request;
    pending.turnId = "turn-interrupted";
    pending.disconnectedAt = 2_000;
    session.pendingCodexTurns = [pending];
    const deps = makeRecoveryDeps({
      completeCodexTurn: vi.fn(
        (targetSession: CodexRecoveryOrchestratorSessionLike, turn: CodexOutboundTurn | null) => {
          if (turn) turn.status = "completed";
          targetSession.pendingCodexTurns = [];
          return true;
        },
      ),
    });

    reconcileCodexResumedTurn(
      session,
      {
        threadId: "thread-history",
        turnCount: 1,
        threadStatus: "idle",
        turns: [],
        lastTurn: {
          id: "turn-interrupted",
          status: "interrupted",
          error: null,
          items: [
            { type: "userMessage", content: [{ type: "text", text: request }] },
            { type: "agentMessage", id: "item-1", text: partial },
          ],
        },
      } as CodexResumeSnapshot,
      deps,
    );

    expect(session.messageHistory).not.toContainEqual(
      expect.objectContaining({
        type: "user_message",
        agentSource: expect.objectContaining({ sessionId: "system:codex-leader-recovery-diagnostic" }),
      }),
    );
    expect(deps.broadcastToBrowsers).not.toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: "user_message",
        agentSource: expect.objectContaining({ sessionId: "system:codex-leader-recovery-diagnostic" }),
      }),
    );
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: "error",
        message: expect.stringContaining("no final response was recovered"),
      }),
    );
  });

  it("suppresses a user-only resume retry when frozen hot-tail history proves local tool activity", () => {
    const request = "continue the work";
    const session = makeSession([]);
    session._frozenCount = 53;
    session.messageHistory = [
      { type: "user_message", id: "user-live", content: request, timestamp: 1_000, threadKey: "q-test" },
      {
        type: "assistant",
        message: {
          id: "tool-call",
          type: "message",
          role: "assistant",
          model: "gpt-test",
          content: [{ type: "tool_use", id: "call-1", name: "Bash", input: { command: "echo sanitized" } }],
          stop_reason: null,
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        timestamp: 1_100,
      },
      { type: "tool_result_preview", previews: [] },
    ];
    session.isGenerating = true;
    const pending = makePendingTurn();
    pending.userMessageId = "user-live";
    pending.pendingInputIds = ["user-live"];
    pending.userContent = request;
    pending.historyIndex = 53;
    pending.status = "backend_acknowledged";
    pending.turnTarget = "current";
    pending.turnId = "turn-live";
    session.pendingCodexTurns = [pending];
    const deps = makeRecoveryDeps({
      completeCodexTurn: vi.fn((targetSession, turn) => {
        if (turn) turn.status = "completed";
        targetSession.pendingCodexTurns = [];
        return true;
      }),
    });

    reconcileCodexResumedTurn(
      session,
      {
        threadId: "thread-live",
        turnCount: 1,
        threadStatus: "idle",
        turns: [],
        lastTurn: {
          id: "turn-live",
          status: "interrupted",
          error: null,
          items: [{ type: "userMessage", content: [{ type: "text", text: request }] }],
        },
      } as CodexResumeSnapshot,
      deps,
    );

    expect(deps.dispatchQueuedCodexTurns).not.toHaveBeenCalledWith(session, "codex_retry_pending_turn");
    expect(session.codexPendingDeliveryProofSignals?.at(-1)?.classification).toContain(
      "retry_suppressed_model_activity",
    );
    expect(session.codexPendingDeliveryProofSignals?.at(-1)?.classification).toContain("owner=user-live");
    expect(session.codexPendingDeliveryProofSignals?.at(-1)?.classification).toContain("route=q-test");
  });

  it("suppresses delayed replay of a committed herd/user bundle without duplicating needs-input history", () => {
    const contents = ["herd one", "resolution notice", "urgent report", "herd two", "latest instruction"];
    const session = makeSession([]);
    session._frozenCount = 700;
    session.messageHistory = contents.map((content, index) => ({
      type: "user_message" as const,
      id: `bundle-${index + 1}`,
      content,
      timestamp: 1_000 + index,
      ...(index === 1
        ? { agentSource: { sessionId: "system:needs-input-resolution", sessionLabel: "Needs Input Resolution" } }
        : { agentSource: { sessionId: "herd-events", sessionLabel: "Herd" } }),
      threadKey: "q-sanitized",
      questId: "q-sanitized",
    }));
    session.messageHistory.push(
      {
        type: "assistant",
        message: {
          id: "bundle-tool",
          type: "message",
          role: "assistant",
          model: "gpt-test",
          content: [{ type: "tool_use", id: "call-bundle", name: "Bash", input: { command: "echo sanitized" } }],
          stop_reason: null,
          usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        },
        parent_tool_use_id: null,
        timestamp: 1_100,
      },
      { type: "tool_result_preview", previews: [] },
    );
    session.pendingCodexInputs = [];
    session.isGenerating = true;
    const pending = makePendingTurn();
    pending.userMessageId = "bundle-1";
    pending.pendingInputIds = contents.map((_, index) => `bundle-${index + 1}`);
    pending.userContent = contents.join("\n\n");
    pending.adapterMsg = {
      type: "codex_start_pending",
      pendingInputIds: pending.pendingInputIds,
      inputs: contents.map((content) => ({ content })),
    };
    pending.historyIndex = 700;
    pending.status = "backend_acknowledged";
    pending.turnTarget = "current";
    pending.turnId = "turn-bundle";
    session.pendingCodexTurns = [pending];
    const deps = makeRecoveryDeps({
      completeCodexTurn: vi.fn((targetSession, turn) => {
        if (turn) turn.status = "completed";
        targetSession.pendingCodexTurns = [];
        return true;
      }),
    });
    const snapshot = {
      threadId: "thread-bundle",
      turnCount: 1,
      threadStatus: "idle",
      turns: [],
      lastTurn: {
        id: "turn-bundle",
        status: "interrupted",
        error: null,
        items: [{ type: "userMessage", content: [{ type: "text", text: pending.userContent }] }],
      },
    } as CodexResumeSnapshot;

    reconcileCodexResumedTurn(session, snapshot, deps);
    reconcileCodexResumedTurn(session, snapshot, deps);

    expect(deps.dispatchQueuedCodexTurns).not.toHaveBeenCalledWith(session, "codex_retry_pending_turn");
    expect(session.messageHistory.filter((message) => message.type === "user_message")).toHaveLength(5);
    expect(
      session.messageHistory.filter(
        (message) =>
          message.type === "user_message" && message.agentSource?.sessionId === "system:needs-input-resolution",
      ),
    ).toHaveLength(1);
    expect(session.codexPendingDeliveryProofSignals?.at(-1)?.classification).toContain("count=2");
    expect(session.codexPendingDeliveryProofSignals?.at(-1)?.classification).toContain("route=q-sanitized");
  });

  it("keeps safe-complete recovery when final assistant text follows resumed tool output", () => {
    const request = "run a command and summarize it";
    const session = makeSession([
      {
        id: "input-1",
        content: request,
        timestamp: 1_000,
        cancelable: false,
      },
    ]);
    session.isGenerating = true;
    const pending = makePendingTurn();
    pending.userContent = request;
    pending.turnId = "turn-final";
    pending.turnTarget = "current";
    pending.autoPauseSourceKind = "manual";
    pending.autoPauseRecoveryTestingRetired = false;
    pending.disconnectedAt = 2_000;
    session.pendingCodexTurns = [pending];
    session.state.codex_result_error_auto_pause = {
      family: "copilot_auth_refresh_exhausted",
      fingerprint: "copilot_auth_refresh_exhausted:github_copilot",
      streak: 1,
      threshold: 1,
      pausedAt: 1_500,
      lastError: "GitHub Copilot API-key refresh exhausted its retry budget.",
      lastErrorAt: 1_500,
      lastSourceKind: "automatic",
      totalMatchingErrors: 1,
      heldInputs: [],
    };
    const deps = makeRecoveryDeps({
      completeCodexTurn: vi.fn((session: CodexRecoveryOrchestratorSessionLike, turn: CodexOutboundTurn | null) => {
        if (turn) turn.status = "completed";
        session.pendingCodexTurns = [];
        return true;
      }),
    });

    reconcileCodexResumedTurn(
      session,
      {
        threadId: "thread-history",
        turnCount: 1,
        threadStatus: "idle",
        turns: [],
        lastTurn: {
          id: "turn-final",
          status: "completed",
          error: null,
          items: [
            { type: "userMessage", content: [{ type: "text", text: request }] },
            { type: "commandExecution", id: "cmd-1", status: "completed", aggregatedOutput: "ok" },
            { type: "agentMessage", id: "item-final", text: "The command completed successfully." },
          ],
        },
      } as CodexResumeSnapshot,
      deps,
    );

    expect(deps.handleRecoveredCodexAutoPauseSuccess).toHaveBeenCalledWith(session, pending);
    expect(deps.setGenerating).toHaveBeenCalledWith(session, false, "codex_resume_recovered_messages");
    expect(deps.broadcastToBrowsers).not.toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: "error",
        message: expect.stringContaining("no final response was recovered"),
      }),
    );
  });
});

describe("accepted auto-pause recovery dispatch presentation", () => {
  it("preserves current manual ownership and rebroadcasts testing on accepted retry", () => {
    const session = makeSession([]);
    activateAutoPause(session);
    const pending = makePendingTurn();
    pending.status = "queued";
    pending.turnTarget = "current";
    pending.autoPauseSourceKind = "manual";
    session.pendingCodexTurns = [pending];
    const adapter = makeLifecycleAdapter();
    session.codexAdapter = adapter as any;
    const deps = makeLifecycleDeps();

    dispatchQueuedCodexTurns(session, "manual_recovery_retry", deps);

    expect(pending).toMatchObject({ status: "dispatched", turnTarget: "current" });
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(session, {
      type: "session_update",
      session: {
        codex_result_error_auto_pause_recovery_progress: "testing",
      },
    });
  });

  it("clears current manual ownership when the adapter rejects the retry dispatch", () => {
    const session = makeSession([]);
    activateAutoPause(session);
    const pending = makePendingTurn();
    pending.status = "queued";
    pending.turnTarget = "current";
    pending.autoPauseSourceKind = "manual";
    session.pendingCodexTurns = [pending];
    const adapter = makeLifecycleAdapter();
    adapter.sendBrowserMessage = vi.fn(() => false);
    session.codexAdapter = adapter as any;
    const deps = makeLifecycleDeps();

    dispatchQueuedCodexTurns(session, "manual_recovery_retry", deps);

    expect(pending).toMatchObject({ status: "queued", turnTarget: null });
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(session, {
      type: "session_update",
      session: {
        codex_result_error_auto_pause_recovery_progress: null,
      },
    });
  });
});

describe("registerCodexAdapterRecoveryLifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not mutate or dispatch queued recovery state before the cutover session_meta barrier resolves", async () => {
    const session = makeSession([]);
    prepareLifecycleSession(session);
    session.state.backend_state = "recovering";
    const adapter = makeLifecycleAdapter();
    let releaseBarrier!: (allow: boolean) => void;
    const barrier = new Promise<boolean>((resolve) => {
      releaseBarrier = resolve;
    });
    const deps = makeLifecycleDeps({ beforeSessionMetaDispatch: vi.fn(() => barrier) });

    session.codexAdapter = adapter as any;
    registerCodexAdapterRecoveryLifecycle(session.id, session, adapter, deps);
    adapter.emitSessionMeta({ cliSessionId: "thread-v2-replacement" });
    await Promise.resolve();

    expect(deps.dispatchQueuedCodexTurns).not.toHaveBeenCalled();
    expect(deps.queueCodexPendingStartBatch).not.toHaveBeenCalled();
    expect(deps.setCliSessionIdFromMeta).not.toHaveBeenCalled();
    expect(session.state.backend_state).toBe("recovering");

    releaseBarrier(true);
    await vi.waitFor(() => expect(deps.dispatchQueuedCodexTurns).toHaveBeenCalledWith(session, "session_meta"));
    expect(deps.setCliSessionIdFromMeta).toHaveBeenCalledWith(session.id, "thread-v2-replacement");
  });

  it("clears reconnect progress for every browser after session metadata confirms recovery", async () => {
    const session = makeSession([]);
    prepareLifecycleSession(session);
    session.state.backend_state = "recovering";
    session.state.backend_reconnect = { attempt: 3, maxAttempts: 5, cycleStartedAt: 100 };
    const adapter = makeLifecycleAdapter();
    const deps = makeLifecycleDeps();

    session.codexAdapter = adapter as any;
    registerCodexAdapterRecoveryLifecycle(session.id, session, adapter, deps);
    adapter.emitSessionMeta({ cliSessionId: "thread-reconnected", model: "gpt-5.6-sol", cwd: "/repo" });

    await vi.waitFor(() => expect(session.state.backend_reconnect).toBeNull());
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(session, {
      type: "session_update",
      session: { backend_reconnect: null },
    });
    expect(session.state.backend_state).toBe("connected");
  });

  it("broadcasts testing only after the current manual recovery turn is backend-confirmed", async () => {
    // The initial optimistic running transition is deliberately insufficient;
    // turn/start acknowledgement confirms the current server-owned manual turn.
    const session = makeSession([{ id: "input-1", content: "test recovery", timestamp: 1_000, cancelable: false }]);
    prepareLifecycleSession(session);
    session.isGenerating = true;
    session.state.codex_result_error_auto_pause = {
      family: "copilot_auth_refresh_exhausted",
      fingerprint: "copilot_auth_refresh_exhausted:github_copilot",
      streak: 1,
      threshold: 1,
      pausedAt: 900,
      lastError: "GitHub Copilot API-key refresh exhausted its retry budget.",
      lastErrorAt: 900,
      lastSourceKind: "automatic",
      totalMatchingErrors: 1,
      heldInputs: [],
    };
    const pending = makePendingTurn();
    pending.autoPauseSourceKind = "manual";
    session.pendingCodexTurns = [pending];
    const adapter = makeLifecycleAdapter();
    const deps = makeLifecycleDeps({ getCodexTurnAwaitingAck: vi.fn(() => pending) });

    session.codexAdapter = adapter as any;
    registerCodexAdapterRecoveryLifecycle(session.id, session, adapter, deps);
    adapter.emitTurnStarted("turn-manual-recovery");

    expect(pending).toMatchObject({
      turnId: "turn-manual-recovery",
      status: "backend_acknowledged",
      turnTarget: "current",
      autoPauseSourceKind: "manual",
    });
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(session, {
      type: "session_update",
      session: {
        codex_result_error_auto_pause_recovery_progress: "active",
      },
    });

    vi.mocked(deps.broadcastToBrowsers).mockClear();
    adapter.emitSessionMeta({ cliSessionId: "thread-reconnected" });
    await vi.waitFor(() =>
      expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(session, {
        type: "session_update",
        session: {
          codex_result_error_auto_pause_recovery_progress: "active",
        },
      }),
    );
  });

  it("marks backend-owned Codex Goal continuations as running without a pending input", () => {
    // Codex Goal can start a turn internally after a thread becomes idle. Takode
    // must treat that backend-owned start as a real running turn even though no
    // local pending input is waiting for acknowledgement.
    const session = makeSession([]);
    prepareLifecycleSession(session);
    const adapter = makeLifecycleAdapter();
    const deps = makeLifecycleDeps({ getCodexTurnAwaitingAck: vi.fn(() => null) });

    session.codexAdapter = adapter as any;
    registerCodexAdapterRecoveryLifecycle(session.id, session, adapter, deps);
    adapter.emitTurnStarted("turn-goal-1", "codex_goal_continuation");

    expect(deps.setGenerating).toHaveBeenCalledWith(session, true, "codex_goal_continuation");
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(session, {
      type: "status_change",
      status: "running",
      codexAutoPauseRecoveryProgress: null,
    });
    expect(deps.persistSession).toHaveBeenCalledWith(session);
  });

  it("collapses duplicate queued and backend-ack pending turns after recovery session_meta", async () => {
    const session = makeSession([]);
    prepareLifecycleSession(session);
    const queued = makePendingTurn();
    queued.status = "queued";
    queued.turnTarget = null;
    queued.dispatchCount = 1;
    queued.createdAt = 1_000;
    queued.updatedAt = 1_100;
    const acknowledged = makePendingTurn();
    acknowledged.status = "backend_acknowledged";
    acknowledged.turnTarget = "queued";
    acknowledged.turnId = "turn-ack";
    acknowledged.dispatchCount = 2;
    acknowledged.createdAt = 1_200;
    acknowledged.updatedAt = 1_300;
    acknowledged.acknowledgedAt = 1_250;
    session.pendingCodexTurns = [queued, acknowledged];
    const adapter = makeLifecycleAdapter();
    adapter.getCurrentTurnId = vi.fn(() => "turn-ack");
    const deps = makeLifecycleDeps({
      getCodexHeadTurn: vi.fn((session: CodexRecoveryOrchestratorSessionLike) => session.pendingCodexTurns[0] ?? null),
    });

    session.codexAdapter = adapter as any;
    registerCodexAdapterRecoveryLifecycle(session.id, session, adapter, deps);
    adapter.emitSessionMeta({
      cliSessionId: "thread-recovered",
      resumeSnapshot: {
        threadId: "thread-recovered",
        threadStatus: "idle",
        turnCount: 0,
        turns: [],
      },
    });

    await vi.waitFor(() => expect(session.pendingCodexTurns).toHaveLength(1));
    expect(session.pendingCodexTurns[0]).toMatchObject({
      status: "backend_acknowledged",
      turnTarget: null,
      turnId: "turn-ack",
      dispatchCount: 2,
      createdAt: 1_000,
      updatedAt: 1_300,
      acknowledgedAt: 1_250,
    });
    expect(deps.persistSession).toHaveBeenCalledWith(session);
  });

  it("uses stale turn-steer rejection as an immediate pending-turn retry signal", () => {
    const session = makeSession([{ id: "input-1", content: "continue", timestamp: 1_000, cancelable: false }]);
    prepareLifecycleSession(session);
    const pending = makePendingTurn();
    pending.status = "backend_acknowledged";
    pending.turnTarget = "current";
    pending.turnId = "turn-stale";
    pending.acknowledgedAt = 1_500;
    session.pendingCodexTurns = [pending];
    const adapter = makeLifecycleAdapter();
    const deps = makeLifecycleDeps({
      getCodexHeadTurn: vi.fn((session: CodexRecoveryOrchestratorSessionLike) => session.pendingCodexTurns[0] ?? null),
      dispatchQueuedCodexTurns: vi.fn((session: CodexRecoveryOrchestratorSessionLike) => {
        const head = session.pendingCodexTurns[0];
        if (head?.status === "queued") head.status = "dispatched";
      }),
    });

    session.codexAdapter = adapter as any;
    registerCodexAdapterRecoveryLifecycle(session.id, session, adapter, deps);
    adapter.emitTurnSteerFailed(["input-1"]);

    expect(deps.setPendingCodexInputsCancelable).toHaveBeenCalledWith(session, ["input-1"], true);
    expect(deps.dispatchQueuedCodexTurns).toHaveBeenCalledWith(session, "codex_retry_pending_turn");
    expect(deps.dispatchQueuedCodexTurns).toHaveBeenCalledWith(session, "codex_turn_steer_failed");
    expect(pending.status).toBe("dispatched");
    expect(pending.turnId).toBeNull();
  });

  it("does not let an old intentional relaunch marker suppress a later adapter EOF", () => {
    vi.useFakeTimers();
    try {
      const session = makeSession([{ id: "input-1", content: "continue", timestamp: 1_000, cancelable: false }]);
      prepareLifecycleSession(session);
      session.isGenerating = true;
      const pending = makePendingTurn();
      pending.status = "backend_acknowledged";
      pending.turnTarget = "current";
      pending.turnId = "turn-new";
      session.pendingCodexTurns = [pending];
      const oldAdapter = makeLifecycleAdapter();
      const newAdapter = makeLifecycleAdapter({ closeId: "new-close-id" });
      const deps = makeLifecycleDeps();

      session.codexAdapter = oldAdapter as any;
      registerCodexAdapterRecoveryLifecycle(session.id, session, oldAdapter, deps);
      markCodexIntentionalRelaunch(session, "relaunch", 15_000);

      session.codexAdapter = newAdapter as any;
      registerCodexAdapterRecoveryLifecycle(session.id, session, newAdapter, deps);
      newAdapter.emitDisconnect();

      expect(session.consecutiveAdapterFailures).toBe(1);
      expect(deps.requestCodexAutoRecovery).toHaveBeenCalledWith(session, "adapter_disconnect");
    } finally {
      vi.useRealTimers();
    }
  });

  it("correlates adapter disconnect diagnostics through process snapshot and recovery session_meta", () => {
    const closeId = "codex-close-known-123";
    const session = makeSession([]);
    prepareLifecycleSession(session);
    const disconnectDiagnostics = {
      closeId,
      reason: "transport_close",
      transport: { closeContext: "stdout_eof(buffer=0)" },
    };
    const oldAdapter = makeLifecycleAdapter(disconnectDiagnostics);
    const deps = makeLifecycleDeps();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    session.codexAdapter = oldAdapter as any;
    registerCodexAdapterRecoveryLifecycle(session.id, session, oldAdapter, deps);
    oldAdapter.emitDisconnect();

    expect((session as any).lastCodexTransportCloseDiagnostics).toBe(disconnectDiagnostics);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`Codex adapter disconnect diagnostics`));
    expect(log).toHaveBeenCalledWith(expect.stringContaining(`closeId=${closeId}`));
    expect(deps.logCodexProcessSnapshot).toHaveBeenCalledWith(session.id, `adapter_disconnect closeId=${closeId}`);

    const newAdapter = makeLifecycleAdapter();
    session.codexAdapter = newAdapter as any;
    registerCodexAdapterRecoveryLifecycle(session.id, session, newAdapter, deps);
    newAdapter.emitSessionMeta({
      cliSessionId: "thread-recovered",
      resumeSnapshot: {
        threadId: "thread-recovered",
        threadStatus: "idle",
        turnCount: 0,
        turns: [],
      },
    });

    expect(
      log.mock.calls.some(([message]) => {
        const text = String(message);
        return text.includes("Codex recovery session_meta") && text.includes(`closeId=${closeId}`);
      }),
    ).toBe(true);
    expect(deps.setCliSessionIdFromMeta).toHaveBeenCalledWith(session.id, "thread-recovered");
  });
});

describe("handleCodexAdapterInitError", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps transient auto-recovery init errors recoverable and schedules a bounded retry", () => {
    // A post-restart transport close can be transient. While auto-recovery is
    // in flight, keep the pending turn retryable instead of terminally broken.
    vi.useFakeTimers();
    const adapter = { id: "adapter-1" };
    const session = makeSession([]);
    const pending = makePendingTurn();
    session.codexAdapter = adapter as any;
    session.state.backend_state = "resuming";
    session.pendingCodexTurns = [pending];
    (session as any).codexAutoRecoveryReason = "queued_user_message_adapter_missing";
    const deps = makeRecoveryDeps();

    const result = handleCodexAdapterInitError(
      session.id,
      session,
      adapter,
      "Codex initialization failed: Transport closed",
      deps,
    );

    expect(result).toBe("retrying");
    expect(session.state.backend_state).toBe("recovering");
    expect(session.codexAdapter).toBeNull();
    expect(pending.status).toBe("queued");
    expect(deps.setAttentionError).not.toHaveBeenCalled();
    expect(deps.setGenerating).not.toHaveBeenCalled();
    expect(deps.emitTakodeEvent).not.toHaveBeenCalledWith(
      session.id,
      "session_error",
      expect.objectContaining({ error: expect.any(String) }),
    );
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(session, { type: "backend_disconnected" });
    expect(deps.broadcastToBrowsers).not.toHaveBeenCalledWith(session, expect.objectContaining({ type: "error" }));

    vi.advanceTimersByTime(29_999);
    expect(deps.requestCodexAutoRecovery).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(deps.requestCodexAutoRecovery).toHaveBeenCalledWith(
      session,
      "init_error:queued_user_message_adapter_missing",
    );
  });

  it("keeps provider-result init retries on the persistent outage cadence", () => {
    // A laptop can remain offline beyond one inner process cycle. Retry timing
    // stays bounded without requiring a manual resend.
    vi.useFakeTimers();
    const adapter = { id: "provider-adapter-1" };
    const session = makeSession([]);
    const pending = makePendingTurn();
    session.codexAdapter = adapter as any;
    session.state.backend_state = "resuming";
    session.pendingCodexTurns = [pending];
    (session as any).codexAutoRecoveryReason = "provider_result:model_backend_stream_error:attempt_1";
    const deps = makeRecoveryDeps();

    expect(
      handleCodexAdapterInitError(session.id, session, adapter, "Codex initialization failed: Transport closed", deps),
    ).toBe("retrying");

    vi.advanceTimersByTime(29_999);
    expect(deps.requestCodexAutoRecovery).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(deps.requestCodexAutoRecovery).toHaveBeenCalledWith(
      session,
      "init_error:provider_result:model_backend_stream_error:attempt_1",
    );
  });

  it("starts a fresh inner process cycle while exact pending work remains eligible", () => {
    // Exhausting five process launches no longer strands a proof-safe owner.
    // Held automatic backlog remains isolated while the exact owner retries.
    vi.useFakeTimers();
    const adapter = makeLifecycleAdapter();
    const session = makeSession([]);
    prepareLifecycleSession(session);
    activateAutoPause(session);
    session.state.codex_result_error_auto_pause!.heldInputs.push({
      id: "held-init-exhaustion",
      queuedAt: 901,
      lastQueuedAt: 901,
      source: "programmatic",
      count: 1,
      message: { type: "user_message", content: "held event", agentSource: { sessionId: "herd-events" } },
    });
    const pending = makePendingTurn();
    pending.autoPauseSourceKind = "manual";
    pending.turnTarget = "current";
    session.isGenerating = true;
    session.codexAdapter = adapter as any;
    session.pendingCodexTurns = [pending];
    (session as any).codexAutoRecoveryReason = "queued_user_message_adapter_missing";
    (session as any).codexInitRecoveryFailures = 4;
    session.state.backend_reconnect = {
      attempt: 5,
      maxAttempts: 5,
      cycleStartedAt: 100,
      outageOwnerId: pending.userMessageId,
      outageFamily: "process_transport",
    };
    const deps = makeLifecycleDeps({ maxAdapterRelaunchFailures: 5 });

    const result = handleCodexAdapterInitError(
      session.id,
      session,
      adapter,
      "Codex initialization failed: Transport closed",
      deps,
    );

    expect(result).toBe("retrying");
    expect(session.state.backend_state).toBe("recovering");
    expect(pending).toMatchObject({ status: "queued", turnTarget: "current" });
    expect(pending.autoPauseRecoveryTestingRetired).not.toBe(true);
    expect(session.state.codex_result_error_auto_pause?.heldInputs).toHaveLength(1);
    expect(deps.emitTakodeEvent).not.toHaveBeenCalledWith(session.id, "session_error", expect.anything());
    expect(deps.setGenerating).not.toHaveBeenCalledWith(session, false, "codex_recovery_suppressed");

    vi.advanceTimersByTime(29_999);
    expect(deps.requestCodexAutoRecovery).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(deps.requestCodexAutoRecovery).toHaveBeenCalledWith(session, "queued_user_message_adapter_missing");

    const replacement = makeLifecycleAdapter();
    session.codexAdapter = replacement as any;
    vi.mocked(deps.broadcastToBrowsers).mockClear();
    registerCodexAdapterRecoveryLifecycle(session.id, session, replacement, deps);
    replacement.emitSessionMeta({ cliSessionId: "thread-after-outage" });
    expect(session.state.backend_state).toBe("connected");
    expect(session.state.backend_reconnect).toBeNull();
    expect(session.state.codex_result_error_auto_pause?.heldInputs).toHaveLength(1);
    expect(pending.autoPauseRecoveryTestingRetired).not.toBe(true);
    expect(deps.dispatchQueuedCodexTurns).toHaveBeenCalledWith(session, "session_meta");
  });

  it("marks non-transient init errors broken immediately", () => {
    const adapter = { id: "adapter-1" };
    const session = makeSession([]);
    session.codexAdapter = adapter as any;
    (session as any).codexAutoRecoveryReason = "queued_user_message_adapter_missing";
    session.state.codex_turn_recovery = {} as any;
    const deps = makeRecoveryDeps();

    const result = handleCodexAdapterInitError(
      session.id,
      session,
      adapter,
      "Codex initialization failed: no rollout found",
      deps,
    );

    expect(result).toBe("broken");
    expect(session.state.backend_state).toBe("broken");
    expect(session.state.codex_turn_recovery).toMatchObject({ status: "action_required", reason: "recovery_failed" });
    expect(deps.requestCodexAutoRecovery).not.toHaveBeenCalled();
    expect(deps.emitTakodeEvent).toHaveBeenCalledWith(session.id, "session_error", {
      error: "Codex initialization failed: no rollout found",
    });
    expect(deps.setGenerating).toHaveBeenCalledWith(session, false, "codex_init_error");
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(session, {
      type: "error",
      message: "Codex initialization failed: no rollout found",
    });
  });

  it.each([
    "Error: error loading default config after config error: No such file or directory (os error 2)",
    'MCP server "codex_apps" startup failed during initialize',
    "rmcp::transport::worker quit with fatal: Transport channel closed",
    "TokenRefreshFailed while starting MCP server",
    "OAuth refresh failed: invalid_grant",
  ])("treats actionable transport-close init stderr as terminal: %s", (stderr) => {
    // Some startup failures are reported as Transport closed but include a real
    // local configuration or auth/MCP problem in stderr. Those should stay
    // visible instead of being hidden behind transient restart recovery.
    const adapter = { id: "adapter-1" };
    const session = makeSession([]);
    session.codexAdapter = adapter as any;
    (session as any).codexAutoRecoveryReason = "queued_user_message_adapter_missing";
    const deps = makeRecoveryDeps();
    const error = `Codex initialization failed: Transport closed. Stderr: ${stderr}`;

    const result = handleCodexAdapterInitError(session.id, session, adapter, error, deps);

    expect(result).toBe("broken");
    expect(session.state.backend_state).toBe("broken");
    expect(deps.requestCodexAutoRecovery).not.toHaveBeenCalled();
    expect(deps.broadcastToBrowsers).toHaveBeenCalledWith(session, {
      type: "error",
      message: error,
    });
  });
});
