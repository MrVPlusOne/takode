import { describe, expect, it, vi } from "vitest";
import { codexTurnRecoverySourceId } from "../../shared/injected-event-message.js";
import type {
  BrowserIncomingMessage,
  BrowserOutgoingMessage,
  CodexOutboundTurn,
  PendingCodexInput,
} from "../session-types.js";
import { getCompactionRecoveryRuntimeDeps } from "../ws-bridge-deps.js";
import {
  dispatchQueuedCodexTurns,
  reconcileCodexResumedTurn,
  trySteerPendingCodexInputs,
  type CodexRecoveryOrchestratorSessionLike,
} from "./codex-recovery-orchestrator.js";
import { injectCompactionRecovery } from "./compaction-recovery.js";
import { completeCodexTurn, getCodexHeadTurn } from "./codex-turn-queue.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function pendingInput(id: string, agentSource?: PendingCodexInput["agentSource"]): PendingCodexInput {
  return {
    id,
    content: `visible:${id}`,
    deliveryContent: `delivery:${id}`,
    timestamp: 10,
    cancelable: true,
    ...(agentSource ? { agentSource } : {}),
    threadKey: "q-ordering",
    questId: "q-ordering",
  };
}

function pendingTurn(id: string): CodexOutboundTurn {
  return {
    adapterMsg: {
      type: "codex_start_pending",
      pendingInputIds: [id],
      inputs: [{ content: `delivery:${id}` }],
    },
    userMessageId: id,
    pendingInputIds: [id],
    userContent: `delivery:${id}`,
    historyIndex: -1,
    status: "queued",
    dispatchCount: 0,
    createdAt: 10,
    updatedAt: 10,
    acknowledgedAt: null,
    turnTarget: null,
    lastError: null,
    turnId: null,
    disconnectedAt: null,
    resumeConfirmedAt: null,
  };
}

function makeSession(currentTurnId: string | null = null) {
  const sent: BrowserOutgoingMessage[] = [];
  const events: string[] = [];
  const adapter = {
    getCurrentTurnId: vi.fn(() => currentTurnId),
    isConnected: vi.fn(() => true),
    sendBrowserMessage: vi.fn((message: BrowserOutgoingMessage) => {
      sent.push(message);
      events.push(`dispatch:${"pendingInputIds" in message ? message.pendingInputIds.join(",") : message.type}`);
      return true;
    }),
    disconnect: vi.fn(async () => {}),
  };
  const session = {
    id: "leader-recycle-ordering",
    backendType: "codex",
    attentionReason: null,
    state: {
      backend_state: "connected",
      backend_reconnect: null,
      backend_type: "codex",
      cwd: "/tmp",
      model: "gpt-5.6-sol",
      is_compacting: false,
      isOrchestrator: true,
      codex_result_error_auto_pause: null,
      codex_provider_retry: null,
      codex_turn_recovery: {
        recoveryId: "original-owner",
        originalOwnerId: "original-owner",
        originalProviderTurnId: "provider-turn",
        originalHistoryIndex: 0,
        continuationOwnerId: null,
        threadKey: "q-ordering",
        questId: "q-ordering",
        status: "continuation_pending",
        reason: "interrupted_after_activity",
        attempt: 1,
        maxAttempts: 1,
        createdAt: 1,
        updatedAt: 2,
      },
    },
    messageHistory: [],
    pendingMessages: [],
    pendingCodexInputs: [],
    pendingCodexTurns: [],
    codexLeaderRecycleContinuation: {
      trigger: "manual_compact",
      requestedAt: 3,
      content: "Continue the interrupted leader turn without replaying completed tools.",
      recoveryId: "original-owner",
      threadKey: "q-ordering",
      questId: "q-ordering",
    },
    codexFreshTurnRequiredUntilTurnId: null,
    isGenerating: false,
    cliInitReceived: true,
    consecutiveAdapterFailures: 0,
    lastAdapterFailureAt: null,
    queuedTurnStarts: 0,
    queuedTurnReasons: [],
    queuedTurnUserMessageIds: [],
    queuedTurnInterruptSources: [],
    queuedTurnActiveRoutes: [],
    codexAdapter: adapter,
  } as unknown as CodexRecoveryOrchestratorSessionLike & {
    attentionReason: "action" | "error" | "review" | null;
  };
  return { session, adapter, sent, events };
}

