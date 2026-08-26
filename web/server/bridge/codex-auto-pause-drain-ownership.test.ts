import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionStore, type PersistedSession } from "../session-store.js";
import type { BrowserOutgoingMessage } from "../session-types.js";
import { queueCodexAutoPausedInput } from "../codex-result-error-auto-pause.js";
import { handleCodexResultErrorAutoPause } from "./codex-result-error-auto-pause-delivery.js";
import { markCodexAutoPauseRecoveryDelivered } from "./codex-auto-pause-recovery-summary.js";
import {
  normalizePersistedRecoveryDeliveryTransfers,
  RECOVERY_DELIVERY_TRANSFER_MAX_COUNT,
  resumeRecoveryDeliveryTransfers,
} from "./recovery-delivery-transfer.js";
import type { BrowserTransportDeps, BrowserTransportSessionLike } from "./browser-transport-controller.js";

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
    { autoPauseSourceKind: "manual", turnTarget: "current", autoPauseRecoveryTestingRetired: false } as any,
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
