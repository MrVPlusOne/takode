// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_ATTENTION_PROJECTION } from "../shared/session-attention-projection.js";
import { SYNCED_PROJECTION_SCHEMA_VERSION } from "../shared/synced-projection.js";
import {
  getSessionAttentionProjection,
  getSessionNavigationProjection,
  hasSessionAttentionProjection,
  hasSessionNavigationProjection,
} from "./store-synced-projections.js";
import { createSessionNavigationProjectionEnvelope } from "./test-fixtures/session-navigation-projection.js";

const apiMocks = vi.hoisted(() => ({
  markSessionRead: vi.fn().mockResolvedValue({ ok: true }),
  markSessionUnread: vi.fn().mockResolvedValue({ ok: true }),
  markAllSessionsRead: vi.fn().mockResolvedValue({ ok: true }),
  getTreeGroups: vi.fn().mockResolvedValue({ groups: [], assignments: {}, nodeOrder: {} }),
  listSessions: vi.fn().mockResolvedValue([]),
}));

vi.mock("./api.js", () => ({ api: apiMocks }));

import {
  applyAuthoritativeSessionArchive,
  beginActiveSessionListRequest,
  hydrateSessionList,
  reconcileStoredSyncedProjectionSnapshots,
} from "./session-list-hydration.js";
import { useStore } from "./store.js";

function projectionSnapshot(options: { revision?: number; reason?: "action" | "error" | "review" | null } = {}) {
  return {
    type: "synced_projection_snapshot",
    schemaVersion: SYNCED_PROJECTION_SCHEMA_VERSION,
    projection: SESSION_ATTENTION_PROJECTION,
    key: "s1",
    generation: "generation-a",
    revision: options.revision ?? 1,
    value: {
      attentionReason: options.reason ?? "review",
      status: { urgency: "review", count: 2 },
    },
  } as const;
}

function session(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: "s1",
    cwd: "/tmp/project",
    createdAt: 1,
    archived: false,
    ...overrides,
  } as never;
}

beforeEach(() => {
  localStorage.clear();
  useStore.getState().reset();
  apiMocks.markSessionRead.mockClear();
});