function makeHarness(session: CodexRecoveryOrchestratorSessionLike, events: string[]) {
  const broadcastToBrowsers = vi.fn();
  const persistSession = vi.fn();
  const broadcastPendingCodexInputs = vi.fn();
  const setAttentionError = vi.fn((target: { attentionReason?: string | null }) => {
    target.attentionReason = "error";
  });
  const setPendingCodexInputsCancelable = vi.fn(
    (target: CodexRecoveryOrchestratorSessionLike, ids: string[], cancelable: boolean) => {
      for (const input of target.pendingCodexInputs) {
        if (ids.includes(input.id)) input.cancelable = cancelable;
      }
    },
  );
  const dispatchDeps = {
    broadcastPendingCodexInputs,
    broadcastToBrowsers,
    pruneStalePendingCodexHerdInputs: vi.fn(() => false),
    setPendingCodexInputsCancelable,
    persistSession,
    isCodexWorkerV2DeliveryFrozen: vi.fn(() => false),
  };
  const rebuildQueuedCodexPendingStartBatch = vi.fn();
  const completeCodexLeaderRecycle = vi.fn(() => events.push("launcher-complete"));
  const sessionRouteChains = new Map<string, Promise<void>>();
  const host = {
    launcher: { completeCodexLeaderRecycle },
    sessionRouteChains,
    injectUserMessage: vi.fn(),
    getCodexRecoveryOrchestratorDeps: () => ({
      broadcastToBrowsers,
      persistSession,
      setAttentionError,
      rebuildQueuedCodexPendingStartBatch,
      dispatchQueuedCodexTurns: (target: CodexRecoveryOrchestratorSessionLike, reason: string) =>
        dispatchQueuedCodexTurns(target, reason, dispatchDeps as any),
    }),
  };
  return {
    runtimeDeps: getCompactionRecoveryRuntimeDeps(host),
    host,
    sessionRouteChains,
    dispatchDeps,
    broadcastToBrowsers,
    broadcastPendingCodexInputs,
    persistSession,
    setAttentionError,
    rebuildQueuedCodexPendingStartBatch,
    completeCodexLeaderRecycle,
  };
}

function recordRecoveryInjection(
  session: CodexRecoveryOrchestratorSessionLike,
  agentSource: { sessionId: string; sessionLabel?: string },
  inputId = "recovery-input",
): void {
  const recoveryInput = pendingInput(inputId, agentSource);
  session.pendingCodexInputs.push(recoveryInput);
  session.pendingCodexTurns.push(pendingTurn(recoveryInput.id));
  session.messageHistory.push({
    type: "user_message",
    id: inputId,
    content: recoveryInput.content,
    timestamp: 20,
    threadKey: recoveryInput.threadKey,
    questId: recoveryInput.questId,
    agentSource,
  });
}

function recoverySourceEntries(session: CodexRecoveryOrchestratorSessionLike): BrowserIncomingMessage[] {
  const sourceId = codexTurnRecoverySourceId("original-owner");
  return session.messageHistory.filter(
    (message) => message.type === "user_message" && message.agentSource?.sessionId === sourceId,
  );
}

function installRouteGate(routeChains: Map<string, Promise<void>>, sessionId: string) {
  const gate = deferred<void>();
  let tracked!: Promise<void>;
  tracked = gate.promise.finally(() => {
    if (routeChains.get(sessionId) === tracked) routeChains.delete(sessionId);
  });
  routeChains.set(sessionId, tracked);
  return gate;
}

function enqueueProductionShapedRoute(
  routeChains: Map<string, Promise<void>>,
  sessionId: string,
  task: () => Promise<void> | void,
): Promise<void> {
  const prior = routeChains.get(sessionId);
  const next = prior ? prior.catch(() => {}).then(() => task()) : Promise.resolve().then(() => task());
  let tracked!: Promise<void>;
  tracked = next.finally(() => {
    if (routeChains.get(sessionId) === tracked) routeChains.delete(sessionId);
  });
  routeChains.set(sessionId, tracked);
  return tracked;
}

