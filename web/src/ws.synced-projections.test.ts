// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_ATTENTION_PROJECTION } from "../shared/session-attention-projection.js";
import { SESSION_NAVIGATION_PROJECTION } from "../shared/session-navigation-projection.js";
import { LEADER_THREAD_TABS_PROJECTION } from "../shared/leader-thread-tabs-projection.js";
import { createLeaderThreadTabsProjectionEnvelope } from "./test-fixtures/leader-thread-tabs-projection.js";
import { createSessionNavigationProjectionEnvelope } from "./test-fixtures/session-navigation-projection.js";

const apiMocks = vi.hoisted(() => ({
  getDiffStats: vi.fn().mockResolvedValue({ stats: {} }),
  listSessions: vi.fn().mockResolvedValue([]),
  markSessionRead: vi.fn().mockResolvedValue({ ok: true }),
  markSessionUnread: vi.fn().mockResolvedValue({ ok: true }),
  markAllSessionsRead: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("./api.js", () => ({ api: apiMocks }));
vi.mock("./utils/names.js", () => ({ generateUniqueSessionName: vi.fn(() => "Test Session") }));
vi.mock("./utils/notification-sound.js", () => ({ playNotificationSound: vi.fn() }));

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;
  static CLOSED = 3;
  static CONNECTING = 0;
  static CLOSING = 2;
  readyState = MockWebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  url: string;
  send = vi.fn();
  close = vi.fn();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }
}

vi.stubGlobal("WebSocket", MockWebSocket);
vi.stubGlobal("location", { protocol: "http:", host: "localhost:3456" });

let wsModule: typeof import("./ws.js");
let useStore: typeof import("./store.js").useStore;

function attentionEnvelope(options: {
  type?: "synced_projection_snapshot" | "synced_projection_update";
  key?: string;
  generation?: string;
  revision?: number;
  count?: number;
}) {
  return {
    type: options.type ?? "synced_projection_snapshot",
    projection: SESSION_ATTENTION_PROJECTION,
    key: options.key ?? "worker",
    generation: options.generation ?? "generation-a",
    revision: options.revision ?? 1,
    value: {
      attentionReason: "review",
      status: { urgency: "review", count: options.count ?? 1 },
    },
  } as const;
}

function open(socket: MockWebSocket): void {
  socket.onopen?.(new Event("open"));
}

function messages(socket: MockWebSocket): Array<Record<string, unknown>> {
  return socket.send.mock.calls.map(([raw]) => JSON.parse(raw as string) as Record<string, unknown>);
}

function fire(socket: MockWebSocket, message: Record<string, unknown>): void {
  socket.onmessage?.({ data: JSON.stringify(message) });
}

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  localStorage.clear();
  window.location.hash = "";
  MockWebSocket.instances = [];

  const storeModule = await import("./store.js");
  useStore = storeModule.useStore;
  useStore.getState().reset();
  wsModule = await import("./ws.js");
});

afterEach(() => {
  vi.useRealTimers();
});