describe("hydrateSessionList synced attention projection", () => {
  it("installs REST projection snapshots without emitting read feedback for the selected session", () => {
    useStore.getState().setCurrentSession("s1");

    hydrateSessionList([
      session({
        attentionReason: "review",
        sessionAttentionProjection: projectionSnapshot(),
      }),
    ]);

    expect(hasSessionAttentionProjection(useStore.getState(), "s1")).toBe(true);
    expect(getSessionAttentionProjection(useStore.getState(), "s1")).toEqual({
      attentionReason: "review",
      status: { urgency: "review", count: 2 },
    });
    expect(useStore.getState().sessionAttention.get("s1")).toBe("review");
    expect(apiMocks.markSessionRead).not.toHaveBeenCalled();
  });

  it("installs navigation authority before publishing legacy session-list fields", () => {
    let navigationOwnedWhenRowPublished: boolean | undefined;
    const unsubscribe = useStore.subscribe((state) => {
      if (state.sdkSessions.some((candidate) => candidate.sessionId === "s1")) {
        navigationOwnedWhenRowPublished = hasSessionNavigationProjection(state, "s1");
      }
    });

    hydrateSessionList([
      session({
        name: "Legacy name",
        pendingPermissionCount: 9,
        sessionNavigationProjection: createSessionNavigationProjectionEnvelope({
          key: "s1",
          overrides: {
            identity: { name: "Projected name" },
            lifecycle: { pendingPermissionCount: 2 },
          },
        }),
      }),
    ]);
    unsubscribe();

    expect(navigationOwnedWhenRowPublished).toBe(true);
    expect(getSessionNavigationProjection(useStore.getState(), "s1")).toMatchObject({
      identity: { name: "Projected name" },
      lifecycle: { pendingPermissionCount: 2 },
    });
  });

  it("retains legacy attention hydration only when the projection field is absent", () => {
    hydrateSessionList([session({ attentionReason: "review" })]);

    expect(hasSessionAttentionProjection(useStore.getState(), "s1")).toBe(false);
    expect(useStore.getState().sessionAttention.get("s1")).toBe("review");
  });

  it("does not let later legacy REST attention overwrite a projection-owned key or mark it read", () => {
    useStore.getState().setCurrentSession("s1");
    hydrateSessionList([session({ sessionAttentionProjection: projectionSnapshot() })]);
    apiMocks.markSessionRead.mockClear();

    hydrateSessionList([session({ attentionReason: "action" })]);

    expect(useStore.getState().sessionAttention.get("s1")).toBe("review");
    expect(getSessionAttentionProjection(useStore.getState(), "s1")?.attentionReason).toBe("review");
    expect(apiMocks.markSessionRead).not.toHaveBeenCalled();
  });

  it("sequence-gates cross-generation active-list projection responses", () => {
    hydrateSessionList(
      [
        session({
          sessionAttentionProjection: {
            ...projectionSnapshot({ revision: 1 }),
            generation: "generation-new",
            value: { attentionReason: "review", status: { urgency: "review", count: 2 } },
          },
          sessionNavigationProjection: createSessionNavigationProjectionEnvelope({
            key: "s1",
            generation: "generation-new",
            revision: 1,
            overrides: { identity: { name: "New navigation" } },
          }),
        }),
      ],
      { preserveMissingArchived: true, activeSnapshotRequestSequence: 2 },
    );

    hydrateSessionList(
      [
        session({
          sessionAttentionProjection: {
            ...projectionSnapshot({ revision: 50 }),
            generation: "generation-old",
            value: { attentionReason: "review", status: { urgency: "review", count: 9 } },
          },
          sessionNavigationProjection: createSessionNavigationProjectionEnvelope({
            key: "s1",
            generation: "generation-old",
            revision: 50,
            overrides: { identity: { name: "Stale navigation" } },
          }),
        }),
      ],
      { preserveMissingArchived: true, activeSnapshotRequestSequence: 1 },
    );

    expect(getSessionAttentionProjection(useStore.getState(), "s1")?.status?.count).toBe(2);
    expect(useStore.getState().syncedProjectionVersions.get(`${SESSION_ATTENTION_PROJECTION}\u0000s1`)).toEqual({
      generation: "generation-new",
      revision: 1,
    });
    expect(getSessionNavigationProjection(useStore.getState(), "s1")?.identity.name).toBe("New navigation");
  });

  it("revokes projection authority when archive is authoritatively confirmed", () => {
    hydrateSessionList([
      session({
        sessionAttentionProjection: projectionSnapshot(),
        sessionNavigationProjection: createSessionNavigationProjectionEnvelope({ key: "s1" }),
      }),
    ]);
    expect(hasSessionAttentionProjection(useStore.getState(), "s1")).toBe(true);
    expect(hasSessionNavigationProjection(useStore.getState(), "s1")).toBe(true);

    applyAuthoritativeSessionArchive("s1", 1234);

    const archivedSession = useStore.getState().sdkSessions[0]!;
    expect(archivedSession).toMatchObject({ sessionId: "s1", archived: true, archivedAt: 1234 });
    expect(Object.prototype.hasOwnProperty.call(archivedSession, "sessionAttentionProjection")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(archivedSession, "sessionNavigationProjection")).toBe(false);
    expect(hasSessionAttentionProjection(useStore.getState(), "s1")).toBe(false);
    expect(hasSessionNavigationProjection(useStore.getState(), "s1")).toBe(false);
    expect(useStore.getState().sessionAttention.has("s1")).toBe(false);
  });

  it("does not let a fenced pre-archive REST response reinstall projection authority", () => {
    hydrateSessionList([
      session({
        sessionAttentionProjection: projectionSnapshot(),
        sessionNavigationProjection: createSessionNavigationProjectionEnvelope({ key: "s1" }),
      }),
    ]);
    const staleRequestSequence = beginActiveSessionListRequest();
    applyAuthoritativeSessionArchive("s1", 1234);

    hydrateSessionList(
      [
        session({
          sessionAttentionProjection: {
            ...projectionSnapshot({ revision: 9 }),
            generation: "stale-pre-archive-generation",
          },
          sessionNavigationProjection: createSessionNavigationProjectionEnvelope({
            key: "s1",
            generation: "stale-pre-archive-generation",
            revision: 9,
          }),
        }),
      ],
      { preserveMissingArchived: true, activeSnapshotRequestSequence: staleRequestSequence },
    );

    expect(useStore.getState().sdkSessions[0]).toMatchObject({ sessionId: "s1", archived: true, archivedAt: 1234 });
    expect(hasSessionAttentionProjection(useStore.getState(), "s1")).toBe(false);
    expect(hasSessionNavigationProjection(useStore.getState(), "s1")).toBe(false);
    expect(useStore.getState().sessionAttention.has("s1")).toBe(false);
  });

  it("keeps a partial-ack navigation rejection fenced until later live subscription acceptance", () => {
    const requestSequence = beginActiveSessionListRequest();
    const attention = projectionSnapshot();
    const navigation = createSessionNavigationProjectionEnvelope({ key: "s1" });
    hydrateSessionList(
      [
        session({
          sessionAttentionProjection: attention,
          sessionNavigationProjection: navigation,
        }),
      ],
      { preserveMissingArchived: true, activeSnapshotRequestSequence: requestSequence },
    );

    const accepted = [{ projection: SESSION_ATTENTION_PROJECTION, key: "s1" }] as const;
    const revokedSubscriptions = reconcileStoredSyncedProjectionSnapshots(accepted);
    useStore.getState().reconcileSyncedProjectionAuthority(accepted, {
      activeRequestSequence: requestSequence,
      revokedSubscriptions,
    });

    let stored = useStore.getState().sdkSessions[0]!;
    expect(Object.prototype.hasOwnProperty.call(stored, "sessionAttentionProjection")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(stored, "sessionNavigationProjection")).toBe(false);
    expect(hasSessionAttentionProjection(useStore.getState(), "s1")).toBe(true);
    expect(hasSessionNavigationProjection(useStore.getState(), "s1")).toBe(false);

    hydrateSessionList(
      [
        session({
          sessionAttentionProjection: attention,
          sessionNavigationProjection: { ...navigation, revision: 9 },
        }),
      ],
      { preserveMissingArchived: true, activeSnapshotRequestSequence: requestSequence },
    );

    stored = useStore.getState().sdkSessions[0]!;
    expect(Object.prototype.hasOwnProperty.call(stored, "sessionNavigationProjection")).toBe(false);
    expect(hasSessionNavigationProjection(useStore.getState(), "s1")).toBe(false);

    const laterRequestSequence = beginActiveSessionListRequest();
    hydrateSessionList(
      [
        session({
          sessionNavigationProjection: createSessionNavigationProjectionEnvelope({
            key: "s1",
            generation: "navigation-generation-new",
            revision: 1,
          }),
        }),
      ],
      { preserveMissingArchived: true, activeSnapshotRequestSequence: laterRequestSequence },
    );

    stored = useStore.getState().sdkSessions[0]!;
    expect(Object.prototype.hasOwnProperty.call(stored, "sessionNavigationProjection")).toBe(false);
    expect(hasSessionNavigationProjection(useStore.getState(), "s1")).toBe(false);

    const acceptedNavigation = createSessionNavigationProjectionEnvelope({
      key: "s1",
      generation: "navigation-generation-live",
      revision: 1,
    });
    expect(
      useStore.getState().applySyncedProjectionSnapshot(acceptedNavigation, {
        source: "live",
        activeRequestSequence: laterRequestSequence,
      }),
    ).toMatchObject({ accepted: true });
    const acceptedAfterReconnect = [
      { projection: SESSION_ATTENTION_PROJECTION, key: "s1" },
      { projection: acceptedNavigation.projection, key: "s1" },
    ] as const;
    const reconnectRevocations = reconcileStoredSyncedProjectionSnapshots(acceptedAfterReconnect);
    useStore.getState().reconcileSyncedProjectionAuthority(acceptedAfterReconnect, {
      activeRequestSequence: laterRequestSequence,
      revokedSubscriptions: reconnectRevocations,
    });

    const postAcceptanceRequestSequence = beginActiveSessionListRequest();
    hydrateSessionList(
      [
        session({
          sessionNavigationProjection: { ...acceptedNavigation, revision: 2 },
        }),
      ],
      { preserveMissingArchived: true, activeSnapshotRequestSequence: postAcceptanceRequestSequence },
    );

    stored = useStore.getState().sdkSessions[0]!;
    expect(Object.prototype.hasOwnProperty.call(stored, "sessionNavigationProjection")).toBe(true);
    expect(hasSessionNavigationProjection(useStore.getState(), "s1")).toBe(true);
  });

  it("retains a malformed navigation envelope as a fail-closed compatibility marker", () => {
    const malformedNavigation = createSessionNavigationProjectionEnvelope({ key: "s1" }) as unknown as {
      value: Record<string, unknown>;
    };
    malformedNavigation.value = {
      ...malformedNavigation.value,
      lifecycle: { status: "running" },
    };

    hydrateSessionList([
      session({
        name: "Legacy name must not silently win",
        sessionNavigationProjection: malformedNavigation,
      }),
    ]);

    const stored = useStore.getState().sdkSessions[0]!;
    expect(hasSessionNavigationProjection(useStore.getState(), "s1")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(stored, "sessionNavigationProjection")).toBe(true);
  });

  it("fails closed instead of falling back when a supplied projection is malformed", () => {
    hydrateSessionList([
      session({
        attentionReason: "action",
        sessionAttentionProjection: { ...projectionSnapshot(), revision: 0 },
      }),
    ]);

    expect(hasSessionAttentionProjection(useStore.getState(), "s1")).toBe(false);
    expect(useStore.getState().sessionAttention.has("s1")).toBe(false);
    expect(apiMocks.markSessionRead).not.toHaveBeenCalled();
  });
});