describe("Codex exact leader recycle recovery ordering", () => {
  it("waits for delayed skill and memory preloads, then dispatches the exact recovery before completing the launcher marker", async () => {
    const { session, adapter, events } = makeSession();
    const harness = makeHarness(session, events);
    const skills = deferred<[]>();
    const memory = deferred<null>();
    const injectUserMessage = vi.fn(
      (
        _sessionId: string,
        _content: string,
        agentSource?: { sessionId: string; sessionLabel?: string },
        threadRoute?: { threadKey: string; questId?: string },
      ) => {
        events.push("inject-recovery");
        expect(threadRoute).toEqual({ threadKey: "q-ordering", questId: "q-ordering" });
        recordRecoveryInjection(session, agentSource!);
      },
    );

    injectCompactionRecovery(
      session as any,
      {
        ...harness.runtimeDeps,
        isLeaderSession: () => true,
        isSystemSourceTag: () => true,
        injectUserMessage,
        buildLeaderSkillPreloadBundles: () => skills.promise,
        buildMemoryCatalogInjectionBundle: () => memory.promise,
      } as any,
    );

    await Promise.resolve();
    expect(injectUserMessage).not.toHaveBeenCalled();
    expect(adapter.sendBrowserMessage).not.toHaveBeenCalled();
    expect(harness.completeCodexLeaderRecycle).not.toHaveBeenCalled();

    skills.resolve([]);
    await Promise.resolve();
    expect(injectUserMessage).not.toHaveBeenCalled();
    expect(harness.completeCodexLeaderRecycle).not.toHaveBeenCalled();

    memory.resolve(null);
    await vi.waitFor(() => expect(harness.completeCodexLeaderRecycle).toHaveBeenCalledTimes(1));

    expect(injectUserMessage).toHaveBeenCalledTimes(1);
    expect(recoverySourceEntries(session)).toHaveLength(1);
    expect(adapter.sendBrowserMessage).toHaveBeenCalledTimes(1);
    expect(session.pendingCodexTurns).toHaveLength(1);
    expect(session.pendingCodexTurns[0]).toMatchObject({
      userMessageId: "recovery-input",
      status: "dispatched",
      dispatchCount: 1,
    });
    expect(session.state.codex_turn_recovery).toMatchObject({
      continuationOwnerId: "recovery-input",
      status: "continuation_pending",
      attempt: 1,
    });
    expect(session.codexLeaderRecycleContinuation).toBeNull();
    expect(events).toEqual(["inject-recovery", "dispatch:recovery-input", "launcher-complete"]);
  });

  it("blocks queued dispatch and active-turn steering while exact recovery preload injection is pending", () => {
    const { session, adapter } = makeSession("active-provider-turn");
    const harness = makeHarness(session, []);
    const later = pendingInput("later-input");
    session.pendingCodexInputs.push(later);
    session.pendingCodexTurns.push(pendingTurn(later.id));
    const steeringDeps = {
      ...harness.dispatchDeps,
      clearCodexFreshTurnRequirement: vi.fn(),
    } as any;

    dispatchQueuedCodexTurns(session, "concurrent_later_dispatch", harness.dispatchDeps as any);
    expect(trySteerPendingCodexInputs(session, "concurrent_later_steer", steeringDeps)).toBe(false);

    expect(adapter.sendBrowserMessage).not.toHaveBeenCalled();
    expect(later.cancelable).toBe(true);
    expect(session.pendingCodexTurns[0]).toMatchObject({ status: "queued", dispatchCount: 0 });
    expect(steeringDeps.clearCodexFreshTurnRequirement).not.toHaveBeenCalled();
  });

  it("skips stale recovery injection when later ingress arrives during deferred preload and dispatches later work exactly once", async () => {
    const { session, adapter, events } = makeSession();
    const harness = makeHarness(session, events);
    const skills = deferred<[]>();
    const memory = deferred<null>();
    const injectUserMessage = vi.fn(
      (_sessionId: string, _content: string, agentSource?: { sessionId: string; sessionLabel?: string }) => {
        events.push("inject-recovery");
        recordRecoveryInjection(session, agentSource!);
      },
    );

    injectCompactionRecovery(
      session as any,
      {
        ...harness.runtimeDeps,
        isLeaderSession: () => true,
        isSystemSourceTag: () => true,
        injectUserMessage,
        buildLeaderSkillPreloadBundles: () => skills.promise,
        buildMemoryCatalogInjectionBundle: () => memory.promise,
      } as any,
    );

    const later = pendingInput("later-input");
    session.pendingCodexInputs.push(later);
    session.pendingCodexTurns.push(pendingTurn(later.id));
    dispatchQueuedCodexTurns(session, "later_arrived_during_preload", harness.dispatchDeps as any);
    expect(adapter.sendBrowserMessage).not.toHaveBeenCalled();

    skills.resolve([]);
    memory.resolve(null);
    await vi.waitFor(() => expect(harness.completeCodexLeaderRecycle).toHaveBeenCalledTimes(1));

    expect(injectUserMessage).not.toHaveBeenCalled();
    expect(recoverySourceEntries(session)).toEqual([]);
    expect(session.state.codex_turn_recovery).toMatchObject({
      recoveryId: "original-owner",
      status: "action_required",
      reason: "continuation_dispatch_failed",
    });
    expect(session.pendingCodexInputs.map((input) => input.id)).toEqual(["later-input"]);
    expect(session.pendingCodexTurns).toHaveLength(1);
    expect(session.pendingCodexTurns[0]).toMatchObject({
      userMessageId: "later-input",
      status: "dispatched",
      dispatchCount: 1,
    });
    expect(adapter.sendBrowserMessage).toHaveBeenCalledTimes(1);
    expect(adapter.sendBrowserMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "codex_start_pending", pendingInputIds: ["later-input"] }),
    );
    expect(harness.setAttentionError).not.toHaveBeenCalled();
    expect(session.codexLeaderRecycleContinuation).toBeNull();
    expect(events).toEqual(["dispatch:later-input", "launcher-complete"]);
  });

  it.each([
    {
      name: "action-required recovery",
      mutate: (target: CodexRecoveryOrchestratorSessionLike) => {
        target.state.codex_turn_recovery = {
          ...target.state.codex_turn_recovery!,
          status: "action_required",
          reason: "continuation_failed",
        };
      },
    },
    {
      name: "manual delivery pause",
      mutate: (target: CodexRecoveryOrchestratorSessionLike) => {
        (target.state as any).pause = { pausedAt: 50, queuedMessages: [] };
      },
    },
    {
      name: "automatic backend-result pause",
      mutate: (target: CodexRecoveryOrchestratorSessionLike) => {
        target.state.codex_result_error_auto_pause = {
          family: "model_backend_stream_error",
          fingerprint: "fingerprint",
          streak: 3,
          threshold: 3,
          pausedAt: 50,
          lastError: "sanitized",
          lastErrorAt: 50,
          lastSourceKind: "automatic",
          totalMatchingErrors: 3,
          heldInputs: [],
        };
      },
    },
  ])("does not create recovery input or history when $name begins before preload resolves", async ({ mutate }) => {
    const { session, adapter, events } = makeSession();
    const harness = makeHarness(session, events);
    const skills = deferred<[]>();
    const memory = deferred<null>();
    const injectUserMessage = vi.fn(
      (_sessionId: string, _content: string, agentSource?: { sessionId: string; sessionLabel?: string }) => {
        recordRecoveryInjection(session, agentSource!);
      },
    );

    injectCompactionRecovery(
      session as any,
      {
        ...harness.runtimeDeps,
        isLeaderSession: () => true,
        isSystemSourceTag: () => true,
        injectUserMessage,
        buildLeaderSkillPreloadBundles: () => skills.promise,
        buildMemoryCatalogInjectionBundle: () => memory.promise,
      } as any,
    );
    mutate(session);

    skills.resolve([]);
    memory.resolve(null);
    await vi.waitFor(() => expect(harness.completeCodexLeaderRecycle).toHaveBeenCalledTimes(1));

    expect(injectUserMessage).not.toHaveBeenCalled();
    expect(recoverySourceEntries(session)).toEqual([]);
    expect(
      session.pendingCodexInputs.some(
        (input) => input.agentSource?.sessionId === codexTurnRecoverySourceId("original-owner"),
      ),
    ).toBe(false);
    expect(adapter.sendBrowserMessage).not.toHaveBeenCalled();
    expect(session.state.codex_turn_recovery).toMatchObject({ status: "action_required" });
  });

  it("waits behind an existing route and keeps finalization ahead of later routes, using only the replacement adapter", async () => {
    const { session, adapter: originalAdapter, events } = makeSession();
    const harness = makeHarness(session, events);
    const priorRoute = installRouteGate(harness.sessionRouteChains, session.id);
    const exactRouteDurable = deferred<void>();
    const injectUserMessage = vi.fn(
      (_sessionId: string, _content: string, agentSource?: { sessionId: string; sessionLabel?: string }) => {
        events.push("inject-recovery");
        recordRecoveryInjection(session, agentSource!);
        const reservation = harness.sessionRouteChains.get(session.id)!;
        const exactRoute = reservation.then(() => exactRouteDurable.promise);
        harness.sessionRouteChains.set(session.id, exactRoute);
      },
    );

    injectCompactionRecovery(
      session as any,
      {
        ...harness.runtimeDeps,
        isLeaderSession: () => true,
        isSystemSourceTag: () => true,
        injectUserMessage,
        buildLeaderSkillPreloadBundles: () => [],
        buildMemoryCatalogInjectionBundle: () => null,
      } as any,
    );

    await Promise.resolve();
    expect(injectUserMessage).not.toHaveBeenCalled();
    priorRoute.resolve();
    await vi.waitFor(() => expect(injectUserMessage).toHaveBeenCalledTimes(1));
    expect(harness.completeCodexLeaderRecycle).not.toHaveBeenCalled();
    expect(originalAdapter.sendBrowserMessage).not.toHaveBeenCalled();

    const replacementSend = vi.fn((_message: BrowserOutgoingMessage) => {
      events.push("dispatch:replacement");
      return true;
    });
    session.codexAdapter = {
      getCurrentTurnId: vi.fn(() => null),
      isConnected: vi.fn(() => true),
      sendBrowserMessage: replacementSend,
      disconnect: vi.fn(async () => {}),
    };
    const recoveryBarrier = harness.sessionRouteChains.get(session.id)!;
    const laterRoute = recoveryBarrier.then(() => {
      events.push("later-route");
    });
    harness.sessionRouteChains.set(session.id, laterRoute);

    exactRouteDurable.resolve();
    await vi.waitFor(() => expect(events).toContain("later-route"));

    expect(recoverySourceEntries(session)).toHaveLength(1);
    expect(originalAdapter.sendBrowserMessage).not.toHaveBeenCalled();
    expect(replacementSend).toHaveBeenCalledTimes(1);
    expect(harness.completeCodexLeaderRecycle).toHaveBeenCalledTimes(1);
    expect(events).toEqual(["inject-recovery", "dispatch:replacement", "launcher-complete", "later-route"]);
  });

  it("deduplicates overlapping preload completions into one recovery input, history entry, and provider dispatch", async () => {
    const { session, adapter, events } = makeSession();
    const harness = makeHarness(session, events);
    const firstSkills = deferred<[]>();
    const firstMemory = deferred<null>();
    const secondSkills = deferred<[]>();
    const secondMemory = deferred<null>();
    const injectUserMessage = vi.fn(
      (_sessionId: string, _content: string, agentSource?: { sessionId: string; sessionLabel?: string }) => {
        events.push("inject-recovery");
        recordRecoveryInjection(session, agentSource!);
      },
    );
    const common = {
      ...harness.runtimeDeps,
      isLeaderSession: () => true,
      isSystemSourceTag: () => true,
      injectUserMessage,
    };

    injectCompactionRecovery(
      session as any,
      {
        ...common,
        buildLeaderSkillPreloadBundles: () => firstSkills.promise,
        buildMemoryCatalogInjectionBundle: () => firstMemory.promise,
      } as any,
    );
    injectCompactionRecovery(
      session as any,
      {
        ...common,
        buildLeaderSkillPreloadBundles: () => secondSkills.promise,
        buildMemoryCatalogInjectionBundle: () => secondMemory.promise,
      } as any,
    );

    firstSkills.resolve([]);
    secondSkills.resolve([]);
    firstMemory.resolve(null);
    secondMemory.resolve(null);
    await vi.waitFor(() => expect(adapter.sendBrowserMessage).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    await Promise.resolve();

    expect(injectUserMessage).toHaveBeenCalledTimes(1);
    expect(recoverySourceEntries(session)).toHaveLength(1);
    expect(
      session.pendingCodexInputs.filter(
        (input) => input.agentSource?.sessionId === codexTurnRecoverySourceId("original-owner"),
      ),
    ).toHaveLength(1);
    expect(adapter.sendBrowserMessage).toHaveBeenCalledTimes(1);
    expect(adapter.sendBrowserMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "codex_start_pending", pendingInputIds: ["recovery-input"] }),
    );
  });

  it("serializes overlapping preload completions whose injections use asynchronously durable route chains", async () => {
    const { session, adapter, events } = makeSession();
    const harness = makeHarness(session, events);
    const firstSkills = deferred<[]>();
    const firstMemory = deferred<null>();
    const secondSkills = deferred<[]>();
    const secondMemory = deferred<null>();
    const firstDurability = deferred<void>();
    const secondDurability = deferred<void>();
    const makeRoutedInjection = (label: string, inputId: string, durability: ReturnType<typeof deferred<void>>) =>
      vi.fn((_sessionId: string, _content: string, agentSource?: { sessionId: string; sessionLabel?: string }) => {
        events.push(`queue-recovery:${label}`);
        void enqueueProductionShapedRoute(harness.sessionRouteChains, session.id, async () => {
          await durability.promise;
          events.push(`durable-recovery:${label}`);
          recordRecoveryInjection(session, agentSource!, inputId);
        });
      });
    const firstInjection = makeRoutedInjection("first", "recovery-input-first", firstDurability);
    const secondInjection = makeRoutedInjection("second", "recovery-input-second", secondDurability);

    injectCompactionRecovery(
      session as any,
      {
        ...harness.runtimeDeps,
        isLeaderSession: () => true,
        isSystemSourceTag: () => true,
        injectUserMessage: firstInjection,
        buildLeaderSkillPreloadBundles: () => firstSkills.promise,
        buildMemoryCatalogInjectionBundle: () => firstMemory.promise,
      } as any,
    );
    injectCompactionRecovery(
      session as any,
      {
        ...harness.runtimeDeps,
        isLeaderSession: () => true,
        isSystemSourceTag: () => true,
        injectUserMessage: secondInjection,
        buildLeaderSkillPreloadBundles: () => secondSkills.promise,
        buildMemoryCatalogInjectionBundle: () => secondMemory.promise,
      } as any,
    );

    firstSkills.resolve([]);
    secondSkills.resolve([]);
    firstMemory.resolve(null);
    secondMemory.resolve(null);
    await vi.waitFor(() => expect(firstInjection.mock.calls.length + secondInjection.mock.calls.length).toBe(1));

    expect(recoverySourceEntries(session)).toEqual([]);
    expect(
      session.pendingCodexInputs.filter(
        (input) => input.agentSource?.sessionId === codexTurnRecoverySourceId("original-owner"),
      ),
    ).toEqual([]);
    expect(adapter.sendBrowserMessage).not.toHaveBeenCalled();
    expect(harness.sessionRouteChains.has(session.id)).toBe(true);

    firstDurability.resolve();
    secondDurability.resolve();
    await vi.waitFor(() => expect(adapter.sendBrowserMessage).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(harness.sessionRouteChains.has(session.id)).toBe(false));

    const sourceInputs = session.pendingCodexInputs.filter(
      (input) => input.agentSource?.sessionId === codexTurnRecoverySourceId("original-owner"),
    );
    expect(firstInjection.mock.calls.length + secondInjection.mock.calls.length).toBe(1);
    expect(recoverySourceEntries(session)).toHaveLength(1);
    expect(sourceInputs).toHaveLength(1);
    expect(session.state.codex_turn_recovery).toMatchObject({
      continuationOwnerId: sourceInputs[0]!.id,
      status: "continuation_pending",
      attempt: 1,
    });
    expect(adapter.sendBrowserMessage).toHaveBeenCalledTimes(1);
    expect(adapter.sendBrowserMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "codex_start_pending", pendingInputIds: [sourceInputs[0]!.id] }),
    );
  });

  it("splits an explicitly mixed later-and-recovery batch so only the recovery delivery is retired", () => {
    const { session, adapter, events } = makeSession();
    const harness = makeHarness(session, events);
    const recoverySource = {
      sessionId: codexTurnRecoverySourceId("original-owner"),
      sessionLabel: "Interrupted Turn Recovery",
    };
    const later = pendingInput("later-input");
    const recovery = pendingInput("recovery-input", recoverySource);
    session.pendingCodexInputs = [later, recovery];
    session.pendingCodexTurns = [
      {
        ...pendingTurn("later-input"),
        pendingInputIds: ["later-input", "recovery-input"],
        adapterMsg: {
          type: "codex_start_pending",
          pendingInputIds: ["later-input", "recovery-input"],
          inputs: [{ content: "delivery:later-input" }, { content: "delivery:recovery-input" }],
        },
        userContent: "delivery:later-input\n\ndelivery:recovery-input",
      },
    ];

    harness.runtimeDeps.finalizeExactRecoveryInjection(session as any, "original-owner", 3);

    expect(session.state.codex_turn_recovery).toMatchObject({
      status: "action_required",
      reason: "continuation_dispatch_failed",
    });
    expect(session.pendingCodexInputs.map((input) => input.id)).toEqual(["later-input"]);
    expect(session.pendingCodexTurns).toHaveLength(1);
    expect(session.pendingCodexTurns[0]).toMatchObject({
      userMessageId: "later-input",
      pendingInputIds: ["later-input"],
      userContent: "delivery:later-input",
      status: "dispatched",
      dispatchCount: 1,
      adapterMsg: {
        type: "codex_start_pending",
        pendingInputIds: ["later-input"],
        inputs: [{ content: "delivery:later-input" }],
      },
    });
    expect(adapter.sendBrowserMessage).toHaveBeenCalledTimes(1);
    expect(adapter.sendBrowserMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "codex_start_pending", pendingInputIds: ["later-input"] }),
    );
    expect(harness.completeCodexLeaderRecycle).toHaveBeenCalledTimes(1);
  });
});

