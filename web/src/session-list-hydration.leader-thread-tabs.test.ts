// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { LEADER_THREAD_TABS_PROJECTION } from "../shared/leader-thread-tabs-projection.js";
import { syncedProjectionEntryId } from "../shared/synced-projection.js";
import {
  applyAuthoritativeSessionArchive,
  beginActiveSessionListRequest,
  hydrateSessionList,
  reconcileStoredSyncedProjectionSnapshots,
} from "./session-list-hydration.js";
import { useStore } from "./store.js";
import { hasLeaderThreadTabsProjection } from "./store-synced-projections.js";
import {
  createLeaderThreadTabsProjectionEnvelope,
  createLeaderThreadTabsProjectionValue,
} from "./test-fixtures/leader-thread-tabs-projection.js";
import {
  projectedLeaderOpenThreadTabs,
  resolveLeaderThreadTabsProjection,
  selectLeaderActivePhaseSummary,
  selectLeaderThreadStatuses,
} from "./utils/leader-thread-tabs-resolver.js";

const apiMocks = vi.hoisted(() => ({
  markSessionRead: vi.fn().mockResolvedValue({ ok: true }),
  markSessionUnread: vi.fn().mockResolvedValue({ ok: true }),
  markAllSessionsRead: vi.fn().mockResolvedValue({ ok: true }),
  getTreeGroups: vi.fn().mockResolvedValue({ groups: [], assignments: {}, nodeOrder: {} }),
  listSessions: vi.fn().mockResolvedValue([]),
}));

vi.mock("./api.js", () => ({ api: apiMocks }));

function sdkSession(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "leader",
    cwd: "/repo",
    createdAt: 1,
    archived: false,
    isOrchestrator: true,
    ...overrides,
  } as never;
}

beforeEach(() => {
  localStorage.clear();
  useStore.getState().reset();
});

