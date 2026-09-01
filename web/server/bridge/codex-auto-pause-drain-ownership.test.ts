import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionStore, type PersistedSession } from "../session-store.js";
import type { BrowserOutgoingMessage } from "../session-types.js";
import { queueCodexAutoPausedInput } from "../codex-result-error-auto-pause.js";
import {
  handleCodexResultErrorAutoPause,
  releaseCodexAutoPausedInputs,
} from "./codex-result-error-auto-pause-delivery.js";
import { markCodexAutoPauseRecoveryDelivered } from "./codex-auto-pause-recovery-summary.js";
import {
  normalizePersistedRecoveryDeliveryTransfers,
  RECOVERY_DELIVERY_TRANSFER_MAX_COUNT,
  resumeRecoveryDeliveryTransfers,
} from "./recovery-delivery-transfer.js";
import type { BrowserTransportDeps, BrowserTransportSessionLike } from "./browser-transport-controller.js";
import { getRecoveryDeliveryTransferDepsForBridge } from "./ws-bridge-recovery-delivery-transfer-deps.js";

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeSession(): BrowserTransportSessionLike {
  return {
    id: "drain-session",
    backendType: "codex",
    browserSockets: new Set(),
    messageHistory: [],
    frozenCount: 0,
    state: {
      permissionMode: "default",
      codex_result_error_auto_pause: {
        family: "copilot_auth_refresh_exhausted",
        fingerprint: "copilot_auth_refresh_exhausted:github_copilot",
        streak: 1,
        threshold: 1,
        pausedAt: 100,
        lastError: "GitHub Copilot API-key refresh exhausted its retry budget.",
        lastErrorAt: 100,
        lastSourceKind: "automatic",
        totalMatchingErrors: 1,
        heldInputs: [
          {
            id: "held-group",
            queuedAt: 101,
            lastQueuedAt: 101,
            source: "programmatic",
            count: 1,
            message: {
              type: "user_message",
              content: "held event",
              agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
            },
          },
        ],
      },
    } as any,
    nextEventSeq: 1,
    lastAckSeq: 0,
    pendingPermissions: new Map(),
    pendingCodexInputs: [],
    pendingCodexTurns: [],
    recoveryDeliveryTransfers: [],
    taskHistory: [],
    eventBuffer: [],
    lastReadAt: 0,
    attentionReason: null,
    generationStartedAt: null,
    notifications: [],
    attentionRecords: [],
    processedClientMessageIds: [],
    processedClientMessageIdSet: new Set(),
  };
}

function makeIngressDeps(
  routeBrowserMessage: BrowserTransportDeps["routeBrowserMessage"] = vi.fn(),
  archived = false,
): BrowserTransportDeps {
  return {
    refreshGitInfoThenRecomputeDiff: vi.fn(),
    prefillSlashCommands: vi.fn(),
    getTreeGroupState: vi.fn(async () => ({ groups: [], assignments: {}, nodeOrder: {} })),
    getVsCodeSelectionState: vi.fn(() => null),
    getLauncherSessionInfo: vi.fn(() => ({
      archived,
      state: archived ? "exited" : "connected",
      backendType: "codex" as const,
    })),
    backendAttached: vi.fn(() => true),
    backendConnected: vi.fn(() => true),
    getRouteChain: vi.fn(() => undefined),
    setRouteChain: vi.fn(),
    clearRouteChain: vi.fn(),
    routeBrowserMessage,
    abortAutoApproval: vi.fn(),
    broadcastToBrowsers: vi.fn(),
    setAttentionAction: vi.fn(),
    touchActivity: vi.fn(),
    notifyImageSendFailure: vi.fn(),
    broadcastError: vi.fn(),
    queueCodexPendingStartBatch: vi.fn(),
    deriveBackendState: vi.fn(() => "connected" as const),
    getBoard: vi.fn(() => []),
    getCompletedBoard: vi.fn(() => []),
    getBoardRowSessionStatuses: vi.fn(() => ({})),
    recoverToolStartTimesFromHistory: vi.fn(),
    finalizeRecoveredDisconnectedTerminalTools: vi.fn(),
    scheduleCodexToolResultWatchdogs: vi.fn(),
    recomputeAndBroadcastHistoryBytes: vi.fn(),
    listTimers: vi.fn(() => []),
    persistSession: vi.fn(),
    recordOutgoingRaw: vi.fn(),
    eventBufferLimit: 100,
    browserTransportState: {
      vscodeSelectionState: null,
      vscodeWindows: new Map(),
      vscodeOpenFileQueues: new Map(),
      pendingVsCodeOpenResults: new Map(),
    },
    idempotentMessageTypes: new Set(),
    processedClientMsgIdLimit: 100,
    getSessions: vi.fn(() => []),
    windowStaleMs: 1_000,
    openFileTimeoutMs: 1_000,
  };
}

async function releaseHeldInput(
  session: BrowserTransportSessionLike,
  getIngressDeps: () => BrowserTransportDeps,
  onFirstBarrier?: () => void | Promise<void>,
  completedTurn: Record<string, unknown> = {
    autoPauseSourceKind: "manual",
    turnTarget: "current",
    autoPauseRecoveryTestingRetired: false,
  },
) {
  const persistSession = vi.fn();
  const broadcastToBrowsers = vi.fn();
  const snapshots: any[] = [];
  let barrierCount = 0;
  const result = handleCodexResultErrorAutoPause(
    session as any,
    {
      type: "result",
      subtype: "success",
      is_error: false,
      result: "ok",
      stop_reason: "end_turn",
    } as any,
    completedTurn as any,
    {
      broadcastToBrowsers,
      broadcastPendingCodexInputs: vi.fn(),
      persistSession,
      persistSessionImmediately: vi.fn(async (target) => {
        snapshots.push(structuredClone(target));
        barrierCount += 1;
        if (barrierCount === 1) await onFirstBarrier?.();
      }),
      getBrowserTransportDeps: getIngressDeps,
      releasePendingTransfer: vi.fn(),
    },
  );
  await result;
  return { persistSession, snapshots, broadcastToBrowsers };
}

function recoveryReceipt(session: BrowserTransportSessionLike) {
  const summary = session.messageHistory.find((message) => message.type === "codex_auto_pause_recovery_summary");
  if (summary?.type !== "codex_auto_pause_recovery_summary") throw new Error("missing recovery summary");
  return { summary, receipt: summary.recovery.receipts[0]! };
}

