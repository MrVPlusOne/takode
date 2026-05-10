// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SdkSessionInfo } from "./types.js";

const mockApi = vi.hoisted(() => ({
  listSessions: vi.fn(),
  getTreeGroups: vi.fn(),
  markSessionRead: vi.fn(),
}));

vi.mock("./api.js", () => ({ api: mockApi }));

import { useStore } from "./store.js";
import {
  _resetActiveSessionMetadataRefreshForTest,
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

  it("hydrates derived metadata from session snapshots", () => {
    hydrateSessionList([
      makeSdkSession("s1", {
        name: "Hydrated Name",
        lastMessagePreview: "latest user request",
        isOrchestrator: true,
        leaderActivePhaseSummary: [
          { label: "Implement", count: 1, tone: "phase", color: "#34d399" },
          { label: "Queued", count: 1, tone: "status" },
        ],
        taskHistory: [{ title: "Task", action: "new", timestamp: 10, triggerMessageId: "m1" }],
        keywords: ["mobile", "reconnect"],
      }),
    ]);

    const state = useStore.getState();
    expect(state.sessionNames.get("s1")).toBe("Hydrated Name");
    expect(state.sessionPreviews.get("s1")).toBe("latest user request");
    expect(state.sdkSessions[0]?.leaderActivePhaseSummary).toEqual([
      { label: "Implement", count: 1, tone: "phase", color: "#34d399" },
      { label: "Queued", count: 1, tone: "status" },
    ]);
    expect(state.sessionTaskHistory.get("s1")).toEqual([
      { title: "Task", action: "new", timestamp: 10, triggerMessageId: "m1" },
    ]);
    expect(state.sessionKeywords.get("s1")).toEqual(["mobile", "reconnect"]);
    expect(state.sdkSessions[0]).not.toHaveProperty("taskHistory");
    expect(state.sdkSessions[0]).not.toHaveProperty("keywords");
  });

  it("clears stale leader phase summaries from authoritative session snapshots", () => {
    hydrateSessionList([
      makeSdkSession("leader", {
        isOrchestrator: true,
        leaderActivePhaseSummary: [{ label: "Execute", count: 1, tone: "phase", color: "#60a5fa" }],
      }),
    ]);

    hydrateSessionList([
      makeSdkSession("leader", {
        isOrchestrator: true,
        leaderActivePhaseSummary: [],
      }),
    ]);

    expect(useStore.getState().sdkSessions[0]?.leaderActivePhaseSummary).toEqual([]);
  });
});
