import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SessionStore, type PersistedSession } from "../session-store.js";
import type { BrowserIncomingMessage, BrowserOutgoingMessage, CodexAutoPauseRecoveryLink } from "../session-types.js";
import type { BrowserTransportDeps, BrowserTransportSessionLike } from "./browser-transport-controller.js";
import {
  beginRecoveryDeliveryTransferHandoff,
  deliverRecoveryDeliveryTransfer,
  normalizePersistedRecoveryDeliveryTransfers,
  RECOVERY_DELIVERY_TRANSFER_MAX_COUNT,
  resumeRecoveryDeliveryTransfers,
  type RecoveryDeliveryTransferCandidate,
  type RecoveryDeliveryTransferDeps,
  type RecoveryDeliveryTransferSessionLike,
} from "./recovery-delivery-transfer.js";

const tempDirs: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function link(groupId = "group-1"): CodexAutoPauseRecoveryLink {
  return { summaryId: "summary-1", groupId };
}

function messageFor(groupId = "group-1", content = `private payload ${groupId}`) {
  return {
    type: "user_message" as const,
    content,
    agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
    threadKey: "q-test",
    questId: "q-test",
    autoPauseRecoveries: [link(groupId)],
  };
}

function summary(groups: string[]): BrowserIncomingMessage {
  return {
    type: "codex_auto_pause_recovery_summary",
    id: "summary-1",
    timestamp: 10,
    content: `Automatic input recovery: ${groups.length} awaiting delivery.`,
    searchText: "automatic input recovery released_to_delivery",
    recovery: {
      family: "copilot_auth_refresh_exhausted",
      pausedAt: 1,
      recoveryConfirmedAt: 10,
      updatedAt: 10,
      status: "releasing",
      receipts: groups.map((groupId, index) => ({
        groupId,
        source: "programmatic",
        sourceLabel: "Herd Events",
        count: 1,
        coalescedCount: 0,
        queuedAt: 2 + index,
        lastQueuedAt: 2 + index,
        releasedAt: 10,
        outcome: "released_to_delivery",
        reasonCode: "manual_recovery_succeeded",
        reason: "Manual recovery succeeded; queued for exact-once delivery.",
      })),
    },
  } as BrowserIncomingMessage;
}