function expectEveryReleasedReceiptOwned(session: BrowserTransportSessionLike): void {
  const pendingLinks = [
    ...session.pendingCodexInputs.flatMap((input) => input.autoPauseRecoveries ?? []),
    ...session.pendingCodexTurns.flatMap((turn) => turn.autoPauseRecoveryLinks ?? []),
  ];
  const manualPauseLinks = (session.state.pause?.queuedMessages ?? []).flatMap(
    (queued) => queued.message.autoPauseRecoveries ?? [],
  );
  const renewedAutoPauseLinks = (session.state.codex_result_error_auto_pause?.heldInputs ?? []).flatMap(
    (held) => held.message.autoPauseRecoveries ?? [],
  );
  const owns = (links: typeof pendingLinks, summaryId: string, groupId: string) =>
    links.some((link) => link.summaryId === summaryId && link.groupId === groupId);

  for (const message of session.messageHistory) {
    if (message.type !== "codex_auto_pause_recovery_summary") continue;
    for (const receipt of message.recovery.receipts) {
      if (receipt.outcome !== "released_to_delivery") continue;
      const ownerCount = [pendingLinks, manualPauseLinks, renewedAutoPauseLinks].filter((links) =>
        owns(links, message.id, receipt.groupId),
      ).length;
      expect(ownerCount, `released group ${receipt.groupId} must have exactly one durable owner`).toBe(1);
    }
  }
}

