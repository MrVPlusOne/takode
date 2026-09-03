import { describe, expect, it, vi } from "vitest";
import {
  applyLeaderThreadTabsProjectionPatch,
  LEADER_THREAD_TABS_PROJECTION,
  type LeaderThreadTabsProjectionValue,
} from "../shared/leader-thread-tabs-projection.js";
import { ingestUserMessage } from "./bridge/adapter-browser-routing-controller.js";
import type { AdapterBrowserRoutingDeps } from "./bridge/adapter-browser-routing-types.js";
import { updateLeaderThreadStatusesForAssistantOutput } from "./bridge/thread-routing-reminder.js";
import { finalizeRoutedLeaderResponseMessage } from "./leader-thread-response.js";
import type { BrowserIncomingMessage, BrowserOutgoingMessage } from "./session-types.js";
import { threadRouteForTarget } from "./thread-routing-metadata.js";
import { WsBridgeSyncedProjectionController } from "./ws-bridge-synced-projections.js";

function mainReadyStatus() {
  return {
    kind: "ready" as const,
    label: "Thread Ready",
    threadKey: "main",
    summary: "old result",
    messageId: "old-ready",
    timestamp: 1,
    updatedAt: 1,
  };
}

function leaderSession(messageHistory: BrowserIncomingMessage[] = []) {
  return {
    id: "leader-main",
    backendType: "codex" as const,
    state: {
      backend_type: "codex",
      backend_state: "connected",
      cwd: "/tmp",
      isOrchestrator: true,
      leaderThreadStatuses: { main: mainReadyStatus() },
    },
    messageHistory,
    board: new Map(),
    completedBoard: new Map(),
    attentionRecords: [],
    notifications: [],
    pendingPermissions: new Map(),
    evaluatingAborts: new Map(),
    pendingMessages: [],
    pendingCodexTurns: [],
    pendingCodexInputs: [],
    forceCompactPending: false,
    isGenerating: false,
    lastUserMessageDateTag: "",
    lastOutboundUserNdjson: null,
    consecutiveAdapterFailures: 0,
    codexAdapter: null,
    claudeSdkAdapter: null,
    searchDataOnly: false,
  } as any;
}

function projectionController(session: ReturnType<typeof leaderSession>) {
  return new WsBridgeSyncedProjectionController({
    getSession: (sessionId) => (sessionId === session.id ? session : undefined),
    listSessions: () => [session],
    getLauncherSessionInfo: (sessionId) => (sessionId === session.id ? ({ isOrchestrator: true } as any) : undefined),
    getSessionName: () => undefined,
    getPendingTimerCount: () => 0,
    getBackendConnected: () => false,
    getSessionStatus: () => null,
    getLastActivityAt: () => undefined,
    getLastUserMessageAt: () => undefined,
    getLastMessagePreviewAt: () => undefined,
  });
}

function subscribe(controller: WsBridgeSyncedProjectionController, sessionId: string) {
  const socket = {
    data: { kind: "browser", sessionId: "carrier" },
    send: vi.fn(),
    readyState: 1,
  } as any;
  const snapshot = controller
    .replaceSubscriptions(socket, [{ projection: LEADER_THREAD_TABS_PROJECTION, key: sessionId }])
    .find((message) => message.type === "synced_projection_snapshot") as any;
  expect(snapshot.value.threadStatuses).toEqual({ main: expect.objectContaining({ kind: "ready" }) });
  return { socket, value: snapshot.value as LeaderThreadTabsProjectionValue };
}

function applyOnlyUpdate(socket: { send: ReturnType<typeof vi.fn> }, value: LeaderThreadTabsProjectionValue) {
  expect(socket.send).toHaveBeenCalledOnce();
  const update = JSON.parse(String(socket.send.mock.calls[0]![0])) as any;
  expect(update).toMatchObject({
    type: "synced_projection_update",
    projection: LEADER_THREAD_TABS_PROJECTION,
    key: "leader-main",
  });
  const next = Object.hasOwn(update, "value")
    ? (update.value as LeaderThreadTabsProjectionValue)
    : applyLeaderThreadTabsProjectionPatch(value, update.patch);
  expect(next?.threadStatuses).toEqual({});
}

describe("leader thread status clear projection invalidation", () => {
  it("publishes a Main Ready clear when direct user input is accepted before history commit", async () => {
    const session = leaderSession();
    const controller = projectionController(session);
    const { socket, value } = subscribe(controller, session.id);
    const deps = {
      getLauncherSessionInfo: vi.fn(() => ({ isOrchestrator: true })),
      nextUserMessageId: vi.fn(() => "accepted-main-input"),
      invalidateLeaderThreadTabsForSession: (sessionId: string) =>
        controller.invalidateLeaderThreadTabsForSession(sessionId),
      emitTakodeEvent: vi.fn(),
    } as unknown as AdapterBrowserRoutingDeps;
    const message: Extract<BrowserOutgoingMessage, { type: "user_message" }> = {
      type: "user_message",
      content: "Please revise the result.",
      threadKey: "main",
    };

    ingestUserMessage(session, message, deps, { commit: false });
    await controller.flushForTest();

    expect(session.state.leaderThreadStatuses.main).toBeUndefined();
    applyOnlyUpdate(socket, value);
  });

  it("publishes a Main Ready clear when an ordinary routed answer is completed", async () => {
    const session = leaderSession([
      {
        type: "user_message",
        id: "pending-main-input",
        leaderUserMessageId: "u1",
        content: "Please handle this.",
        timestamp: 2,
        threadKey: "main",
        leaderResponseCoverageVersion: 1,
      },
    ]);
    const controller = projectionController(session);
    const { socket, value } = subscribe(controller, session.id);
    const response: Extract<BrowserIncomingMessage, { type: "assistant" }> = {
      type: "assistant",
      message: {
        id: "main-final",
        type: "message",
        role: "assistant",
        model: "test",
        content: [{ type: "text", text: "Handled." }],
        stop_reason: "end_turn",
        usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
      parent_tool_use_id: null,
      timestamp: 20,
      threadKey: "main",
      leaderThreadRole: "answer",
      leaderAnswerUserMessageIds: ["u1"],
      leaderAnswerObservedHistoryLength: 1,
    };
    session.messageHistory.push(response);
    expect(finalizeRoutedLeaderResponseMessage(session, response)).toMatchObject({ finalized: true });
    updateLeaderThreadStatusesForAssistantOutput(
      session,
      undefined,
      { messageId: response.message.id, timestamp: response.timestamp! },
      threadRouteForTarget("main"),
    );
    controller.invalidateLeaderThreadTabsForSession(session.id);
    await controller.flushForTest();

    expect(session.state.leaderThreadStatuses.main).toBeUndefined();
    applyOnlyUpdate(socket, value);
  });
});