describe("synced projection WebSocket carrier", () => {
  it("adds all active attention and navigation identities only to the selected carrier", () => {
    useStore.setState({
      sdkSessions: [
        { sessionId: "worker", archived: false } as never,
        { sessionId: "carrier", archived: false } as never,
        { sessionId: "archived", archived: true } as never,
      ],
    });
    useStore.getState().setCurrentSession("carrier");
    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ key: "worker", revision: 4 }));
    useStore
      .getState()
      .applySyncedProjectionSnapshot(createSessionNavigationProjectionEnvelope({ key: "worker", revision: 2 }));

    wsModule.connectSession("carrier");
    const carrier = MockWebSocket.instances.at(-1)!;
    open(carrier);
    expect(messages(carrier)[0]).toMatchObject({
      type: "session_subscribe",
      synced_projection_subscriptions: [
        { projection: SESSION_ATTENTION_PROJECTION, key: "carrier" },
        { projection: SESSION_ATTENTION_PROJECTION, key: "worker" },
        { projection: SESSION_NAVIGATION_PROJECTION, key: "carrier" },
        { projection: SESSION_NAVIGATION_PROJECTION, key: "worker" },
      ],
    });

    wsModule.connectSession("worker");
    const preview = MockWebSocket.instances.at(-1)!;
    open(preview);
    expect(messages(preview)[0]?.synced_projection_subscriptions).toBeUndefined();
  });

  it("retains leader subscriptions across partial role metadata until the complete ack settles authority", () => {
    useStore.setState({
      sdkSessions: [
        { sessionId: "carrier", archived: false } as never,
        { sessionId: "accepted-leader", archived: false } as never,
        {
          sessionId: "supplied-leader",
          archived: false,
          leaderThreadTabsProjection: { malformed: true },
        } as never,
      ],
    });
    useStore
      .getState()
      .applySyncedProjectionSnapshot(createLeaderThreadTabsProjectionEnvelope({ key: "accepted-leader" }));
    useStore.getState().setCurrentSession("carrier");

    wsModule.connectSession("carrier");
    const carrier = MockWebSocket.instances.at(-1)!;
    open(carrier);
    const subscriptions = messages(carrier)[0]?.synced_projection_subscriptions as Array<{
      projection: string;
      key: string;
    }>;

    expect(subscriptions).toContainEqual({
      projection: LEADER_THREAD_TABS_PROJECTION,
      key: "accepted-leader",
    });
    expect(subscriptions).toContainEqual({
      projection: LEADER_THREAD_TABS_PROJECTION,
      key: "supplied-leader",
    });
  });

  it("refreshes changed selected-carrier inventory once and suppresses duplicate refreshes", () => {
    useStore.setState({ sdkSessions: [{ sessionId: "carrier", archived: false } as never] });
    useStore.getState().setCurrentSession("carrier");
    wsModule.connectSession("carrier");
    const carrier = MockWebSocket.instances.at(-1)!;
    open(carrier);
    carrier.send.mockClear();

    useStore.setState({
      sdkSessions: [
        { sessionId: "carrier", archived: false } as never,
        { sessionId: "worker", archived: false } as never,
      ],
    });
    expect(wsModule.refreshSyncedProjectionSubscriptions("carrier")).toBe(true);
    expect(messages(carrier)).toEqual([
      {
        type: "synced_projection_subscribe",
        subscriptions: [
          { projection: SESSION_ATTENTION_PROJECTION, key: "carrier" },
          { projection: SESSION_ATTENTION_PROJECTION, key: "worker" },
          { projection: SESSION_NAVIGATION_PROJECTION, key: "carrier" },
          { projection: SESSION_NAVIGATION_PROJECTION, key: "worker" },
        ],
      },
    ]);

    expect(wsModule.refreshSyncedProjectionSubscriptions("carrier")).toBe(true);
    expect(carrier.send).toHaveBeenCalledTimes(1);
  });

  it("uses the latest identity-only inventory on reconnect", () => {
    useStore.setState({ sdkSessions: [{ sessionId: "carrier", archived: false } as never] });
    useStore.getState().setCurrentSession("carrier");
    wsModule.connectSession("carrier");
    const first = MockWebSocket.instances.at(-1)!;
    open(first);

    useStore.setState({
      sdkSessions: [
        { sessionId: "carrier", archived: false } as never,
        { sessionId: "worker", archived: false } as never,
      ],
    });
    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ key: "worker", revision: 7 }));
    useStore
      .getState()
      .applySyncedProjectionSnapshot(createSessionNavigationProjectionEnvelope({ key: "worker", revision: 5 }));
    first.onclose?.();
    vi.advanceTimersByTime(2_000);

    const replacement = MockWebSocket.instances.at(-1)!;
    expect(replacement).not.toBe(first);
    open(replacement);
    expect(messages(replacement)[0]).toMatchObject({
      type: "session_subscribe",
      synced_projection_subscriptions: [
        { projection: SESSION_ATTENTION_PROJECTION, key: "carrier" },
        { projection: SESSION_ATTENTION_PROJECTION, key: "worker" },
        { projection: SESSION_NAVIGATION_PROJECTION, key: "carrier" },
        { projection: SESSION_NAVIGATION_PROJECTION, key: "worker" },
      ],
    });
  });

  it("deduplicates gap resync on the carrier until an accepted snapshot settles it", () => {
    useStore.setState({
      sdkSessions: [
        { sessionId: "carrier", archived: false } as never,
        { sessionId: "worker", archived: false } as never,
      ],
    });
    useStore.getState().setCurrentSession("carrier");
    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ revision: 1 }));
    wsModule.connectSession("carrier");
    const carrier = MockWebSocket.instances.at(-1)!;
    open(carrier);
    carrier.send.mockClear();

    fire(carrier, attentionEnvelope({ type: "synced_projection_update", revision: 3, count: 3 }));
    fire(carrier, attentionEnvelope({ type: "synced_projection_update", revision: 5, count: 5 }));
    expect(messages(carrier)).toEqual([
      { type: "synced_projection_resync", projection: SESSION_ATTENTION_PROJECTION, key: "worker" },
    ]);
    expect(
      useStore.getState().syncedProjectionVersions.get(`${SESSION_ATTENTION_PROJECTION}\u0000worker`)?.revision,
    ).toBe(5);

    fire(carrier, attentionEnvelope({ revision: 5, count: 5 }));
    fire(carrier, attentionEnvelope({ type: "synced_projection_update", revision: 7, count: 7 }));
    expect(messages(carrier)).toEqual([
      { type: "synced_projection_resync", projection: SESSION_ATTENTION_PROJECTION, key: "worker" },
      { type: "synced_projection_resync", projection: SESSION_ATTENTION_PROJECTION, key: "worker" },
    ]);
  });

  it("ignores late snapshots and stale opens from sockets that no longer own the session", () => {
    useStore.setState({
      sdkSessions: [
        { sessionId: "carrier", archived: false } as never,
        { sessionId: "worker", archived: false } as never,
      ],
    });
    useStore.getState().setCurrentSession("carrier");
    wsModule.connectSession("carrier");
    const oldSocket = MockWebSocket.instances.at(-1)!;
    open(oldSocket);
    fire(oldSocket, attentionEnvelope({ generation: "generation-old", revision: 1, count: 1 }));

    wsModule.disconnectSession("carrier");
    wsModule.connectSession("carrier");
    const replacement = MockWebSocket.instances.at(-1)!;
    open(replacement);
    fire(replacement, attentionEnvelope({ generation: "generation-new", revision: 1, count: 2 }));

    oldSocket.send.mockClear();
    oldSocket.onopen?.(new Event("open"));
    fire(oldSocket, attentionEnvelope({ generation: "generation-old", revision: 2, count: 9 }));
    vi.advanceTimersByTime(30_000);

    expect(oldSocket.send).not.toHaveBeenCalled();
    expect(useStore.getState().syncedProjectionVersions.get(`${SESSION_ATTENTION_PROJECTION}\u0000worker`)).toEqual({
      generation: "generation-new",
      revision: 1,
    });
    expect(
      (
        useStore.getState().syncedProjectionValues.get(`${SESSION_ATTENTION_PROJECTION}\u0000worker`) as {
          status: { count: number };
        }
      ).status.count,
    ).toBe(2);
  });

  it("reconciles cached authority to snapshots confirmed by the latest complete ack", () => {
    useStore.setState({
      sdkSessions: [
        { sessionId: "carrier", archived: false } as never,
        { sessionId: "worker", archived: false } as never,
        { sessionId: "rejected", archived: false } as never,
      ],
    });
    useStore.getState().setCurrentSession("carrier");
    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ key: "worker", revision: 1 }));
    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ key: "rejected", revision: 1 }));
    wsModule.connectSession("carrier");
    const carrier = MockWebSocket.instances.at(-1)!;
    open(carrier);

    fire(carrier, attentionEnvelope({ key: "worker", revision: 2, count: 2 }));
    fire(carrier, {
      type: "synced_projection_subscriptions_ack",
      subscriptions: [{ projection: SESSION_ATTENTION_PROJECTION, key: "worker" }],
      complete: true,
    });

    expect(useStore.getState().syncedProjectionKeys.has(`${SESSION_ATTENTION_PROJECTION}\u0000worker`)).toBe(true);
    expect(useStore.getState().syncedProjectionKeys.has(`${SESSION_ATTENTION_PROJECTION}\u0000rejected`)).toBe(false);
    expect(useStore.getState().sessionAttention.has("rejected")).toBe(false);
  });

  it("selectively fences identities omitted by a complete partial ack", () => {
    const workerAttention = attentionEnvelope({ key: "worker", revision: 1 });
    const carrierAttention = attentionEnvelope({ key: "carrier", revision: 1 });
    const workerNavigation = createSessionNavigationProjectionEnvelope({ key: "worker" });
    const carrierNavigation = createSessionNavigationProjectionEnvelope({ key: "carrier" });
    useStore.setState({
      sdkSessions: [
        {
          sessionId: "carrier",
          archived: false,
          sessionAttentionProjection: carrierAttention,
          sessionNavigationProjection: carrierNavigation,
        } as never,
        {
          sessionId: "worker",
          archived: false,
          sessionAttentionProjection: workerAttention,
          sessionNavigationProjection: workerNavigation,
        } as never,
      ],
    });
    useStore.getState().setCurrentSession("carrier");
    useStore
      .getState()
      .applySyncedProjectionSnapshots([workerAttention, carrierAttention, workerNavigation, carrierNavigation]);
    useStore.getState().setSessionStatus("worker", "running");
    useStore.getState().updateSdkSession("worker", { pendingPermissionCount: 2 });
    wsModule.connectSession("carrier");
    const carrier = MockWebSocket.instances.at(-1)!;
    open(carrier);

    fire(carrier, workerAttention);
    fire(carrier, carrierAttention);
    fire(carrier, {
      type: "synced_projection_subscriptions_ack",
      subscriptions: [
        { projection: SESSION_ATTENTION_PROJECTION, key: "carrier" },
        { projection: SESSION_ATTENTION_PROJECTION, key: "worker" },
      ],
      complete: true,
    });

    expect(useStore.getState().syncedProjectionKeys.has(`${SESSION_ATTENTION_PROJECTION}\u0000worker`)).toBe(true);
    expect(useStore.getState().syncedProjectionKeys.has(`${SESSION_NAVIGATION_PROJECTION}\u0000worker`)).toBe(false);
    for (const session of useStore.getState().sdkSessions) {
      expect(Object.prototype.hasOwnProperty.call(session, "sessionAttentionProjection")).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(session, "sessionNavigationProjection")).toBe(false);
    }
    expect(
      useStore.getState().applySyncedProjectionSnapshot(
        createSessionNavigationProjectionEnvelope({
          key: "worker",
          generation: "navigation-generation-rest-only",
          revision: 99,
        }),
        { source: "rest", activeRequestSequence: 999 },
      ),
    ).toMatchObject({ accepted: false });
    expect(useStore.getState().syncedProjectionKeys.has(`${SESSION_NAVIGATION_PROJECTION}\u0000worker`)).toBe(false);

    fire(carrier, {
      type: "session_activity_update",
      session_id: "worker",
      session: { attentionReason: "action", pendingPermissionCount: 9, status: "idle" },
    });
    expect(useStore.getState().sessionAttention.get("worker")).toBe("review");
    expect(
      useStore.getState().sdkSessions.find((session) => session.sessionId === "worker")?.pendingPermissionCount,
    ).toBe(2);
    expect(useStore.getState().sessionStatus.get("worker")).toBe("running");
  });

  it("keeps a newer same-generation REST snapshot when the subscription snapshot arrives stale", () => {
    useStore.setState({
      sdkSessions: [
        { sessionId: "carrier", archived: false } as never,
        { sessionId: "worker", archived: false } as never,
      ],
    });
    useStore.getState().setCurrentSession("carrier");
    wsModule.connectSession("carrier");
    const carrier = MockWebSocket.instances.at(-1)!;
    open(carrier);

    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ key: "carrier", revision: 2, count: 2 }), {
      source: "rest",
      activeRequestSequence: 1,
    });
    fire(carrier, attentionEnvelope({ key: "carrier", revision: 1, count: 1 }));
    fire(carrier, {
      type: "synced_projection_subscriptions_ack",
      subscriptions: [{ projection: SESSION_ATTENTION_PROJECTION, key: "carrier" }],
      complete: true,
    });

    const entryId = `${SESSION_ATTENTION_PROJECTION}\u0000carrier`;
    expect(useStore.getState().syncedProjectionKeys.has(entryId)).toBe(true);
    expect(useStore.getState().syncedProjectionVersions.get(entryId)).toEqual({
      generation: "generation-a",
      revision: 2,
    });
    expect(
      (useStore.getState().syncedProjectionValues.get(entryId) as { status: { count: number } }).status.count,
    ).toBe(2);

    apiMocks.markSessionRead.mockClear();
    fire(carrier, {
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
    });
    expect(apiMocks.markSessionRead).not.toHaveBeenCalled();
    expect(useStore.getState().syncedProjectionKeys.has(entryId)).toBe(true);
  });

  it("does not reconcile an ack after the desired inventory changed but before refresh was sent", () => {
    useStore.setState({ sdkSessions: [{ sessionId: "carrier", archived: false } as never] });
    useStore.getState().setCurrentSession("carrier");
    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ key: "worker", revision: 1 }));
    wsModule.connectSession("carrier");
    const carrier = MockWebSocket.instances.at(-1)!;
    open(carrier);

    useStore.setState({
      sdkSessions: [
        { sessionId: "carrier", archived: false } as never,
        { sessionId: "worker", archived: false } as never,
      ],
    });
    fire(carrier, attentionEnvelope({ key: "carrier", revision: 1 }));
    fire(carrier, {
      type: "synced_projection_subscriptions_ack",
      subscriptions: [{ projection: SESSION_ATTENTION_PROJECTION, key: "carrier" }],
      complete: true,
    });

    expect(useStore.getState().syncedProjectionKeys.has(`${SESSION_ATTENTION_PROJECTION}\u0000worker`)).toBe(true);
    expect(wsModule.refreshSyncedProjectionSubscriptions("carrier")).toBe(true);
  });

  it("revokes an acknowledged key when its replacement snapshot was missing or malformed", () => {
    useStore.setState({
      sdkSessions: [
        { sessionId: "carrier", archived: false } as never,
        { sessionId: "worker", archived: false } as never,
      ],
    });
    useStore.getState().setCurrentSession("carrier");
    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ key: "worker", revision: 1 }));
    wsModule.connectSession("carrier");
    const carrier = MockWebSocket.instances.at(-1)!;
    open(carrier);

    fire(carrier, {
      ...attentionEnvelope({ key: "worker", revision: 1 }),
      value: { attentionReason: "review", status: { urgency: "review", count: 0 } },
    });
    fire(carrier, {
      type: "synced_projection_subscriptions_ack",
      subscriptions: [{ projection: SESSION_ATTENTION_PROJECTION, key: "worker" }],
      complete: true,
    });

    expect(useStore.getState().syncedProjectionKeys.has(`${SESSION_ATTENTION_PROJECTION}\u0000worker`)).toBe(false);
  });

  it("clears a pending resync when a newer same-generation REST snapshot covers the response", () => {
    useStore.setState({
      sdkSessions: [
        { sessionId: "carrier", archived: false } as never,
        { sessionId: "worker", archived: false } as never,
      ],
    });
    useStore.getState().setCurrentSession("carrier");
    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ revision: 1 }));
    wsModule.connectSession("carrier");
    const carrier = MockWebSocket.instances.at(-1)!;
    open(carrier);
    carrier.send.mockClear();

    fire(carrier, attentionEnvelope({ type: "synced_projection_update", revision: 3, count: 3 }));
    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ revision: 4, count: 4 }), {
      source: "rest",
      activeRequestSequence: 1,
    });
    fire(carrier, attentionEnvelope({ revision: 3, count: 3 }));
    fire(carrier, attentionEnvelope({ type: "synced_projection_update", revision: 6, count: 6 }));

    expect(messages(carrier)).toEqual([
      { type: "synced_projection_resync", projection: SESSION_ATTENTION_PROJECTION, key: "worker" },
      { type: "synced_projection_resync", projection: SESSION_ATTENTION_PROJECTION, key: "worker" },
    ]);
  });

  it("keeps projection authority while the current-build subscribe ack is delayed past state_snapshot", () => {
    const workerAttention = attentionEnvelope({ key: "worker", revision: 1 });
    const carrierAttention = attentionEnvelope({ key: "carrier", revision: 1 });
    const workerNavigation = createSessionNavigationProjectionEnvelope({
      key: "worker",
      overrides: { lifecycle: { status: "running", pendingPermissionCount: 2 } },
    });
    const carrierNavigation = createSessionNavigationProjectionEnvelope({ key: "carrier" });
    useStore.setState({
      sdkSessions: [
        {
          sessionId: "carrier",
          archived: false,
          sessionAttentionProjection: carrierAttention,
          sessionNavigationProjection: carrierNavigation,
        } as never,
        {
          sessionId: "worker",
          archived: false,
          sessionAttentionProjection: workerAttention,
          sessionNavigationProjection: workerNavigation,
        } as never,
      ],
    });
    useStore.getState().setCurrentSession("carrier");
    useStore
      .getState()
      .applySyncedProjectionSnapshots([workerAttention, carrierAttention, workerNavigation, carrierNavigation]);
    useStore.getState().setSessionStatus("worker", "running");
    useStore.getState().updateSdkSession("worker", { pendingPermissionCount: 2 });
    wsModule.connectSession("carrier");
    const carrier = MockWebSocket.instances.at(-1)!;
    open(carrier);

    fire(carrier, {
      type: "state_snapshot",
      sessionStatus: "idle",
      permissionMode: "default",
      backendConnected: true,
      backendState: "connected",
      backendError: null,
      uiMode: null,
      askPermission: true,
      attentionReason: null,
      generationStartedAt: null,
      notifications: [],
    });
    expect(useStore.getState().syncedProjectionKeys.size).toBe(4);
    expect(useStore.getState().sessionAttention.get("carrier")).toBe("review");

    fire(carrier, {
      type: "session_activity_update",
      session_id: "worker",
      session: { attentionReason: "action", pendingPermissionCount: 1, status: "idle" },
    });
    expect(useStore.getState().sessionAttention.get("worker")).toBe("review");
    expect(
      useStore.getState().sdkSessions.find((session) => session.sessionId === "worker")?.pendingPermissionCount,
    ).toBe(2);
    expect(useStore.getState().sessionStatus.get("worker")).toBe("running");

    fire(carrier, workerAttention);
    fire(carrier, carrierAttention);
    fire(carrier, workerNavigation);
    fire(carrier, carrierNavigation);
    fire(carrier, {
      type: "synced_projection_subscriptions_ack",
      subscriptions: [
        { projection: SESSION_ATTENTION_PROJECTION, key: "carrier" },
        { projection: SESSION_ATTENTION_PROJECTION, key: "worker" },
        { projection: SESSION_NAVIGATION_PROJECTION, key: "carrier" },
        { projection: SESSION_NAVIGATION_PROJECTION, key: "worker" },
      ],
      complete: true,
    });

    expect(useStore.getState().syncedProjectionKeys.size).toBe(4);
    for (const session of useStore.getState().sdkSessions) {
      expect(Object.prototype.hasOwnProperty.call(session, "sessionAttentionProjection")).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(session, "sessionNavigationProjection")).toBe(true);
    }
  });

  it("requests one resync for a same-revision conflict without replacing the accepted value", () => {
    useStore.setState({
      sdkSessions: [
        { sessionId: "carrier", archived: false } as never,
        { sessionId: "worker", archived: false } as never,
      ],
    });
    useStore.getState().setCurrentSession("carrier");
    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ revision: 2, count: 2 }));
    wsModule.connectSession("carrier");
    const carrier = MockWebSocket.instances.at(-1)!;
    open(carrier);
    carrier.send.mockClear();

    fire(carrier, attentionEnvelope({ type: "synced_projection_update", revision: 2, count: 99 }));
    fire(carrier, attentionEnvelope({ type: "synced_projection_update", revision: 2, count: 100 }));

    expect(messages(carrier)).toEqual([
      { type: "synced_projection_resync", projection: SESSION_ATTENTION_PROJECTION, key: "worker" },
    ]);
    let value = useStore.getState().syncedProjectionValues.get(`${SESSION_ATTENTION_PROJECTION}\u0000worker`) as {
      status: { count: number };
    };
    expect(value.status.count).toBe(2);

    // The transport-correlated snapshot is authoritative even if the server's
    // current value uses the same revision as the conflicting live update.
    fire(carrier, attentionEnvelope({ revision: 2, count: 99 }));
    value = useStore.getState().syncedProjectionValues.get(`${SESSION_ATTENTION_PROJECTION}\u0000worker`) as {
      status: { count: number };
    };
    expect(value.status.count).toBe(99);
    expect(carrier.send).toHaveBeenCalledTimes(1);

    fire(carrier, attentionEnvelope({ type: "synced_projection_update", revision: 4, count: 4 }));
    expect(carrier.send).toHaveBeenCalledTimes(2);
  });
});