function makeSession(groups = ["group-1"]): RecoveryDeliveryTransferSessionLike {
  return {
    id: "transfer-session",
    backendType: "codex",
    browserSockets: new Set(),
    messageHistory: [summary(groups)],
    frozenCount: 0,
    state: {
      permissionMode: "default",
      codex_result_error_auto_pause: {
        family: "copilot_auth_refresh_exhausted",
        fingerprint: "copilot_auth_refresh_exhausted:github_copilot",
        streak: 1,
        threshold: 1,
        pausedAt: 1,
        lastError: "GitHub Copilot API-key refresh exhausted its retry budget.",
        lastErrorAt: 1,
        lastSourceKind: "automatic",
        totalMatchingErrors: 1,
        heldInputs: groups.map((groupId, index) => ({
          id: `held-${index + 1}`,
          queuedAt: 2 + index,
          lastQueuedAt: 2 + index,
          source: "programmatic",
          count: 1,
          message: messageFor(groupId),
        })),
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

function candidates(session: RecoveryDeliveryTransferSessionLike): RecoveryDeliveryTransferCandidate[] {
  return (session.state.codex_result_error_auto_pause?.heldInputs ?? []).map((held) => ({
    sourceOwnerKind: "auto_pause",
    sourceOwnerId: held.id,
    sourceOwnerCount: held.count,
    message: held.message,
  }));
}

function makeIngressDeps(route: BrowserTransportDeps["routeBrowserMessage"] = vi.fn()): BrowserTransportDeps {
  return {
    getLauncherSessionInfo: vi.fn(() => ({ archived: false, state: "connected", backendType: "codex" as const })),
    getRouteChain: vi.fn(() => undefined),
    setRouteChain: vi.fn(),
    clearRouteChain: vi.fn(),
    routeBrowserMessage: route,
    touchActivity: vi.fn(),
    persistSession: vi.fn(),
    broadcastToBrowsers: vi.fn(),
    broadcastError: vi.fn(),
    notifyImageSendFailure: vi.fn(),
    idempotentMessageTypes: new Set(),
    processedClientMsgIdLimit: 100,
  } as unknown as BrowserTransportDeps;
}

function makeDeps(
  snapshots: RecoveryDeliveryTransferSessionLike[],
  route: BrowserTransportDeps["routeBrowserMessage"] = vi.fn(),
): RecoveryDeliveryTransferDeps {
  return {
    broadcastToBrowsers: vi.fn(),
    persistSession: vi.fn(),
    persistSessionImmediately: vi.fn(async (session: RecoveryDeliveryTransferSessionLike) => {
      snapshots.push(structuredClone(session));
    }),
    getBrowserTransportDeps: () => makeIngressDeps(route),
    releasePendingTransfer: vi.fn(),
  };
}

function receiptOutcome(session: RecoveryDeliveryTransferSessionLike, groupId = "group-1") {
  const entry = session.messageHistory.find((item) => item.type === "codex_auto_pause_recovery_summary");
  if (entry?.type !== "codex_auto_pause_recovery_summary") throw new Error("missing summary");
  return entry.recovery.receipts.find((item) => item.groupId === groupId)?.outcome;
}

function effectiveOwnerCount(session: RecoveryDeliveryTransferSessionLike, target: CodexAutoPauseRecoveryLink): number {
  const transferOwns = session.recoveryDeliveryTransfers.some((entry) =>
    entry.message.autoPauseRecoveries?.some(
      (item) => item.summaryId === target.summaryId && item.groupId === target.groupId,
    ),
  );
  // Transfer ownership takes precedence while old/new owners coexist.
  if (transferOwns) return 1;
  const pendingOwns = [
    ...session.pendingCodexInputs.flatMap((input) => input.autoPauseRecoveries ?? []),
    ...session.pendingCodexTurns.flatMap((turn) => turn.autoPauseRecoveryLinks ?? []),
  ].some((item) => item.summaryId === target.summaryId && item.groupId === target.groupId);
  const manualOwns = (session.state.pause?.queuedMessages ?? []).some((queued) =>
    queued.message.autoPauseRecoveries?.some(
      (item) => item.summaryId === target.summaryId && item.groupId === target.groupId,
    ),
  );
  const autoOwns = (session.state.codex_result_error_auto_pause?.heldInputs ?? []).some((held) =>
    held.message.autoPauseRecoveries?.some(
      (item) => item.summaryId === target.summaryId && item.groupId === target.groupId,
    ),
  );
  return Number(pendingOwns) + Number(manualOwns) + Number(autoOwns);
}

function expectOwnedOrTerminal(session: RecoveryDeliveryTransferSessionLike, groupId = "group-1"): void {
  const outcome = receiptOutcome(session, groupId);
  if (outcome === "released_to_delivery") {
    expect(effectiveOwnerCount(session, link(groupId)), `owner for ${groupId}`).toBe(1);
  } else {
    expect(outcome).toBeTruthy();
  }
}

function persisted(session: RecoveryDeliveryTransferSessionLike): PersistedSession {
  return {
    id: session.id,
    state: session.state,
    messageHistory: session.messageHistory,
    pendingMessages: [],
    pendingPermissions: [],
    pendingCodexInputs: session.pendingCodexInputs,
    pendingCodexTurns: session.pendingCodexTurns,
    recoveryDeliveryTransfers: session.recoveryDeliveryTransfers,
  } as unknown as PersistedSession;
}

describe("recovery delivery transfer ownership", () => {
  it("persists transfer precedence before removing the old owner", async () => {
    const session = makeSession();
    const snapshots: RecoveryDeliveryTransferSessionLike[] = [];
    const deps = makeDeps(snapshots);

    await beginRecoveryDeliveryTransferHandoff(session, candidates(session), {}, deps);

    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]?.recoveryDeliveryTransfers).toHaveLength(1);
    expect(snapshots[0]?.state.codex_result_error_auto_pause?.heldInputs).toHaveLength(1);
    expect(snapshots[1]?.state.codex_result_error_auto_pause).toBeNull();
    for (const snapshot of snapshots) expectOwnedOrTerminal(snapshot);
    expectOwnedOrTerminal(session);
  });

  it("retains transfer ownership through delayed ingress, then persists pending before cleanup", async () => {
    const session = makeSession();
    const snapshots: RecoveryDeliveryTransferSessionLike[] = [];
    let releaseRoute!: () => void;
    const routeGate = new Promise<void>((resolve) => {
      releaseRoute = resolve;
    });
    const route = vi.fn(async (target: BrowserTransportSessionLike, routed: BrowserOutgoingMessage) => {
      await routeGate;
      if (routed.type !== "user_message") return;
      target.pendingCodexInputs.push({
        id: "pending-1",
        content: routed.content,
        timestamp: 20,
        cancelable: true,
        autoPauseRecoveries: routed.autoPauseRecoveries,
      } as any);
    });
    const deps = makeDeps(snapshots, route);
    const transfers = await beginRecoveryDeliveryTransferHandoff(session, candidates(session), {}, deps);

    const delivering = deliverRecoveryDeliveryTransfer(session, transfers.get("held-1")!, deps);
    await Promise.resolve();
    expect(session.recoveryDeliveryTransfers).toHaveLength(1);
    expectOwnedOrTerminal(session);
    releaseRoute();
    await delivering;

    expect(route).toHaveBeenCalledTimes(1);
    expect(session.recoveryDeliveryTransfers).toHaveLength(0);
    expect(session.pendingCodexInputs).toHaveLength(1);
    expectOwnedOrTerminal(session);
    for (const snapshot of snapshots) expectOwnedOrTerminal(snapshot);
    expect(deps.releasePendingTransfer).toHaveBeenCalledTimes(1);
  });

  it("persists terminal rejection with transfer ownership before safe cleanup", async () => {
    const session = makeSession();
    const snapshots: RecoveryDeliveryTransferSessionLike[] = [];
    const deps = makeDeps(snapshots, vi.fn());
    const transfers = await beginRecoveryDeliveryTransferHandoff(session, candidates(session), {}, deps);

    await deliverRecoveryDeliveryTransfer(session, transfers.get("held-1")!, deps);

    expect(receiptOutcome(session)).toBe("failed");
    expect(session.recoveryDeliveryTransfers).toHaveLength(0);
    for (const snapshot of snapshots) expectOwnedOrTerminal(snapshot);
    expectOwnedOrTerminal(session);
    expect(deps.releasePendingTransfer).not.toHaveBeenCalled();
  });

  it.each([1, 25, 100])("drains %i transfers with bounded state and exact-once cleanup", async (count) => {
    const groups = Array.from({ length: count }, (_, index) => `group-${index + 1}`);
    const session = makeSession(groups);
    const snapshots: RecoveryDeliveryTransferSessionLike[] = [];
    const route = vi.fn((target: BrowserTransportSessionLike, routed: BrowserOutgoingMessage) => {
      if (routed.type !== "user_message") return;
      target.pendingCodexInputs.push({
        id: `pending-${target.pendingCodexInputs.length + 1}`,
        content: routed.content,
        timestamp: 30,
        cancelable: true,
        autoPauseRecoveries: routed.autoPauseRecoveries,
      } as any);
    });
    const deps = makeDeps(snapshots, route);
    const transfers = await beginRecoveryDeliveryTransferHandoff(session, candidates(session), {}, deps);
    expect(session.recoveryDeliveryTransfers).toHaveLength(count);

    let completed = 0;
    for (const transferId of transfers.values()) {
      await deliverRecoveryDeliveryTransfer(session, transferId, deps);
      completed += 1;
      expect(session.recoveryDeliveryTransfers).toHaveLength(count - completed);
    }

    expect(route).toHaveBeenCalledTimes(count);
    expect(session.pendingCodexInputs).toHaveLength(count);
    expect(session.recoveryDeliveryTransfers).toHaveLength(0);
    for (const groupId of groups) expectOwnedOrTerminal(session, groupId);
    for (const snapshot of snapshots) {
      for (const groupId of groups) expectOwnedOrTerminal(snapshot, groupId);
    }
  });

  it("keeps the source owner intact when bounded transfer capacity is exceeded", async () => {
    const groups = Array.from({ length: RECOVERY_DELIVERY_TRANSFER_MAX_COUNT + 1 }, (_, index) => `group-${index + 1}`);
    const session = makeSession(groups);
    const removeSource = vi.fn(() => {
      session.state.codex_result_error_auto_pause = null;
    });

    await expect(
      beginRecoveryDeliveryTransferHandoff(
        session,
        candidates(session),
        { onSourceOwnersRemoved: removeSource },
        {
          persistSessionImmediately: vi.fn(async () => {}),
        },
      ),
    ).rejects.toThrow("capacity exceeded");

    expect(removeSource).not.toHaveBeenCalled();
    expect(session.recoveryDeliveryTransfers).toHaveLength(0);
    expect(session.state.codex_result_error_auto_pause?.heldInputs).toHaveLength(groups.length);
  });

  it("restarts from an overlap snapshot without reconstructing payload from the summary", async () => {
    const session = makeSession();
    const dir = mkdtempSync(join(tmpdir(), "takode-recovery-transfer-"));
    tempDirs.push(dir);
    const store = new SessionStore(dir);
    let unblockFirstPersist!: () => void;
    const firstPersistGate = new Promise<void>((resolve) => {
      unblockFirstPersist = resolve;
    });
    let persistCalls = 0;
    const beginPromise = beginRecoveryDeliveryTransferHandoff(
      session,
      candidates(session),
      {},
      {
        persistSessionImmediately: async (target) => {
          persistCalls += 1;
          await store.saveImmediate(persisted(target));
          if (persistCalls === 1) await firstPersistGate;
        },
      },
    );
    await vi.waitFor(async () => {
      const onDisk = await store.load(session.id);
      expect(onDisk?.recoveryDeliveryTransfers).toHaveLength(1);
      expect(onDisk?.state.codex_result_error_auto_pause?.heldInputs).toHaveLength(1);
    });

    // Simulate restart from the first durable overlap snapshot.
    const overlap = (await store.load(session.id))!;
    expect(JSON.stringify(overlap.recoveryDeliveryTransfers)).not.toContain("recoveryDeliveryTransferId");
    const restored = makeSession();
    restored.state = overlap.state;
    restored.messageHistory = overlap.messageHistory;
    restored.pendingCodexInputs = overlap.pendingCodexInputs ?? [];
    restored.pendingCodexTurns = overlap.pendingCodexTurns ?? [];
    restored.recoveryDeliveryTransfers = normalizePersistedRecoveryDeliveryTransfers(overlap.recoveryDeliveryTransfers);
    const routedPayloads: string[] = [];
    const deps: RecoveryDeliveryTransferDeps = {
      broadcastToBrowsers: vi.fn(),
      persistSession: vi.fn(),
      persistSessionImmediately: async (target) => store.saveImmediate(persisted(target)),
      getBrowserTransportDeps: () =>
        makeIngressDeps((target: BrowserTransportSessionLike, routed: BrowserOutgoingMessage) => {
          if (routed.type !== "user_message") return;
          routedPayloads.push(routed.content);
          target.pendingCodexInputs.push({
            id: "restored-pending",
            content: routed.content,
            timestamp: 40,
            cancelable: true,
            autoPauseRecoveries: routed.autoPauseRecoveries,
          } as any);
        }),
      releasePendingTransfer: vi.fn(),
    };

    await resumeRecoveryDeliveryTransfers(restored, deps);
    await resumeRecoveryDeliveryTransfers(restored, deps);

    expect(routedPayloads).toEqual(["private payload group-1"]);
    expect(restored.recoveryDeliveryTransfers).toHaveLength(0);
    expect(restored.state.codex_result_error_auto_pause).toBeNull();
    expect(restored.pendingCodexInputs).toHaveLength(1);
    expect(JSON.stringify(restored.messageHistory)).not.toContain("private payload group-1");
    expectOwnedOrTerminal(restored);
    const finalDisk = await store.load(restored.id);
    expect(finalDisk?.recoveryDeliveryTransfers).toEqual([]);
    expect(finalDisk?.pendingCodexInputs).toHaveLength(1);

    unblockFirstPersist();
    await beginPromise;
  });

  it("selectively splits coalesced auto-pause newcomers while resuming a captured transfer", async () => {
    const session = makeSession();
    const held = session.state.codex_result_error_auto_pause!.heldInputs[0]!;
    held.count = 3;
    held.message = {
      type: "user_message",
      content: "latest coalesced newcomer",
      agentSource: { sessionId: "herd-events", sessionLabel: "Herd Events" },
    };
    session.recoveryDeliveryTransfers = [
      {
        id: "recovery-transfer-coalesced1234567890",
        createdAt: 1,
        sourceOwnerKind: "auto_pause",
        sourceOwnerId: held.id,
        sourceOwnerCount: 1,
        payloadBytes: 100,
        message: messageFor("group-1", "captured original payload"),
      },
    ];
    const routed: string[] = [];
    const snapshots: RecoveryDeliveryTransferSessionLike[] = [];
    const deps = makeDeps(snapshots, (target: BrowserTransportSessionLike, input: BrowserOutgoingMessage) => {
      if (input.type !== "user_message") return;
      routed.push(input.content);
      target.pendingCodexInputs.push({
        id: "captured-pending",
        content: input.content,
        timestamp: 50,
        cancelable: true,
        autoPauseRecoveries: input.autoPauseRecoveries,
      } as any);
    });

    await resumeRecoveryDeliveryTransfers(session, deps);

    expect(routed).toEqual([]);
    expect(session.pendingCodexInputs).toHaveLength(0);
    expect(session.state.codex_result_error_auto_pause?.heldInputs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringContaining("retained-"),
          count: 2,
          message: expect.objectContaining({ content: "latest coalesced newcomer" }),
        }),
        expect.objectContaining({
          count: 1,
          message: expect.objectContaining({ content: "captured original payload" }),
        }),
      ]),
    );
    expect(session.recoveryDeliveryTransfers).toEqual([]);
    expectOwnedOrTerminal(session);
  });

  it("selectively removes a captured manual owner while restart retains later queued arrivals", async () => {
    const session = makeSession();
    session.state.codex_result_error_auto_pause = null;
    const capturedMessage = messageFor("group-1", "captured manual payload");
    session.state.pause = {
      pausedAt: 60,
      queuedMessages: [
        { id: "manual-captured", queuedAt: 61, source: "browser", message: capturedMessage },
        {
          id: "manual-newcomer",
          queuedAt: 62,
          source: "browser",
          message: { type: "user_message", content: "later manual newcomer" },
        },
      ],
    };
    session.recoveryDeliveryTransfers = [
      {
        id: "recovery-transfer-manual123456789012",
        createdAt: 1,
        sourceOwnerKind: "manual_pause",
        sourceOwnerId: "manual-captured",
        sourceOwnerCount: 1,
        payloadBytes: 100,
        message: capturedMessage,
      },
    ];
    const deps = makeDeps([], (target: BrowserTransportSessionLike, input: BrowserOutgoingMessage) => {
      if (input.type !== "user_message") return;
      target.pendingCodexInputs.push({
        id: "manual-pending",
        content: input.content,
        timestamp: 63,
        cancelable: true,
        autoPauseRecoveries: input.autoPauseRecoveries,
      } as any);
    });

    await resumeRecoveryDeliveryTransfers(session, deps);

    expect(session.pendingCodexInputs).toHaveLength(0);
    expect(session.state.pause?.queuedMessages).toEqual([
      expect.objectContaining({
        id: "manual-newcomer",
        message: { type: "user_message", content: "later manual newcomer" },
      }),
      expect.objectContaining({
        message: expect.objectContaining({ content: "captured manual payload" }),
      }),
    ]);
    expect(session.recoveryDeliveryTransfers).toEqual([]);
    expectOwnedOrTerminal(session);
  });
});
