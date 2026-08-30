// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_ATTENTION_PROJECTION } from "../shared/session-attention-projection.js";
import { SYNCED_PROJECTION_SCHEMA_VERSION } from "../shared/synced-projection.js";
import { createSessionNavigationProjectionEnvelope } from "./test-fixtures/session-navigation-projection.js";

const apiMocks = vi.hoisted(() => ({
  markSessionRead: vi.fn().mockResolvedValue({ ok: true }),
  markSessionUnread: vi.fn().mockResolvedValue({ ok: true }),
  markAllSessionsRead: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("./api.js", () => ({ api: apiMocks }));
vi.mock("./utils/names.js", () => ({ generateUniqueSessionName: vi.fn(() => "Test Session") }));
vi.mock("./utils/notification-sound.js", () => ({ playNotificationSound: vi.fn() }));

import { useStore } from "./store.js";
import { createWsMessageHandler } from "./ws-handlers.js";

function installProjection(): void {
  useStore.getState().applySyncedProjectionSnapshot({
    type: "synced_projection_snapshot",
    schemaVersion: SYNCED_PROJECTION_SCHEMA_VERSION,
    projection: SESSION_ATTENTION_PROJECTION,
    key: "worker",
    generation: "generation-a",
    revision: 1,
    value: {
      attentionReason: "review",
      status: { urgency: "review", count: 1 },
    },
  });
}

const handleMessage = createWsMessageHandler({
  disconnectSession: vi.fn(),
  sendToSession: vi.fn(() => true),
});

beforeEach(() => {
  localStorage.clear();
  useStore.getState().reset();
  useStore.setState({
    sdkSessions: [{ sessionId: "worker", archived: false, attentionReason: "review" } as never],
  });
  useStore.getState().setCurrentSession("worker");
  installProjection();
  apiMocks.markSessionRead.mockClear();
});

describe("projection-owned attention rejects legacy WebSocket hydration", () => {
  it("ignores projection protocol entries that arrive from event replay", () => {
    handleMessage(
      "worker",
      {
        type: "synced_projection_update",
        schemaVersion: SYNCED_PROJECTION_SCHEMA_VERSION,
        projection: SESSION_ATTENTION_PROJECTION,
        key: "worker",
        generation: "generation-a",
        revision: 2,
        value: { attentionReason: "action", status: { urgency: "needs-input", count: 1 } },
      } as never,
      { source: "event_replay" },
    );

    expect(useStore.getState().syncedProjectionVersions.get(`${SESSION_ATTENTION_PROJECTION}\u0000worker`)).toEqual({
      generation: "generation-a",
      revision: 1,
    });
    expect(useStore.getState().sessionAttention.get("worker")).toBe("review");
  });

  it("ignores session_update attention and does not feed back markSessionRead", () => {
    handleMessage("worker", {
      type: "session_update",
      session: { attentionReason: "action" },
    } as never);

    expect(useStore.getState().sessionAttention.get("worker")).toBe("review");
    expect(apiMocks.markSessionRead).not.toHaveBeenCalled();
  });

  it("ignores session_activity_update attention while retaining unrelated compact metadata", () => {
    handleMessage("carrier", {
      type: "session_activity_update",
      session_id: "worker",
      session: {
        attentionReason: "error",
        pendingPermissionCount: 3,
        pendingPermissionSummary: "pending plan",
      },
    } as never);

    const sdk = useStore.getState().sdkSessions[0]!;
    expect(sdk.attentionReason).toBe("review");
    expect(sdk.pendingPermissionCount).toBe(3);
    expect(sdk.pendingPermissionSummary).toBe("pending plan");
    expect(useStore.getState().sessionAttention.get("worker")).toBe("review");
    expect(apiMocks.markSessionRead).not.toHaveBeenCalled();
  });

  it("keeps navigation-owned activity fields while retaining non-navigation board and summary updates", () => {
    useStore.getState().applySyncedProjectionSnapshot(
      createSessionNavigationProjectionEnvelope({
        key: "worker",
        overrides: { lifecycle: { status: "running", pendingPermissionCount: 2 } },
      }),
    );
    useStore.getState().setSessionStatus("worker", "running");
    useStore.getState().updateSdkSession("worker", { pendingPermissionCount: 2 });

    handleMessage("carrier", {
      type: "session_activity_update",
      session_id: "worker",
      session: {
        status: "idle",
        pendingPermissionCount: 9,
        pendingPermissionSummary: "pending plan",
        leaderActivePhaseSummary: [],
        leaderActiveBoardRows: [],
      },
    } as never);

    const state = useStore.getState();
    expect(state.sessionStatus.get("worker")).toBe("running");
    expect(state.sdkSessions[0]?.pendingPermissionCount).toBe(2);
    expect(state.sdkSessions[0]?.pendingPermissionSummary).toBe("pending plan");
    expect(state.sdkSessions[0]?.leaderActivePhaseSummary).toEqual([]);
    expect(state.sessionBoards.get("worker")).toEqual([]);
  });

  it("ignores state_snapshot attention and does not feed back markSessionRead", () => {
    handleMessage("worker", {
      type: "state_snapshot",
      sessionStatus: "idle",
      permissionMode: "default",
      backendConnected: true,
      backendState: "connected",
      backendError: null,
      uiMode: null,
      askPermission: true,
      attentionReason: "action",
      generationStartedAt: null,
      notifications: [],
    } as never);

    expect(useStore.getState().sessionAttention.get("worker")).toBe("review");
    expect(apiMocks.markSessionRead).not.toHaveBeenCalled();
  });
});