describe("Codex auto-pause drain ownership", () => {
  it("accepts one explicit release per pause epoch while the durable handoff is in progress", async () => {
    const session = makeSession();
    const route = vi.fn((target: BrowserTransportSessionLike, message: BrowserOutgoingMessage) => {
      if (message.type !== "user_message") return;
      target.pendingCodexInputs.push({
        id: "pending-explicit-release",
        content: message.content,
        timestamp: 210,
        cancelable: true,
        autoPauseRecoveries: message.autoPauseRecoveries,
      } as any);
    });
    let releaseFirstBarrier!: () => void;
    const firstBarrier = new Promise<void>((resolve) => {
      releaseFirstBarrier = resolve;
    });
    let barrierCount = 0;
    const broadcastToBrowsers = vi.fn();
    const deps = {
      broadcastToBrowsers,
      broadcastPendingCodexInputs: vi.fn(),
      persistSession: vi.fn(),
      persistSessionImmediately: vi.fn(async () => {
        barrierCount += 1;
        if (barrierCount === 1) await firstBarrier;
      }),
      getBrowserTransportDeps: () => makeIngressDeps(route),
      releasePendingTransfer: vi.fn(),
    };

    const first = releaseCodexAutoPausedInputs(session as any, 100, deps as any);
    expect(session.state.codex_result_error_auto_pause?.releaseProgress).toMatchObject({ status: "releasing" });
    expect(broadcastToBrowsers).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: "session_update",
        session: expect.objectContaining({
          codex_result_error_auto_pause: expect.objectContaining({
            releaseProgress: expect.objectContaining({ status: "releasing" }),
          }),
        }),
      }),
    );

    await expect(releaseCodexAutoPausedInputs(session as any, 100, deps as any)).resolves.toBe("in_progress");
    expect(session.recoveryDeliveryTransfers).toHaveLength(1);
    releaseFirstBarrier();
    await expect(first).resolves.toBe("accepted");

    expect(route).toHaveBeenCalledTimes(1);
    expect(session.state.codex_result_error_auto_pause).toBeNull();
    expect(session.recoveryDeliveryTransfers).toEqual([]);
    expect(session.messageHistory.filter((entry) => entry.type === "codex_auto_pause_recovery_summary")).toHaveLength(
      1,
    );
    expect(recoveryReceipt(session).receipt).toMatchObject({
      reasonCode: "user_release_requested",
      outcome: "released_to_delivery",
    });
  });

  it("re-enables the same epoch after a failed transfer barrier and retries without duplicating delivery", async () => {
    const session = makeSession();
    const route = vi.fn((target: BrowserTransportSessionLike, message: BrowserOutgoingMessage) => {
      if (message.type !== "user_message") return;
      target.pendingCodexInputs.push({
        id: "pending-retried-explicit-release",
        content: message.content,
        timestamp: 220,
        cancelable: true,
        autoPauseRecoveries: message.autoPauseRecoveries,
      } as any);
    });
    let failFirstBarrier = true;
    const broadcastToBrowsers = vi.fn();
    const deps = {
      broadcastToBrowsers,
      broadcastPendingCodexInputs: vi.fn(),
      persistSession: vi.fn(),
      persistSessionImmediately: vi.fn(async () => {
        if (!failFirstBarrier) return;
        failFirstBarrier = false;
        throw new Error("release barrier failed");
      }),
      getBrowserTransportDeps: () => makeIngressDeps(route),
      releasePendingTransfer: vi.fn(),
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(releaseCodexAutoPausedInputs(session as any, 100, deps as any)).resolves.toBe("accepted");
    expect(session.state.codex_result_error_auto_pause).toMatchObject({ pausedAt: 100 });
    expect(session.state.codex_result_error_auto_pause?.releaseProgress).toBeUndefined();
    expect(route).not.toHaveBeenCalled();
    expect(session.recoveryDeliveryTransfers).toHaveLength(1);

    await expect(releaseCodexAutoPausedInputs(session as any, 99, deps as any)).resolves.toBe("stale");
    await expect(releaseCodexAutoPausedInputs(session as any, 100, deps as any)).resolves.toBe("accepted");

    expect(route).toHaveBeenCalledTimes(1);
    expect(session.state.codex_result_error_auto_pause).toBeNull();
    expect(session.recoveryDeliveryTransfers).toEqual([]);
    expect(session.messageHistory.filter((entry) => entry.type === "codex_auto_pause_recovery_summary")).toHaveLength(
      1,
    );
    expect(session.pendingCodexInputs).toHaveLength(1);
  });

  it("restores the pause after a second durability-barrier failure and retries without duplicate delivery", async () => {
    const session = makeSession();
    const route = vi.fn((target: BrowserTransportSessionLike, message: BrowserOutgoingMessage) => {
      if (message.type !== "user_message") return;
      target.pendingCodexInputs.push({
        id: "pending-second-barrier-retry",
        content: message.content,
        timestamp: 230,
        cancelable: true,
        autoPauseRecoveries: message.autoPauseRecoveries,
      } as any);
    });
    let barrierCount = 0;
    const deps = {
      broadcastToBrowsers: vi.fn(),
      broadcastPendingCodexInputs: vi.fn(),
      persistSession: vi.fn(),
      persistSessionImmediately: vi.fn(async () => {
        barrierCount += 1;
        if (barrierCount === 2) throw new Error("source-removal barrier failed");
      }),
      getBrowserTransportDeps: () => makeIngressDeps(route),
      releasePendingTransfer: vi.fn(),
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(releaseCodexAutoPausedInputs(session as any, 100, deps as any)).resolves.toBe("accepted");

    expect(session.state.codex_result_error_auto_pause).toMatchObject({
      pausedAt: 100,
      heldInputs: [expect.objectContaining({ id: "held-group" })],
    });
    expect(session.state.codex_result_error_auto_pause?.releaseProgress).toBeUndefined();
    expect(session.recoveryDeliveryTransfers).toHaveLength(1);
    expect(route).not.toHaveBeenCalled();

    await expect(releaseCodexAutoPausedInputs(session as any, 100, deps as any)).resolves.toBe("accepted");

    expect(route).toHaveBeenCalledTimes(1);
    expect(session.pendingCodexInputs).toHaveLength(1);
    expect(session.state.codex_result_error_auto_pause).toBeNull();
    expect(session.recoveryDeliveryTransfers).toEqual([]);
  });

  it("keeps exact counts when coalescing races a failed second durability barrier", async () => {
    const session = makeSession();
    const routedCounts: number[] = [];
    const route = vi.fn((target: BrowserTransportSessionLike, message: BrowserOutgoingMessage) => {
      if (message.type !== "user_message") return;
      const coalesced = message.content.match(/auto-pause resumed: (\d+) similar automatic inputs/)?.[1];
      routedCounts.push(coalesced ? Number(coalesced) : 1);
      target.pendingCodexInputs.push({
        id: `pending-coalesced-${routedCounts.length}`,
        content: message.content,
        timestamp: 240 + routedCounts.length,
        cancelable: true,
        autoPauseRecoveries: message.autoPauseRecoveries,
      } as any);
    });
    let releaseFirstBarrier!: () => void;
    const firstBarrier = new Promise<void>((resolve) => {
      releaseFirstBarrier = resolve;
    });
    let barrierCount = 0;
    const deps = {
      broadcastToBrowsers: vi.fn(),
      broadcastPendingCodexInputs: vi.fn(),
      persistSession: vi.fn(),
      persistSessionImmediately: vi.fn(async () => {
        barrierCount += 1;
        if (barrierCount === 1) await firstBarrier;
        if (barrierCount === 2) throw new Error("source-removal barrier failed after coalescing");
      }),
      getBrowserTransportDeps: () => makeIngressDeps(route),
      releasePendingTransfer: vi.fn(),
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    const firstRelease = releaseCodexAutoPausedInputs(session as any, 100, deps as any);
    queueCodexAutoPausedInput(
      session as any,
      "programmatic",
      {
        type: "user_message",
        content: "held event",
        agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
      },
      150,
    );
    expect(session.state.codex_result_error_auto_pause?.heldInputs[0]?.count).toBe(2);
    releaseFirstBarrier();
    await expect(firstRelease).resolves.toBe("accepted");

    const restoredPause = session.state.codex_result_error_auto_pause;
    expect(restoredPause).not.toBeNull();
    expect(restoredPause!.heldInputs.reduce((total, item) => total + item.count, 0)).toBe(2);
    expect(session.recoveryDeliveryTransfers).toHaveLength(1);
    expect(route).not.toHaveBeenCalled();

    await expect(releaseCodexAutoPausedInputs(session as any, restoredPause!.pausedAt!, deps as any)).resolves.toBe(
      "accepted",
    );

    expect(routedCounts.reduce((total, count) => total + count, 0)).toBe(2);
    expect(session.pendingCodexInputs).toHaveLength(2);
    expect(session.state.codex_result_error_auto_pause).toBeNull();
    expect(session.recoveryDeliveryTransfers).toEqual([]);
  });

  it("keeps a newer retained release epoch in progress when an older handoff rolls back", async () => {
    // Reproduce two overlapping source-removal barriers. The older durable
    // transfer must re-hold behind the newer accepted epoch without rewinding
    // its token, losing ownership, or inflating the eventual delivery count.
    const session = makeSession();
    const routedCounts: number[] = [];
    const route = vi.fn((target: BrowserTransportSessionLike, message: BrowserOutgoingMessage) => {
      if (message.type !== "user_message") return;
      const coalesced = message.content.match(/auto-pause resumed: (\d+) similar automatic inputs/)?.[1];
      routedCounts.push(coalesced ? Number(coalesced) : 1);
      target.pendingCodexInputs.push({
        id: `pending-overlap-${routedCounts.length}`,
        content: message.content,
        timestamp: 260 + routedCounts.length,
        cancelable: true,
        autoPauseRecoveries: message.autoPauseRecoveries,
      } as any);
    });
    let restartBoundary: BrowserTransportSessionLike | null = null;
    let releaseFirstBarrier!: () => void;
    const firstBarrier = new Promise<void>((resolve) => {
      releaseFirstBarrier = resolve;
    });
    let rejectOlderSecondBarrier!: (error: Error) => void;
    const olderSecondBarrier = new Promise<void>((_resolve, reject) => {
      rejectOlderSecondBarrier = reject;
    });
    let noteOlderSecondBarrierStarted!: () => void;
    const olderSecondBarrierStarted = new Promise<void>((resolve) => {
      noteOlderSecondBarrierStarted = resolve;
    });
    let releaseNewerFirstBarrier!: () => void;
    const newerFirstBarrier = new Promise<void>((resolve) => {
      releaseNewerFirstBarrier = resolve;
    });
    let noteNewerFirstBarrierStarted!: () => void;
    const newerFirstBarrierStarted = new Promise<void>((resolve) => {
      noteNewerFirstBarrierStarted = resolve;
    });
    let barrierCount = 0;
    const deps = {
      broadcastToBrowsers: vi.fn(),
      broadcastPendingCodexInputs: vi.fn(),
      persistSession: vi.fn(),
      persistSessionImmediately: vi.fn(async (target: BrowserTransportSessionLike) => {
        barrierCount += 1;
        if (barrierCount === 1) await firstBarrier;
        if (barrierCount === 2) {
          noteOlderSecondBarrierStarted();
          await olderSecondBarrier;
        }
        if (barrierCount === 3) {
          noteNewerFirstBarrierStarted();
          await newerFirstBarrier;
        }
        if (barrierCount === 4) restartBoundary = structuredClone(target);
      }),
      getBrowserTransportDeps: () => makeIngressDeps(route),
      releasePendingTransfer: vi.fn(),
    };
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const olderRelease = releaseCodexAutoPausedInputs(session as any, 100, deps as any);
    queueCodexAutoPausedInput(
      session as any,
      "programmatic",
      {
        type: "user_message",
        content: "held event",
        agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
      },
      150,
    );
    releaseFirstBarrier();
    await olderSecondBarrierStarted;

    const newerPausedAt = session.state.codex_result_error_auto_pause?.pausedAt;
    expect(newerPausedAt).toBeTypeOf("number");
    expect(newerPausedAt).not.toBe(100);
    const newerRelease = releaseCodexAutoPausedInputs(session as any, newerPausedAt!, deps as any);
    await newerFirstBarrierStarted;
    const newerAcceptedAt = session.state.codex_result_error_auto_pause?.releaseProgress?.acceptedAt;
    expect(newerAcceptedAt).toBeTypeOf("number");

    rejectOlderSecondBarrier(new Error("older source-removal barrier failed"));
    await expect(olderRelease).resolves.toBe("accepted");

    expect(session.state.codex_result_error_auto_pause?.pausedAt).toBe(newerPausedAt);
    expect(session.state.codex_result_error_auto_pause?.releaseProgress).toEqual({
      status: "releasing",
      acceptedAt: newerAcceptedAt,
    });

    expect(routedCounts).toEqual([]);
    expect(session.pendingCodexInputs).toEqual([]);
    expect(session.state.codex_result_error_auto_pause?.heldInputs.reduce((total, item) => total + item.count, 0)).toBe(
      2,
    );

    releaseNewerFirstBarrier();
    await expect(newerRelease).resolves.toBe("accepted");
    const finalPause = session.state.codex_result_error_auto_pause;
    expect(finalPause).not.toBeNull();
    expect(finalPause!.pausedAt).not.toBe(newerPausedAt);
    expect(finalPause!.releaseProgress).toBeUndefined();
    expect(finalPause!.heldInputs.reduce((total, item) => total + item.count, 0)).toBe(2);
    expect(routedCounts).toEqual([]);

    await expect(releaseCodexAutoPausedInputs(session as any, finalPause!.pausedAt!, deps as any)).resolves.toBe(
      "accepted",
    );
    expect(routedCounts).toEqual([2]);
    expect(session.pendingCodexInputs).toHaveLength(1);
    expect(session.state.codex_result_error_auto_pause).toBeNull();
    expect(session.recoveryDeliveryTransfers).toEqual([]);
    expectEveryReleasedReceiptOwned(session);

    // Restart from the durable overlap where B is accepted, A has re-held,
    // and both immutable transfers still exist. Resume must not expand that
    // snapshot into a third logical delivery.
    expect(restartBoundary).not.toBeNull();
    const boundary = restartBoundary!;
    const restored = makeSession();
    restored.state = boundary.state;
    restored.messageHistory = boundary.messageHistory;
    restored.pendingCodexInputs = boundary.pendingCodexInputs;
    restored.pendingCodexTurns = boundary.pendingCodexTurns;
    restored.recoveryDeliveryTransfers = normalizePersistedRecoveryDeliveryTransfers(
      boundary.recoveryDeliveryTransfers,
    );
    const restoredRoutedCounts: number[] = [];
    const restoredRoute = vi.fn((target: BrowserTransportSessionLike, message: BrowserOutgoingMessage) => {
      if (message.type !== "user_message") return;
      const coalesced = message.content.match(/auto-pause resumed: (\d+) similar automatic inputs/)?.[1];
      restoredRoutedCounts.push(coalesced ? Number(coalesced) : 1);
      target.pendingCodexInputs.push({
        id: `pending-restored-overlap-${restoredRoutedCounts.length}`,
        content: message.content,
        timestamp: 280 + restoredRoutedCounts.length,
        cancelable: true,
        autoPauseRecoveries: message.autoPauseRecoveries,
      } as any);
    });
    const restoredPersistImmediately = vi.fn(async () => {});
    const restoredDeps = {
      broadcastToBrowsers: vi.fn(),
      persistSession: vi.fn(),
      persistSessionImmediately: restoredPersistImmediately,
      getBrowserTransportDeps: () => makeIngressDeps(restoredRoute),
      releasePendingTransfer: vi.fn(),
    };

    await resumeRecoveryDeliveryTransfers(restored as any, restoredDeps as any);
    expect(restoredRoutedCounts).toEqual([]);
    expect(restored.recoveryDeliveryTransfers).toEqual([]);
    expect(restored.state.codex_result_error_auto_pause?.releaseProgress).toBeUndefined();
    expect(
      restored.state.codex_result_error_auto_pause?.heldInputs.reduce((total, item) => total + item.count, 0),
    ).toBe(2);
    expectEveryReleasedReceiptOwned(restored);

    const persistedAfterResume = restoredPersistImmediately.mock.calls.length;
    await resumeRecoveryDeliveryTransfers(restored as any, restoredDeps as any);
    expect(restoredPersistImmediately).toHaveBeenCalledTimes(persistedAfterResume);

    const restoredPause = restored.state.codex_result_error_auto_pause;
    expect(restoredPause).not.toBeNull();
    await expect(
      releaseCodexAutoPausedInputs(restored as any, restoredPause!.pausedAt!, restoredDeps as any),
    ).resolves.toBe("accepted");
    expect(restoredRoutedCounts).toEqual([2]);
    expect(restored.pendingCodexInputs).toHaveLength(1);
    expect(restored.state.codex_result_error_auto_pause).toBeNull();
    expect(restored.recoveryDeliveryTransfers).toEqual([]);
    expectEveryReleasedReceiptOwned(restored);
  });

  it("durably clears an empty pause before reporting the explicit release complete", async () => {
    const session = makeSession();
    session.state.codex_result_error_auto_pause!.heldInputs = [];
    const persistSessionImmediately = vi.fn(async () => {});
    const persistSession = vi.fn();

    await expect(
      releaseCodexAutoPausedInputs(session as any, 100, {
        broadcastToBrowsers: vi.fn(),
        broadcastPendingCodexInputs: vi.fn(),
        persistSession,
        persistSessionImmediately,
        getBrowserTransportDeps: () => makeIngressDeps(),
        releasePendingTransfer: vi.fn(),
      } as any),
    ).resolves.toBe("accepted");

    expect(session.state.codex_result_error_auto_pause).toBeNull();
    expect(persistSessionImmediately).toHaveBeenCalledOnce();
    expect(persistSession).not.toHaveBeenCalled();
  });

  it("stops an in-flight release when its session is removed", async () => {
    const session = makeSession();
    let current = true;
    let releaseBarrier!: () => void;
    const barrier = new Promise<void>((resolve) => {
      releaseBarrier = resolve;
    });
    const route = vi.fn();
    const releasePendingTransfer = vi.fn();
    const persistSession = vi.fn();
    let persistenceCalls = 0;
    const release = releaseCodexAutoPausedInputs(session as any, 100, {
      isCurrentSession: () => current,
      broadcastToBrowsers: vi.fn(),
      broadcastPendingCodexInputs: vi.fn(),
      persistSession,
      persistSessionImmediately: vi.fn(async () => {
        persistenceCalls += 1;
        if (persistenceCalls === 1) await barrier;
      }),
      getBrowserTransportDeps: () => makeIngressDeps(route),
      releasePendingTransfer,
    } as any);

    current = false;
    releaseBarrier();
    await expect(release).resolves.toBe("accepted");

    expect(route).not.toHaveBeenCalled();
    expect(releasePendingTransfer).not.toHaveBeenCalled();
    expect(persistSession).not.toHaveBeenCalled();
  });

  it("removes a store write that finishes after the session stops being current", async () => {
    const session = Object.assign(makeSession(), {
      toolResults: new Map(),
      pendingMessages: [],
      forceCompactPending: false,
      board: new Map(),
      completedBoard: new Map(),
      keywords: [],
      contextUsageHistory: [],
    });
    const sessions = new Map([[session.id, session]]);
    const remove = vi.fn();
    const host = {
      sessions,
      store: {
        saveImmediate: vi.fn(async () => {
          sessions.delete(session.id);
        }),
        remove,
      },
    };
    const transferDeps = getRecoveryDeliveryTransferDepsForBridge(host);

    await expect(transferDeps.persistSessionImmediately(session as any)).rejects.toThrow(
      "Session was removed while recovery delivery state was being saved.",
    );
    expect(remove).toHaveBeenCalledWith(session.id);
  });

  it("does not recreate the released epoch when its first delivery is rejected", async () => {
    const session = makeSession();
    const route = vi.fn(() => {
      throw new Error("delivery unavailable");
    });
    const deps = {
      broadcastToBrowsers: vi.fn(),
      broadcastPendingCodexInputs: vi.fn(),
      persistSession: vi.fn(),
      persistSessionImmediately: vi.fn(async () => {}),
      getBrowserTransportDeps: () => makeIngressDeps(route),
      releasePendingTransfer: vi.fn(),
    };
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(releaseCodexAutoPausedInputs(session as any, 100, deps as any)).resolves.toBe("accepted");

    expect(route).toHaveBeenCalledTimes(1);
    expect(session.state.codex_result_error_auto_pause).toBeNull();
    expect(session.recoveryDeliveryTransfers).toEqual([]);
    expect(recoveryReceipt(session).receipt).toMatchObject({
      outcome: "failed",
      reasonCode: "delivery_pipeline_rejected",
    });
  });
  it("uses the existing exact-once handoff after the matching automatic provider-recovery owner succeeds", async () => {
    const session = makeSession();
    const autoPause = session.state.codex_result_error_auto_pause!;
    autoPause.family = "model_backend_stream_error";
    autoPause.fingerprint = "model_backend_stream_error:responses";
    autoPause.lastError = "Model backend stream disconnected before completion.";

    const route = vi.fn((target: BrowserTransportSessionLike, routed: BrowserOutgoingMessage) => {
      if (routed.type !== "user_message") return;
      target.pendingCodexInputs.push({
        id: "released-held-group",
        content: routed.content,
        timestamp: 200,
        cancelable: true,
        autoPauseRecoveries: routed.autoPauseRecoveries,
      } as any);
    });
    const { broadcastToBrowsers } = await releaseHeldInput(session, () => makeIngressDeps(route), undefined, {
      autoPauseSourceKind: "automatic",
      turnTarget: "current",
      autoPauseRecoveryTestingRetired: false,
      providerRecoveryAttempts: 151,
      providerRecoveryFamily: "model_backend_stream_error",
    });

    expect(session.state.codex_result_error_auto_pause).toBeNull();
    expect(
      session.messageHistory.filter((message) => message.type === "codex_auto_pause_recovery_summary"),
    ).toHaveLength(1);
    expect(recoveryReceipt(session).receipt).toMatchObject({
      groupId: "held-group",
      outcome: "released_to_delivery",
    });
    expect(broadcastToBrowsers).toHaveBeenCalledWith(session, {
      type: "session_update",
      session: expect.objectContaining({ codex_result_error_auto_pause: null }),
    });
    expectEveryReleasedReceiptOwned(session);
  });

  it("terminalizes an archived read-only no-op instead of leaving a released receipt ownerless", async () => {
    const session = makeSession();

    await releaseHeldInput(session, () => makeIngressDeps(vi.fn(), true));

    expect(recoveryReceipt(session).receipt).toMatchObject({
      outcome: "failed",
      reasonCode: "delivery_pipeline_rejected",
    });
    expect(session.pendingCodexInputs).toHaveLength(0);
    expectEveryReleasedReceiptOwned(session);
  });

  it("terminalizes a swallowed routing rejection and keeps repeated result callbacks idempotent", async () => {
    const session = makeSession();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const route = vi.fn(async () => {
      throw new Error("routing failed");
    });

    await releaseHeldInput(session, () => makeIngressDeps(route));
    await releaseHeldInput(session, () => makeIngressDeps(route));

    expect(recoveryReceipt(session).receipt).toMatchObject({
      outcome: "failed",
      reasonCode: "delivery_pipeline_rejected",
    });
    expect(
      session.messageHistory.filter((message) => message.type === "codex_auto_pause_recovery_summary"),
    ).toHaveLength(1);
    expect(route).toHaveBeenCalledTimes(1);
    expectEveryReleasedReceiptOwned(session);
  });

  it("retains manual-pause queue ownership without falsely failing the released group", async () => {
    const session = makeSession();

    await releaseHeldInput(session, () => {
      session.state.pause = { pausedAt: 200, queuedMessages: [] };
      return makeIngressDeps();
    });

    const { summary, receipt } = recoveryReceipt(session);
    expect(receipt.outcome).toBe("released_to_delivery");
    expect(session.state.pause?.queuedMessages[0]?.message.autoPauseRecoveries).toEqual([
      { summaryId: summary.id, groupId: receipt.groupId },
    ]);
    expectEveryReleasedReceiptOwned(session);
  });

  it("retains renewed auto-pause ownership without falsely failing the released group", async () => {
    const session = makeSession();

    await releaseHeldInput(session, () => {
      session.state.codex_result_error_auto_pause = {
        family: "copilot_auth_refresh_exhausted",
        fingerprint: "copilot_auth_refresh_exhausted:github_copilot",
        streak: 1,
        threshold: 1,
        pausedAt: 300,
        lastError: "GitHub Copilot API-key refresh exhausted its retry budget.",
        lastErrorAt: 300,
        lastSourceKind: "automatic",
        totalMatchingErrors: 1,
        heldInputs: [],
      };
      return makeIngressDeps();
    });

    const { summary, receipt } = recoveryReceipt(session);
    expect(receipt.outcome).toBe("released_to_delivery");
    expect(session.state.codex_result_error_auto_pause?.heldInputs[0]?.message.autoPauseRecoveries).toEqual([
      { summaryId: summary.id, groupId: receipt.groupId },
    ]);
    expectEveryReleasedReceiptOwned(session);
  });

  it("selectively transfers captured groups while concurrent arrivals and coalescing remain paused", async () => {
    const session = makeSession();
    const route = vi.fn((target: BrowserTransportSessionLike, routed: BrowserOutgoingMessage) => {
      if (routed.type !== "user_message") return;
      target.pendingCodexInputs.push({
        id: `pending-${target.pendingCodexInputs.length + 1}`,
        content: routed.content,
        timestamp: 350,
        cancelable: true,
        autoPauseRecoveries: routed.autoPauseRecoveries,
      } as any);
    });

    const first = await releaseHeldInput(
      session,
      () => makeIngressDeps(route),
      () => {
        queueCodexAutoPausedInput(
          session as any,
          "programmatic",
          {
            type: "user_message",
            content: "held event",
            agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
          },
          201,
        );
        queueCodexAutoPausedInput(
          session as any,
          "programmatic",
          {
            type: "user_message",
            content: "held event",
            agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
          },
          202,
        );
        queueCodexAutoPausedInput(
          session as any,
          "programmatic",
          { type: "user_message", content: "timer newcomer", agentSource: { sessionId: "timer:new" } },
          203,
        );
      },
    );

    expect(session.pendingCodexInputs).toHaveLength(0);
    expect(session.state.codex_result_error_auto_pause?.heldInputs).toHaveLength(3);
    expect(session.state.codex_result_error_auto_pause?.heldInputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: expect.stringContaining("retained-"), count: 2 }),
        expect.objectContaining({ message: expect.objectContaining({ content: "timer newcomer" }), count: 1 }),
        expect.objectContaining({
          message: expect.objectContaining({ autoPauseRecoveries: expect.any(Array) }),
          count: 1,
        }),
      ]),
    );
    expect(first.snapshots[1]?.state.codex_result_error_auto_pause?.heldInputs).toHaveLength(2);
    expect(first.broadcastToBrowsers).toHaveBeenCalledWith(
      session,
      expect.objectContaining({
        type: "session_update",
        session: expect.objectContaining({
          codex_result_error_auto_pause: expect.objectContaining({ heldInputs: expect.any(Array) }),
        }),
      }),
    );
    expectEveryReleasedReceiptOwned(session);

    await releaseHeldInput(session, () => makeIngressDeps(route));

    expect(session.state.codex_result_error_auto_pause).toBeNull();
    expect(session.pendingCodexInputs).toHaveLength(3);
    expect(route).toHaveBeenCalledTimes(3);
    expect(session.messageHistory.filter((entry) => entry.type === "codex_auto_pause_recovery_summary")).toHaveLength(
      2,
    );
    expectEveryReleasedReceiptOwned(session);
  });

  it.each([
    "barrier",
    "capacity",
  ] as const)("reconciles missing and coalesced receipts before retrying a failed %s handoff", async (failureMode) => {
    const session = makeSession();
    const route = vi.fn((target: BrowserTransportSessionLike, routed: BrowserOutgoingMessage) => {
      if (routed.type !== "user_message") return;
      target.pendingCodexInputs.push({
        id: `pending-retry-${target.pendingCodexInputs.length + 1}`,
        content: routed.content,
        timestamp: 360,
        cancelable: true,
        autoPauseRecoveries: routed.autoPauseRecoveries,
      } as any);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});

    if (failureMode === "capacity") {
      session.recoveryDeliveryTransfers = Array.from({ length: RECOVERY_DELIVERY_TRANSFER_MAX_COUNT }, (_, index) => ({
        id: `recovery-transfer-capacity-${index}`,
        createdAt: 1,
        sourceOwnerKind: "manual_pause" as const,
        sourceOwnerId: `capacity-owner-${index}`,
        sourceOwnerCount: 1,
        payloadBytes: 1,
        message: {
          type: "user_message" as const,
          content: "bounded unrelated transfer",
          autoPauseRecoveries: [{ summaryId: "unrelated-summary", groupId: `unrelated-${index}` }],
        },
      }));
    }

    await releaseHeldInput(
      session,
      () => makeIngressDeps(route),
      failureMode === "barrier"
        ? () => {
            throw new Error("first transfer barrier failed");
          }
        : undefined,
    );

    const firstSummary = recoveryReceipt(session).summary;
    expect(session.state.codex_result_error_auto_pause?.heldInputs).toHaveLength(1);
    expect(session.recoveryDeliveryTransfers).toHaveLength(
      failureMode === "barrier" ? 1 : RECOVERY_DELIVERY_TRANSFER_MAX_COUNT,
    );
    expect(firstSummary.recovery.receipts).toHaveLength(1);
    expect(route).not.toHaveBeenCalled();
    if (failureMode === "capacity") session.recoveryDeliveryTransfers = [];

    queueCodexAutoPausedInput(
      session as any,
      "programmatic",
      {
        type: "user_message",
        content: "held event",
        agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
      },
      201,
    );
    const distinct = queueCodexAutoPausedInput(
      session as any,
      "programmatic",
      {
        type: "user_message",
        content: "retry timer private payload",
        agentSource: { sessionId: "timer:retry", sessionLabel: "Retry timer" },
        threadKey: "q-retry",
        questId: "q-retry",
      },
      202,
    )!;

    await releaseHeldInput(session, () => makeIngressDeps(route));

    const summaries = session.messageHistory.filter((message) => message.type === "codex_auto_pause_recovery_summary");
    expect(summaries).toHaveLength(1);
    const summary = summaries[0]!;
    if (summary.type !== "codex_auto_pause_recovery_summary") throw new Error("missing retry summary");
    expect(summary.recovery.receipts).toHaveLength(2);
    expect(new Set(summary.recovery.receipts.map((receipt) => receipt.groupId)).size).toBe(2);
    expect(summary.recovery.receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ groupId: "held-group", count: 2, coalescedCount: 1 }),
        expect.objectContaining({ groupId: distinct.id, count: 1, sourceLabel: "Timer" }),
      ]),
    );
    expect(session.state.codex_result_error_auto_pause).toBeNull();
    expect(session.recoveryDeliveryTransfers).toEqual([]);
    expect(session.pendingCodexInputs).toHaveLength(2);
    expect(route).toHaveBeenCalledTimes(2);
    for (const link of session.pendingCodexInputs.flatMap((input) => input.autoPauseRecoveries ?? [])) {
      expect(summary.recovery.receipts.filter((receipt) => receipt.groupId === link.groupId)).toHaveLength(1);
    }
    expect(JSON.stringify(summary)).not.toContain("retry timer private payload");
    expect(JSON.stringify(summary)).not.toContain("recovery-transfer-");
    expectEveryReleasedReceiptOwned(session);

    const links = session.pendingCodexInputs.flatMap((input) => input.autoPauseRecoveries ?? []);
    expect(markCodexAutoPauseRecoveryDelivered(session, links, 370, { broadcastToBrowsers: vi.fn() })).toBe(true);
    const settled = structuredClone(summary.recovery.receipts);
    expect(markCodexAutoPauseRecoveryDelivered(session, links, 380, { broadcastToBrowsers: vi.fn() })).toBe(false);
    expect(summary.recovery.receipts).toEqual(settled);

    await releaseHeldInput(session, () => makeIngressDeps(route));
    expect(route).toHaveBeenCalledTimes(2);
    expect(
      session.messageHistory.filter((message) => message.type === "codex_auto_pause_recovery_summary"),
    ).toHaveLength(1);
  });

  it("reconciles failed and retried handoff boundaries across restart without duplicate delivery", async () => {
    const session = makeSession();
    const route = vi.fn((target: BrowserTransportSessionLike, routed: BrowserOutgoingMessage) => {
      if (routed.type !== "user_message") return;
      target.pendingCodexInputs.push({
        id: `pending-restored-retry-${target.pendingCodexInputs.length + 1}`,
        content: routed.content,
        timestamp: 390,
        cancelable: true,
        autoPauseRecoveries: routed.autoPauseRecoveries,
      } as any);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await releaseHeldInput(
      session,
      () => makeIngressDeps(route),
      () => {
        throw new Error("persisted overlap barrier failed");
      },
    );
    queueCodexAutoPausedInput(
      session as any,
      "programmatic",
      {
        type: "user_message",
        content: "held event",
        agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
      },
      301,
    );
    queueCodexAutoPausedInput(
      session as any,
      "programmatic",
      {
        type: "user_message",
        content: "restored distinct private payload",
        agentSource: { sessionId: "timer:restored" },
      },
      302,
    );

    const dir = mkdtempSync(join(tmpdir(), "takode-drain-retry-"));
    tempDirs.push(dir);
    const store = new SessionStore(dir);
    await store.saveImmediate({
      id: session.id,
      state: { ...session.state, session_id: session.id },
      messageHistory: session.messageHistory,
      pendingMessages: [],
      pendingPermissions: [],
      pendingCodexInputs: session.pendingCodexInputs,
      pendingCodexTurns: session.pendingCodexTurns,
      recoveryDeliveryTransfers: session.recoveryDeliveryTransfers,
    } as unknown as PersistedSession);
    const failedBoundary = (await store.load(session.id))!;
    const restored = makeSession();
    restored.state = failedBoundary.state;
    restored.messageHistory = failedBoundary.messageHistory;
    restored.pendingCodexInputs = failedBoundary.pendingCodexInputs ?? [];
    restored.pendingCodexTurns = failedBoundary.pendingCodexTurns ?? [];
    restored.recoveryDeliveryTransfers = normalizePersistedRecoveryDeliveryTransfers(
      failedBoundary.recoveryDeliveryTransfers,
    );

    await resumeRecoveryDeliveryTransfers(restored as any, {
      broadcastToBrowsers: vi.fn(),
      persistSession: vi.fn(),
      persistSessionImmediately: vi.fn(async () => {}),
      getBrowserTransportDeps: () => makeIngressDeps(route),
      releasePendingTransfer: vi.fn(),
    });

    const afterResume = recoveryReceipt(restored);
    expect(afterResume.receipt).toMatchObject({ groupId: "held-group", count: 2, coalescedCount: 1 });
    expect(restored.recoveryDeliveryTransfers).toEqual([]);
    expect(route).toHaveBeenCalledTimes(2);
    expect(restored.pendingCodexInputs).toHaveLength(2);

    const summaries = restored.messageHistory.filter((message) => message.type === "codex_auto_pause_recovery_summary");
    expect(summaries).toHaveLength(1);
    const summary = summaries[0]!;
    if (summary.type !== "codex_auto_pause_recovery_summary") throw new Error("missing restored retry summary");
    expect(new Set(summary.recovery.receipts.map((receipt) => receipt.groupId)).size).toBe(
      summary.recovery.receipts.length,
    );
    expect(restored.recoveryDeliveryTransfers).toEqual([]);
    for (const link of restored.pendingCodexInputs.flatMap((input) => input.autoPauseRecoveries ?? [])) {
      expect(summary.recovery.receipts.filter((receipt) => receipt.groupId === link.groupId)).toHaveLength(1);
    }
    expect(JSON.stringify(summary)).not.toContain("restored distinct private payload");
    expectEveryReleasedReceiptOwned(restored);

    await releaseHeldInput(restored, () => makeIngressDeps(route));
    expect(route).toHaveBeenCalledTimes(2);

    const links = restored.pendingCodexInputs.flatMap((input) => input.autoPauseRecoveries ?? []);
    expect(markCodexAutoPauseRecoveryDelivered(restored, links, 400, { broadcastToBrowsers: vi.fn() })).toBe(true);
    const terminalReceipts = structuredClone(summary.recovery.receipts);
    expect(markCodexAutoPauseRecoveryDelivered(restored, links, 410, { broadcastToBrowsers: vi.fn() })).toBe(false);
    expect(summary.recovery.receipts).toEqual(terminalReceipts);

    await store.saveImmediate({
      id: restored.id,
      state: { ...restored.state, session_id: restored.id },
      messageHistory: restored.messageHistory,
      pendingMessages: [],
      pendingPermissions: [],
      pendingCodexInputs: restored.pendingCodexInputs,
      pendingCodexTurns: restored.pendingCodexTurns,
      recoveryDeliveryTransfers: restored.recoveryDeliveryTransfers,
    } as unknown as PersistedSession);
    const retriedBoundary = (await store.load(restored.id))!;
    const replayed = makeSession();
    replayed.state = retriedBoundary.state;
    replayed.messageHistory = retriedBoundary.messageHistory;
    replayed.pendingCodexInputs = retriedBoundary.pendingCodexInputs ?? [];
    replayed.pendingCodexTurns = retriedBoundary.pendingCodexTurns ?? [];
    replayed.recoveryDeliveryTransfers = normalizePersistedRecoveryDeliveryTransfers(
      retriedBoundary.recoveryDeliveryTransfers,
    );
    await resumeRecoveryDeliveryTransfers(replayed as any, {
      broadcastToBrowsers: vi.fn(),
      persistSession: vi.fn(),
      persistSessionImmediately: vi.fn(async () => {}),
      getBrowserTransportDeps: () => makeIngressDeps(route),
      releasePendingTransfer: vi.fn(),
    });
    await releaseHeldInput(replayed, () => makeIngressDeps(route));
    expect(route).toHaveBeenCalledTimes(2);
    expect(
      replayed.messageHistory.filter((message) => message.type === "codex_auto_pause_recovery_summary"),
    ).toHaveLength(1);
  });

  it("persists normal pending ownership with its released receipt across restart", async () => {
    const session = makeSession();
    const route = vi.fn((target: BrowserTransportSessionLike, message: BrowserOutgoingMessage) => {
      if (message.type !== "user_message") return;
      target.pendingCodexInputs.push({
        id: "pending-released",
        content: message.content,
        timestamp: 400,
        cancelable: true,
        autoPauseRecoveries: message.autoPauseRecoveries,
      } as any);
    });
    const boundary = await releaseHeldInput(session, () => makeIngressDeps(route));
    await releaseHeldInput(session, () =>
      makeIngressDeps((target, message: BrowserOutgoingMessage) => {
        if (message.type !== "user_message") return;
        target.pendingCodexInputs.push({
          id: "duplicate-pending",
          content: message.content,
          timestamp: 400,
          cancelable: true,
          autoPauseRecoveries: message.autoPauseRecoveries,
        } as any);
      }),
    );
    const { summary, receipt } = recoveryReceipt(session);
    expect(receipt.outcome).toBe("released_to_delivery");
    expect(route).toHaveBeenCalledTimes(1);
    expect(session.pendingCodexInputs).toHaveLength(1);
    expect(session.pendingCodexInputs[0]?.autoPauseRecoveries).toEqual([
      { summaryId: summary.id, groupId: receipt.groupId },
    ]);
    expect(boundary.snapshots).toHaveLength(4);
    expect(boundary.snapshots[0]).toMatchObject({
      state: { codex_result_error_auto_pause: { heldInputs: [{ id: "held-group" }] } },
      recoveryDeliveryTransfers: [{ sourceOwnerId: "held-group" }],
      messageHistory: [expect.objectContaining({ type: "codex_auto_pause_recovery_summary" })],
    });
    expect(boundary.snapshots[1]).toMatchObject({
      state: { codex_result_error_auto_pause: null },
      recoveryDeliveryTransfers: [{ sourceOwnerId: "held-group" }],
    });
    expect(boundary.snapshots[2]).toMatchObject({
      pendingCodexInputs: [
        expect.objectContaining({
          autoPauseRecoveries: [{ summaryId: summary.id, groupId: receipt.groupId }],
        }),
      ],
      recoveryDeliveryTransfers: [{ sourceOwnerId: "held-group" }],
    });
    expect(boundary.snapshots[3]).toMatchObject({
      pendingCodexInputs: [expect.any(Object)],
      recoveryDeliveryTransfers: [],
    });
    expectEveryReleasedReceiptOwned(session);

    const dir = mkdtempSync(join(tmpdir(), "takode-drain-ownership-"));
    tempDirs.push(dir);
    const store = new SessionStore(dir);
    store.saveSync({
      id: session.id,
      state: { ...session.state, session_id: session.id },
      messageHistory: session.messageHistory,
      pendingMessages: [],
      pendingPermissions: [],
      pendingCodexInputs: session.pendingCodexInputs,
      pendingCodexTurns: session.pendingCodexTurns,
    } as unknown as PersistedSession);
    await store.flushAll();

    const restored = await store.load(session.id);
    const restoredSummary = restored?.messageHistory.find(
      (message) => message.type === "codex_auto_pause_recovery_summary",
    );
    expect(restored?.pendingCodexInputs?.[0]?.autoPauseRecoveries).toEqual([
      { summaryId: summary.id, groupId: receipt.groupId },
    ]);
    expect(restoredSummary?.type).toBe("codex_auto_pause_recovery_summary");
    if (restoredSummary?.type === "codex_auto_pause_recovery_summary") {
      expect(restoredSummary.recovery.receipts[0]?.outcome).toBe("released_to_delivery");
    }
  });
});
