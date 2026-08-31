// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SdkSessionInfo } from "./types.js";
import { LEADER_THREAD_TABS_PROJECTION } from "../shared/leader-thread-tabs-projection.js";
import { getSyncedProjectionValue } from "./store-synced-projections.js";
import {
  createLeaderThreadTabsProjectionEnvelope,
  createLeaderThreadTabsProjectionTab,
  createLeaderThreadTabsProjectionValue,
} from "./test-fixtures/leader-thread-tabs-projection.js";

const mockApi = vi.hoisted(() => ({
  listSessions: vi.fn(),
  getTreeGroups: vi.fn(),
  markSessionRead: vi.fn(),
}));

vi.mock("./api.js", () => ({ api: mockApi }));

import { useStore } from "./store.js";
import {
  _resetActiveSessionMetadataRefreshForTest,
  applyAuthoritativeSessionArchive,
  beginActiveSessionListRequest,
  hydrateSessionList,
  installActiveSessionMetadataRefreshListeners,
  refreshActiveSessionMetadata,
} from "./session-list-hydration.js";

function makeSdkSession(id: string, overrides: Partial<SdkSessionInfo> = {}): SdkSessionInfo {
  return {
    sessionId: id,
    state: "connected",
    cwd: `/tmp/${id}`,
    createdAt: 100,
    archived: false,
    ...overrides,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("session list hydration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    _resetActiveSessionMetadataRefreshForTest();
    useStore.getState().reset();
    mockApi.listSessions.mockReset();
    mockApi.getTreeGroups.mockReset();
    mockApi.markSessionRead.mockReset();
    mockApi.getTreeGroups.mockResolvedValue({ groups: [], assignments: {}, nodeOrder: {} });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes active session metadata without dropping already loaded archived sessions", async () => {
    const archived = makeSdkSession("archived", { archived: true, state: "exited" });
    const active = makeSdkSession("active", {
      name: "Active Leader",
      isOrchestrator: true,
      leaderOpenThreadTabs: {
        version: 1,
        orderedOpenThreadKeys: ["q-1200"],
        closedThreadTombstones: [],
        updatedAt: 5,
      },
    });
    useStore.getState().setSdkSessions([archived]);
    mockApi.listSessions.mockResolvedValueOnce([active]);
    mockApi.getTreeGroups.mockResolvedValueOnce({
      groups: [{ id: "msi", name: "MSI", createdAt: 1, updatedAt: 1 }],
      assignments: { active: "msi" },
      nodeOrder: { msi: ["active"] },
    });

    await refreshActiveSessionMetadata({ force: true, includeTreeGroups: true });

    expect(mockApi.listSessions).toHaveBeenCalledWith({ includeArchived: false });
    expect(useStore.getState().sdkSessions.map((session) => session.sessionId)).toEqual(["active", "archived"]);
    expect(useStore.getState().sdkSessions[0]?.leaderOpenThreadTabs?.orderedOpenThreadKeys).toEqual(["q-1200"]);
    expect(useStore.getState().treeGroups.map((group) => group.name)).toEqual(["MSI"]);
  });

  it("merges partial archived pages without replacing active session rows", () => {
    const active = makeSdkSession("active", { archived: false, state: "connected" });
    const archivedOld = makeSdkSession("archived-old", { archived: true, state: "exited", createdAt: 1 });
    const archivedPage = makeSdkSession("archived-page", { archived: true, state: "exited", createdAt: 2 });
    useStore.getState().setSdkSessions([active, archivedOld]);

    hydrateSessionList([archivedPage], { preserveMissingSessions: true });

    expect(useStore.getState().sdkSessions.map((session) => session.sessionId)).toEqual([
      "archived-page",
      "active",
      "archived-old",
    ]);
  });

  it("fences stale active snapshots without overriding later backend truth", async () => {
    useStore.getState().setSdkSessions([makeSdkSession("archive-target")]);
    let resolveStaleSnapshot: (sessions: SdkSessionInfo[]) => void = () => {};
    const staleSnapshot = new Promise<SdkSessionInfo[]>((resolve) => {
      resolveStaleSnapshot = resolve;
    });
    mockApi.listSessions.mockReturnValueOnce(staleSnapshot);

    const staleRequestSequence = beginActiveSessionListRequest();
    const staleRequest = mockApi.listSessions({ includeArchived: false });
    applyAuthoritativeSessionArchive("archive-target", 1234);
    resolveStaleSnapshot([makeSdkSession("archive-target")]);
    hydrateSessionList(await staleRequest, {
      preserveMissingArchived: true,
      activeSnapshotRequestSequence: staleRequestSequence,
    });

    // A response requested before the server-confirmed archive cannot resurrect
    // the row, but a later backend snapshot can still authoritatively unarchive it.
    expect(useStore.getState().sdkSessions).toEqual([
      expect.objectContaining({ sessionId: "archive-target", archived: true, archivedAt: 1234 }),
    ]);
    mockApi.listSessions.mockResolvedValueOnce([makeSdkSession("archive-target")]);
    const laterRequestSequence = beginActiveSessionListRequest();
    hydrateSessionList(await mockApi.listSessions({ includeArchived: false }), {
      preserveMissingArchived: true,
      activeSnapshotRequestSequence: laterRequestSequence,
    });
    expect(useStore.getState().sdkSessions).toEqual([
      expect.objectContaining({ sessionId: "archive-target", archived: false }),
    ]);
  });

  it("installs page-restore hydration outside the sidebar and forces active refresh for persisted pageshow", async () => {
    mockApi.listSessions.mockResolvedValueOnce([makeSdkSession("initial")]);
    const cleanup = installActiveSessionMetadataRefreshListeners();
    await flushPromises();

    expect(mockApi.listSessions).toHaveBeenCalledTimes(1);
    expect(mockApi.listSessions).toHaveBeenLastCalledWith({ includeArchived: false });

    mockApi.listSessions.mockResolvedValueOnce([makeSdkSession("restored")]);
    const event = new Event("pageshow") as PageTransitionEvent;
    Object.defineProperty(event, "persisted", { value: true });
    window.dispatchEvent(event);
    await flushPromises();

    expect(mockApi.listSessions).toHaveBeenCalledTimes(2);
    expect(useStore.getState().sdkSessions.map((session) => session.sessionId)).toEqual(["restored"]);
    cleanup();
  });

  it("hydrates derived metadata and the current leader projection from session snapshots", () => {
    hydrateSessionList([
      makeSdkSession("s1", {
        name: "Hydrated Name",
        lastMessagePreview: "latest user request",
        isOrchestrator: true,
        leaderThreadTabsProjection: createLeaderThreadTabsProjectionEnvelope({
          value: createLeaderThreadTabsProjectionValue({
            tabs: [
              createLeaderThreadTabsProjectionTab("q-1455", {
                title: "Restore active quest rows",
                boardStatus: "IMPLEMENTING",
                journey: {
                  mode: "active",
                  phaseIds: ["alignment", "work"],
                  currentPhaseId: "work",
                  activePhaseIndex: 1,
                  phaseCount: 2,
                },
                sourceLeaderSessionId: "s1",
                sourceRowCreatedAt: 1,
                active: true,
                canClose: false,
                updatedAt: 2,
              }),
            ],
            mainAttention: {},
            threadStatuses: {},
            activePhaseSummary: [
              { label: "Work", count: 1, tone: "phase", color: "#34d399" },
              { label: "Queued", count: 1, tone: "status" },
            ],
          }),
        }),
        taskHistory: [{ title: "Task", action: "new", timestamp: 10, triggerMessageId: "m1" }],
        keywords: ["mobile", "reconnect"],
      }),
    ]);

    const state = useStore.getState();
    expect(state.sdkSessions[0]?.name).toBe("Hydrated Name");
    expect(state.sdkSessions[0]?.lastMessagePreview).toBe("latest user request");
    expect(getSyncedProjectionValue(state, LEADER_THREAD_TABS_PROJECTION, "s1")?.activePhaseSummary).toEqual([
      { label: "Work", count: 1, tone: "phase", color: "#34d399" },
      { label: "Queued", count: 1, tone: "status" },
    ]);
    expect(state.sessionTaskHistory.get("s1")).toEqual([
      { title: "Task", action: "new", timestamp: 10, triggerMessageId: "m1" },
    ]);
    expect(state.sessionKeywords.get("s1")).toEqual(["mobile", "reconnect"]);
    expect(state.sessionBoards.has("s1")).toBe(false);
    expect(state.sdkSessions[0]).not.toHaveProperty("taskHistory");
    expect(state.sdkSessions[0]).not.toHaveProperty("keywords");
    expect(state.sdkSessions[0]).not.toHaveProperty("leaderActiveBoardRows");
    expect(state.sdkSessions[0]).not.toHaveProperty("leaderActivePhaseSummary");
  });

  it("replaces current leader projection snapshots without mutating separately loaded board detail", () => {
    const detailedBoard = [
      {
        questId: "q-stale",
        title: "Separately loaded leader board row",
        status: "IMPLEMENTING",
        createdAt: 1,
        updatedAt: 2,
      },
    ];
    useStore.getState().setSessionBoard("leader", detailedBoard);
    hydrateSessionList([
      makeSdkSession("leader", {
        isOrchestrator: true,
        leaderThreadTabsProjection: createLeaderThreadTabsProjectionEnvelope({
          key: "leader",
          value: createLeaderThreadTabsProjectionValue({
            tabs: [createLeaderThreadTabsProjectionTab("q-keep", { title: "Current active row", active: true })],
            mainAttention: {},
            threadStatuses: {},
            activePhaseSummary: [{ label: "Work", count: 1, tone: "phase", color: "#60a5fa" }],
          }),
        }),
      }),
    ]);

    hydrateSessionList([
      makeSdkSession("leader", {
        isOrchestrator: true,
        leaderThreadTabsProjection: createLeaderThreadTabsProjectionEnvelope({
          key: "leader",
          revision: 2,
          value: createLeaderThreadTabsProjectionValue({
            tabs: [],
            mainAttention: {},
            threadStatuses: {},
            activePhaseSummary: [],
          }),
        }),
      }),
    ]);

    expect(getSyncedProjectionValue(useStore.getState(), LEADER_THREAD_TABS_PROJECTION, "leader")?.tabs).toEqual([]);
    expect(
      getSyncedProjectionValue(useStore.getState(), LEADER_THREAD_TABS_PROJECTION, "leader")?.activePhaseSummary,
    ).toEqual([]);
    expect(useStore.getState().sessionBoards.get("leader")).toEqual(detailedBoard);
  });
});