describe("Codex resumed-turn co-owner canonicalization", () => {
  it("binds a text-matched null-id head before selecting and settling the direct-human same-turn owner", () => {
    const { session } = makeSession();
    session.state.codex_turn_recovery = null;
    session.codexLeaderRecycleContinuation = null;
    session.isGenerating = true;
    session.messageHistory = [
      {
        type: "user_message",
        id: "automatic-owner",
        content: "shared resumed request",
        timestamp: 1,
        agentSource: { sessionId: "system:automatic-work" },
        threadKey: "main",
      },
      {
        type: "user_message",
        id: "human-owner",
        content: "shared resumed request",
        timestamp: 2,
        threadKey: "q-9010",
        questId: "q-9010",
      },
      {
        type: "assistant",
        timestamp: 3,
        parent_tool_use_id: null,
        threadKey: "q-9010",
        questId: "q-9010",
        message: {
          id: "unfinished-tool",
          type: "message",
          role: "assistant",
          model: "gpt-5.6-sol",
          content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "echo completed" } }],
          stop_reason: "tool_use",
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        },
      },
    ] as BrowserIncomingMessage[];

    const automatic = pendingTurn("automatic-owner");
    automatic.adapterMsg = { type: "user_message", content: "shared resumed request" };
    automatic.userContent = "shared resumed request";
    automatic.historyIndex = 0;
    automatic.status = "backend_acknowledged";
    automatic.turnId = null;
    automatic.turnTarget = "current";
    const human = pendingTurn("human-owner");
    human.adapterMsg = { type: "user_message", content: "shared resumed request" };
    human.userContent = "shared resumed request";
    human.historyIndex = 1;
    human.status = "backend_acknowledged";
    human.turnId = "provider-turn";
    human.turnTarget = "current";
    session.pendingCodexTurns = [automatic, human];

    const injectUserMessage = vi.fn(
      (
        _sessionId: string,
        _content: string,
        agentSource: { sessionId: string; sessionLabel?: string },
        threadRoute: { threadKey: string; questId?: string },
        options: { afterAccepted?: () => void },
      ) => {
        session.pendingCodexInputs.push(pendingInput("continuation-owner", agentSource));
        session.pendingCodexInputs[0]!.threadKey = threadRoute.threadKey;
        session.pendingCodexInputs[0]!.questId = threadRoute.questId;
        options.afterAccepted?.();
        return "sent" as const;
      },
    );
    const dispatchQueued = vi.fn();
    const deps = {
      codexAssistantReplayScanLimit: 100,
      formatVsCodeSelectionPrompt: vi.fn(() => ""),
      broadcastPendingCodexInputs: vi.fn(),
      broadcastToBrowsers: vi.fn(),
      persistSession: vi.fn(),
      touchUserMessage: vi.fn(),
      emitTakodeEvent: vi.fn(),
      injectCompactionRecovery: vi.fn(),
      enqueueCodexTurn: vi.fn(),
      getCodexHeadTurn,
      getCodexTurnInRecovery: getCodexHeadTurn,
      completeCodexTurn,
      completeCodexTurnsForResult: vi.fn(),
      clearCodexFreshTurnRequirement: vi.fn(),
      dispatchQueuedCodexTurns: dispatchQueued,
      maybeFlushQueuedCodexMessages: vi.fn(),
      pruneStalePendingCodexHerdInputs: vi.fn(() => false),
      synthesizeCodexToolResultsFromResumedTurn: vi.fn(() => ({
        count: 0,
        omittedFromResumeSnapshotCount: 0,
      })),
      handleRecoveredCodexAutoPauseSuccess: vi.fn(),
      trackUserMessageForTurn: vi.fn(),
      markTurnInterrupted: vi.fn(),
      setGenerating: vi.fn((target: CodexRecoveryOrchestratorSessionLike, generating: boolean) => {
        target.isGenerating = generating;
      }),
      markRunningFromUserDispatch: vi.fn(() => "current" as const),
      promoteNextQueuedTurn: vi.fn(() => false),
      isCodexWorkerV2DeliveryFrozen: vi.fn(() => false),
      injectUserMessage,
      setAttentionError: vi.fn(),
    } as any;

    reconcileCodexResumedTurn(
      session,
      {
        threadId: "thread-resumed",
        turnCount: 1,
        threadStatus: "idle",
        turns: [],
        lastTurn: {
          id: "provider-turn",
          status: "completed",
          error: null,
          items: [
            { type: "userMessage", content: [{ type: "text", text: "shared resumed request" }] },
            { type: "functionCall", id: "tool-1", status: "completed", name: "exec_command" },
          ],
        },
      },
      deps,
    );

    expect(automatic.turnId).toBe("provider-turn");
    expect(session.pendingCodexTurns).toEqual([]);
    expect(injectUserMessage).toHaveBeenCalledTimes(1);
    expect(injectUserMessage).toHaveBeenCalledWith(
      session.id,
      expect.stringContaining("separate follow-up to check prior work"),
      expect.objectContaining({ sessionId: codexTurnRecoverySourceId("human-owner") }),
      expect.objectContaining({ threadKey: "q-9010", questId: "q-9010" }),
      expect.objectContaining({ deliveryContent: expect.stringContaining("verification-first continuation") }),
    );
    expect(session.state.codex_turn_recovery).toMatchObject({
      recoveryId: "human-owner",
      originalOwnerId: "human-owner",
      originalProviderTurnId: "provider-turn",
      continuationOwnerId: "continuation-owner",
      threadKey: "q-9010",
      questId: "q-9010",
      status: "continuation_pending",
      attempt: 1,
    });
    expect(dispatchQueued).toHaveBeenCalledTimes(1);
  });
});