describe("session-list leader thread tabs projection hydration", () => {
  it("installs projection authority before publishing the leader SDK row", () => {
    let projectionOwnedWhenPublished: boolean | undefined;
    const unsubscribe = useStore.subscribe((state) => {
      if (state.sdkSessions.some((session) => session.sessionId === "leader")) {
        projectionOwnedWhenPublished = hasLeaderThreadTabsProjection(state, "leader");
      }
    });

    hydrateSessionList([
      sdkSession({
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-stale"],
          closedThreadTombstones: [],
          updatedAt: 1,
        },
        leaderThreadTabsProjection: createLeaderThreadTabsProjectionEnvelope({ key: "leader" }),
      }),
    ]);
    unsubscribe();

    expect(projectionOwnedWhenPublished).toBe(true);
    const resolution = resolveLeaderThreadTabsProjection(useStore.getState(), "leader");
    expect(resolution.projectionState).toBe("accepted");
    expect(projectedLeaderOpenThreadTabs(resolution)?.orderedOpenThreadKeys).toEqual(["q-1", "q-2"]);
  });

  it("keeps absent projected tab state migration-eligible while malformed envelopes fail closed", () => {
    useStore.setState({
      sessions: new Map([
        [
          "leader",
          {
            isOrchestrator: true,
            leaderThreadStatuses: {
              "q-stale": {
                kind: "ready",
                label: "Thread Ready",
                threadKey: "q-stale",
                questId: "q-stale",
                summary: "stale legacy status",
                messageId: "legacy-status",
                timestamp: 1,
                updatedAt: 1,
              },
            },
          } as never,
        ],
      ]),
    });
    const cleared = createLeaderThreadTabsProjectionValue({
      tabState: null,
      tabs: [],
      mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
      threadStatuses: {},
      activePhaseSummary: [],
    });
    hydrateSessionList([
      sdkSession({
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-stale"],
          closedThreadTombstones: [],
          updatedAt: 1,
        },
        leaderActivePhaseSummary: [{ label: "Stale", count: 1, tone: "status" }],
        leaderThreadTabsProjection: createLeaderThreadTabsProjectionEnvelope({ key: "leader", value: cleared }),
      }),
    ]);

    let resolution = resolveLeaderThreadTabsProjection(useStore.getState(), "leader");
    expect(resolution.projectionState).toBe("accepted");
    expect(projectedLeaderOpenThreadTabs(resolution)).toBeUndefined();
    expect(selectLeaderThreadStatuses(useStore.getState(), "leader")).toEqual({});
    expect(selectLeaderActivePhaseSummary(useStore.getState(), "leader")).toEqual([]);

    useStore.getState().reset();
    useStore.setState({
      sessions: new Map([["leader", { isOrchestrator: true, leaderThreadStatuses: { "q-stale": {} } } as never]]),
    });
    hydrateSessionList([
      sdkSession({
        leaderOpenThreadTabs: {
          version: 1,
          orderedOpenThreadKeys: ["q-stale"],
          closedThreadTombstones: [],
          updatedAt: 1,
        },
        leaderActivePhaseSummary: [{ label: "Stale", count: 1, tone: "status" }],
        leaderThreadTabsProjection: {
          ...createLeaderThreadTabsProjectionEnvelope({ key: "leader" }),
          revision: 0,
        },
      }),
    ]);

    resolution = resolveLeaderThreadTabsProjection(useStore.getState(), "leader");
    expect(resolution.projectionState).toBe("invalid-supplied");
    expect(projectedLeaderOpenThreadTabs(resolution)?.orderedOpenThreadKeys).toEqual([]);
    expect(selectLeaderThreadStatuses(useStore.getState(), "leader")).toEqual({});
    expect(selectLeaderActivePhaseSummary(useStore.getState(), "leader")).toEqual([]);
  });

  it("fences a rejected REST envelope until a later live subscription is accepted", () => {
    const requestSequence = beginActiveSessionListRequest();
    const restEnvelope = createLeaderThreadTabsProjectionEnvelope({ key: "leader" });
    hydrateSessionList([sdkSession({ leaderThreadTabsProjection: restEnvelope })], {
      preserveMissingArchived: true,
      activeSnapshotRequestSequence: requestSequence,
    });
    expect(hasLeaderThreadTabsProjection(useStore.getState(), "leader")).toBe(true);

    const rejected = reconcileStoredSyncedProjectionSnapshots([]);
    useStore.getState().reconcileSyncedProjectionAuthority([], {
      activeRequestSequence: requestSequence,
      revokedSubscriptions: rejected,
    });
    expect(rejected).toContainEqual({ projection: LEADER_THREAD_TABS_PROJECTION, key: "leader" });
    expect(hasLeaderThreadTabsProjection(useStore.getState(), "leader")).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(useStore.getState().sdkSessions[0]!, "leaderThreadTabsProjection"),
    ).toBe(false);

    hydrateSessionList([sdkSession({ leaderThreadTabsProjection: { ...restEnvelope, revision: 9 } })], {
      preserveMissingArchived: true,
      activeSnapshotRequestSequence: requestSequence,
    });
    expect(hasLeaderThreadTabsProjection(useStore.getState(), "leader")).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(useStore.getState().sdkSessions[0]!, "leaderThreadTabsProjection"),
    ).toBe(false);

    const laterRequestSequence = beginActiveSessionListRequest();
    const liveEnvelope = createLeaderThreadTabsProjectionEnvelope({
      key: "leader",
      generation: "leader-tabs-live",
      revision: 1,
    });
    expect(
      useStore.getState().applySyncedProjectionSnapshot(liveEnvelope, {
        source: "live",
        activeRequestSequence: laterRequestSequence,
      }),
    ).toMatchObject({ accepted: true });
    const accepted = [{ projection: LEADER_THREAD_TABS_PROJECTION, key: "leader" }] as const;
    useStore.getState().reconcileSyncedProjectionAuthority(accepted, {
      activeRequestSequence: laterRequestSequence,
      revokedSubscriptions: reconcileStoredSyncedProjectionSnapshots(accepted),
    });

    const postAcceptanceSequence = beginActiveSessionListRequest();
    hydrateSessionList([sdkSession({ leaderThreadTabsProjection: { ...liveEnvelope, revision: 2 } })], {
      preserveMissingArchived: true,
      activeSnapshotRequestSequence: postAcceptanceSequence,
    });
    expect(hasLeaderThreadTabsProjection(useStore.getState(), "leader")).toBe(true);
    expect(
      Object.prototype.hasOwnProperty.call(useStore.getState().sdkSessions[0]!, "leaderThreadTabsProjection"),
    ).toBe(true);
    expect(
      useStore
        .getState()
        .syncedProjectionVersions.get(syncedProjectionEntryId(LEADER_THREAD_TABS_PROJECTION, "leader")),
    ).toEqual({ generation: "leader-tabs-live", revision: 2 });
  });

  it("revokes leader-tab projection authority when the session is archived", () => {
    hydrateSessionList([
      sdkSession({ leaderThreadTabsProjection: createLeaderThreadTabsProjectionEnvelope({ key: "leader" }) }),
    ]);
    expect(hasLeaderThreadTabsProjection(useStore.getState(), "leader")).toBe(true);

    applyAuthoritativeSessionArchive("leader", 1234);

    expect(useStore.getState().sdkSessions[0]).toMatchObject({ sessionId: "leader", archived: true, archivedAt: 1234 });
    expect(
      Object.prototype.hasOwnProperty.call(useStore.getState().sdkSessions[0]!, "leaderThreadTabsProjection"),
    ).toBe(false);
    expect(hasLeaderThreadTabsProjection(useStore.getState(), "leader")).toBe(false);
  });
});
