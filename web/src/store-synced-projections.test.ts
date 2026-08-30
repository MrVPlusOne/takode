// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_ATTENTION_PROJECTION } from "../shared/session-attention-projection.js";
import { SESSION_NAVIGATION_PROJECTION } from "../shared/session-navigation-projection.js";
import { SYNCED_PROJECTION_SCHEMA_VERSION, syncedProjectionEntryId } from "../shared/synced-projection.js";
import { createSessionNavigationProjectionEnvelope } from "./test-fixtures/session-navigation-projection.js";
import {
  getSessionAttentionProjection,
  getSessionNavigationProjection,
  getSyncedProjectionValue,
  hasSessionAttentionProjection,
  hasSessionNavigationProjection,
  hasSyncedProjectionValue,
} from "./store-synced-projections.js";

const apiMocks = vi.hoisted(() => ({
  markSessionUnread: vi.fn().mockResolvedValue({ ok: true }),
  markAllSessionsRead: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("./api.js", () => ({ api: apiMocks }));

import { useStore } from "./store.js";

function attentionEnvelope(options: {
  type?: "synced_projection_snapshot" | "synced_projection_update";
  key?: string;
  generation?: string;
  revision?: number;
  reason?: "action" | "error" | "review" | null;
  urgency?: "needs-input" | "review" | "muted-needs-input" | null;
  count?: number;
}) {
  return {
    type: options.type ?? "synced_projection_snapshot",
    schemaVersion: SYNCED_PROJECTION_SCHEMA_VERSION,
    projection: SESSION_ATTENTION_PROJECTION,
    key: options.key ?? "s1",
    generation: options.generation ?? "generation-a",
    revision: options.revision ?? 1,
    value: {
      attentionReason: options.reason ?? "review",
      status:
        options.urgency === null
          ? null
          : {
              urgency: options.urgency ?? "review",
              count: options.count ?? 1,
            },
    },
  } as const;
}

beforeEach(() => {
  localStorage.clear();
  useStore.getState().reset();
  apiMocks.markSessionUnread.mockClear();
  apiMocks.markAllSessionsRead.mockClear();
});

describe("synced projection store", () => {
  it("installs a new-generation snapshot and exposes typed value and authority helpers", () => {
    const result = useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({}));
    const state = useStore.getState();

    expect(result).toEqual({ applied: true, accepted: true, requestResync: false });
    expect(getSessionAttentionProjection(state, "s1")).toEqual({
      attentionReason: "review",
      status: { urgency: "review", count: 1 },
    });
    expect(hasSessionAttentionProjection(state, "s1")).toBe(true);
    expect(getSyncedProjectionValue(state, SESSION_ATTENTION_PROJECTION, "s1")).toBe(
      getSessionAttentionProjection(state, "s1"),
    );
    expect(hasSyncedProjectionValue(state, SESSION_ATTENTION_PROJECTION, "s1")).toBe(true);
    expect(state.sessionAttention.get("s1")).toBe("review");
  });

  it("installs mixed REST projection batches in one store notification", () => {
    const listener = vi.fn();
    const unsubscribe = useStore.subscribe(listener);

    useStore
      .getState()
      .applySyncedProjectionSnapshots([
        attentionEnvelope({ key: "s1", revision: 1 }),
        createSessionNavigationProjectionEnvelope({ key: "s1", revision: 1 }),
        attentionEnvelope({ key: "s2", revision: 1 }),
        createSessionNavigationProjectionEnvelope({ key: "s2", revision: 1 }),
      ]);

    expect(listener).toHaveBeenCalledTimes(1);
    expect(hasSessionAttentionProjection(useStore.getState(), "s1")).toBe(true);
    expect(hasSessionNavigationProjection(useStore.getState(), "s1")).toBe(true);
    expect(hasSessionAttentionProjection(useStore.getState(), "s2")).toBe(true);
    expect(hasSessionNavigationProjection(useStore.getState(), "s2")).toBe(true);

    listener.mockClear();
    useStore
      .getState()
      .applySyncedProjectionSnapshots([
        attentionEnvelope({ key: "s1", revision: 1 }),
        createSessionNavigationProjectionEnvelope({ key: "s1", revision: 1 }),
      ]);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("validates navigation snapshots and preserves equal nested slice identities", () => {
    const initial = createSessionNavigationProjectionEnvelope({ key: "s1", revision: 1 });
    expect(useStore.getState().applySyncedProjectionSnapshot(initial)).toEqual({
      applied: true,
      accepted: true,
      requestResync: false,
    });
    const before = getSessionNavigationProjection(useStore.getState(), "s1")!;
    expect(hasSessionNavigationProjection(useStore.getState(), "s1")).toBe(true);

    const changed = createSessionNavigationProjectionEnvelope({
      type: "synced_projection_update",
      key: "s1",
      revision: 2,
      overrides: { lifecycle: { pendingPermissionCount: 2, status: "running" } },
    });
    expect(useStore.getState().applySyncedProjectionUpdate(changed)).toEqual({
      applied: true,
      accepted: true,
      requestResync: false,
    });

    const after = getSessionNavigationProjection(useStore.getState(), "s1")!;
    expect(after).not.toBe(before);
    expect(after.lifecycle).not.toBe(before.lifecycle);
    expect(after.lifecycle).toMatchObject({ pendingPermissionCount: 2, status: "running" });
    expect(after.identity).toBe(before.identity);
    expect(after.topology).toBe(before.topology);
    expect(after.quest).toBe(before.quest);
    expect(after.git).toBe(before.git);
    expect(after.detail).toBe(before.detail);
  });

  it("keeps duplicate and stale same-generation snapshots identity-preserving", () => {
    const snapshot = attentionEnvelope({ revision: 2 });
    useStore.getState().applySyncedProjectionSnapshot(snapshot);
    const beforeDuplicate = useStore.getState();

    expect(useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ revision: 2 }))).toEqual({
      applied: false,
      accepted: true,
      requestResync: false,
    });
    expect(useStore.getState()).toBe(beforeDuplicate);

    expect(useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ revision: 1 }))).toEqual({
      applied: false,
      accepted: false,
      requestResync: false,
    });
    expect(useStore.getState()).toBe(beforeDuplicate);
  });

  it("requests resync without replacing a same-revision conflicting value", () => {
    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ revision: 2, count: 1 }));
    const before = useStore.getState();
    const value = getSessionAttentionProjection(before, "s1");

    expect(useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ revision: 2, count: 9 }))).toEqual({
      applied: false,
      accepted: false,
      requestResync: true,
    });
    expect(useStore.getState()).toBe(before);
    expect(getSessionAttentionProjection(useStore.getState(), "s1")).toBe(value);
  });

  it("advances an equal newer snapshot without replacing the stored value reference", () => {
    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ revision: 1 }));
    const before = useStore.getState();
    const value = getSessionAttentionProjection(before, "s1");

    expect(useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ revision: 3 }))).toEqual({
      applied: true,
      accepted: true,
      requestResync: false,
    });
    const after = useStore.getState();
    expect(after.syncedProjectionValues).toBe(before.syncedProjectionValues);
    expect(after.syncedProjectionKeys).toBe(before.syncedProjectionKeys);
    expect(after.sessionAttention).toBe(before.sessionAttention);
    expect(after.syncedProjectionVersions).not.toBe(before.syncedProjectionVersions);
    expect(getSessionAttentionProjection(after, "s1")).toBe(value);
    expect(after.syncedProjectionVersions.get(syncedProjectionEntryId(SESSION_ATTENTION_PROJECTION, "s1"))).toEqual({
      generation: "generation-a",
      revision: 3,
    });
  });

  it("applies contiguous updates and provisionally applies a full replacement across a forward gap", () => {
    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ revision: 1 }));

    expect(
      useStore
        .getState()
        .applySyncedProjectionUpdate(attentionEnvelope({ type: "synced_projection_update", revision: 2, count: 2 })),
    ).toEqual({ applied: true, accepted: true, requestResync: false });
    expect(getSessionAttentionProjection(useStore.getState(), "s1")?.status?.count).toBe(2);

    expect(
      useStore
        .getState()
        .applySyncedProjectionUpdate(attentionEnvelope({ type: "synced_projection_update", revision: 5, count: 5 })),
    ).toEqual({ applied: true, accepted: true, requestResync: true });
    expect(getSessionAttentionProjection(useStore.getState(), "s1")?.status?.count).toBe(5);
  });

  it("preserves authority and compatibility-map identities for count-only updates", () => {
    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ revision: 1, count: 1 }));
    const before = useStore.getState();

    useStore
      .getState()
      .applySyncedProjectionUpdate(attentionEnvelope({ type: "synced_projection_update", revision: 2, count: 2 }));
    const after = useStore.getState();

    expect(after.syncedProjectionValues).not.toBe(before.syncedProjectionValues);
    expect(after.syncedProjectionKeys).toBe(before.syncedProjectionKeys);
    expect(after.sessionAttention).toBe(before.sessionAttention);
    expect(after.sessionAttention.get("s1")).toBe("review");
  });

  it("requires a snapshot before adopting a missing or different update generation", () => {
    expect(
      useStore
        .getState()
        .applySyncedProjectionUpdate(attentionEnvelope({ type: "synced_projection_update", revision: 1 })),
    ).toEqual({ applied: false, accepted: false, requestResync: true });
    expect(hasSessionAttentionProjection(useStore.getState(), "s1")).toBe(false);

    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ revision: 1 }));
    const value = getSessionAttentionProjection(useStore.getState(), "s1");
    expect(
      useStore
        .getState()
        .applySyncedProjectionUpdate(
          attentionEnvelope({ type: "synced_projection_update", generation: "generation-b", revision: 2, count: 9 }),
        ),
    ).toEqual({ applied: false, accepted: false, requestResync: true });
    expect(getSessionAttentionProjection(useStore.getState(), "s1")).toBe(value);

    expect(
      useStore
        .getState()
        .applySyncedProjectionSnapshot(attentionEnvelope({ generation: "generation-b", revision: 1, count: 9 })),
    ).toEqual({ applied: true, accepted: true, requestResync: false });
    expect(getSessionAttentionProjection(useStore.getState(), "s1")?.status?.count).toBe(9);
  });

  it("rejects an older REST request from a different generation", () => {
    expect(
      useStore
        .getState()
        .applySyncedProjectionSnapshot(attentionEnvelope({ generation: "generation-new", revision: 1, count: 2 }), {
          source: "rest",
          activeRequestSequence: 2,
        }),
    ).toEqual({ applied: true, accepted: true, requestResync: false });

    expect(
      useStore
        .getState()
        .applySyncedProjectionSnapshot(attentionEnvelope({ generation: "generation-old", revision: 50, count: 9 }), {
          source: "rest",
          activeRequestSequence: 1,
        }),
    ).toEqual({ applied: false, accepted: false, requestResync: false });
    expect(getSessionAttentionProjection(useStore.getState(), "s1")?.status?.count).toBe(2);
    expect(
      useStore.getState().syncedProjectionVersions.get(syncedProjectionEntryId(SESSION_ATTENTION_PROJECTION, "s1")),
    ).toEqual({ generation: "generation-new", revision: 1 });
  });

  it("fences pre-live REST generations while allowing a genuinely later generation", () => {
    useStore
      .getState()
      .applySyncedProjectionSnapshot(attentionEnvelope({ generation: "generation-live", revision: 1, count: 2 }), {
        source: "live",
        activeRequestSequence: 4,
      });

    expect(
      useStore
        .getState()
        .applySyncedProjectionSnapshot(attentionEnvelope({ generation: "generation-stale", revision: 20, count: 9 }), {
          source: "rest",
          activeRequestSequence: 4,
        }),
    ).toMatchObject({ accepted: false, requestResync: false });
    expect(getSessionAttentionProjection(useStore.getState(), "s1")?.status?.count).toBe(2);

    expect(
      useStore
        .getState()
        .applySyncedProjectionSnapshot(
          attentionEnvelope({ generation: "generation-restarted", revision: 1, count: 3 }),
          { source: "rest", activeRequestSequence: 5 },
        ),
    ).toMatchObject({ accepted: true, requestResync: false });
    expect(getSessionAttentionProjection(useStore.getState(), "s1")?.status?.count).toBe(3);
  });

  it("reconciles projection authority to the acknowledged complete subscription set", () => {
    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ key: "s1" }));
    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ key: "s2" }));
    useStore.getState().applySyncedProjectionSnapshot(createSessionNavigationProjectionEnvelope({ key: "s1" }));
    useStore.getState().applySyncedProjectionSnapshot(createSessionNavigationProjectionEnvelope({ key: "s2" }));

    useStore.getState().reconcileSyncedProjectionAuthority([
      { projection: SESSION_ATTENTION_PROJECTION, key: "s1" },
      { projection: SESSION_NAVIGATION_PROJECTION, key: "s1" },
    ]);

    expect(hasSessionAttentionProjection(useStore.getState(), "s1")).toBe(true);
    expect(hasSessionNavigationProjection(useStore.getState(), "s1")).toBe(true);
    expect(hasSessionAttentionProjection(useStore.getState(), "s2")).toBe(false);
    expect(hasSessionNavigationProjection(useStore.getState(), "s2")).toBe(false);
    expect(useStore.getState().sessionAttention.has("s2")).toBe(false);
  });

  it("fails closed for unknown and malformed projections", () => {
    const malformed = attentionEnvelope({}) as Record<string, unknown>;
    malformed.revision = 0;
    expect(useStore.getState().applySyncedProjectionSnapshot(malformed)).toEqual({
      applied: false,
      accepted: false,
      requestResync: false,
    });

    expect(
      useStore.getState().applySyncedProjectionSnapshot({
        ...attentionEnvelope({}),
        projection: "unknown-projection",
      }),
    ).toEqual({ applied: false, accepted: false, requestResync: false });

    const malformedNavigation = createSessionNavigationProjectionEnvelope({}) as Record<string, unknown>;
    malformedNavigation.value = {
      ...(malformedNavigation.value as Record<string, unknown>),
      lifecycle: { status: "running" },
    };
    expect(useStore.getState().applySyncedProjectionSnapshot(malformedNavigation)).toEqual({
      applied: false,
      accepted: false,
      requestResync: false,
    });
    expect(useStore.getState().syncedProjectionKeys.size).toBe(0);
  });

  it("keeps projection-owned attention out of explicit-command and permission-clearing optimism", () => {
    useStore.setState({
      sdkSessions: [{ sessionId: "s1", archived: false } as never, { sessionId: "legacy", archived: false } as never],
      sessionAttention: new Map([
        ["s1", "review"],
        ["legacy", "review"],
      ]),
    });
    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({}));

    useStore.getState().markSessionViewed("s1");
    useStore.getState().clearSessionAttention("s1");
    useStore.getState().markSessionUnread("s1");
    expect(useStore.getState().sessionAttention.get("s1")).toBe("review");
    expect(apiMocks.markSessionUnread).toHaveBeenCalledWith("s1");

    useStore.getState().markAllSessionsViewed();
    expect(useStore.getState().sessionAttention.get("s1")).toBe("review");
    expect(useStore.getState().sessionAttention.get("legacy")).toBeNull();
    expect(apiMocks.markAllSessionsRead).toHaveBeenCalledTimes(1);

    useStore.getState().addPermission("s1", { request_id: "p1" } as never);
    useStore.getState().removePermission("s1", "p1");
    useStore.getState().clearPermissions("s1");
    expect(useStore.getState().sessionAttention.get("s1")).toBe("review");
  });

  it("clears every projection for one key without disturbing another session", () => {
    useStore
      .getState()
      .applySyncedProjectionSnapshots([
        attentionEnvelope({ key: "s1" }),
        createSessionNavigationProjectionEnvelope({ key: "s1" }),
        attentionEnvelope({ key: "s2" }),
        createSessionNavigationProjectionEnvelope({ key: "s2" }),
      ]);

    useStore.getState().clearSyncedProjectionsForKey("s1");

    expect(hasSessionAttentionProjection(useStore.getState(), "s1")).toBe(false);
    expect(hasSessionNavigationProjection(useStore.getState(), "s1")).toBe(false);
    expect(useStore.getState().sessionAttention.has("s1")).toBe(false);
    expect(hasSessionAttentionProjection(useStore.getState(), "s2")).toBe(true);
    expect(hasSessionNavigationProjection(useStore.getState(), "s2")).toBe(true);
  });

  it("cleans projection maps when a session is removed or the store resets", () => {
    useStore.setState({ sdkSessions: [{ sessionId: "s1" } as never] });
    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({}));
    useStore.getState().applySyncedProjectionSnapshot(createSessionNavigationProjectionEnvelope({ key: "s1" }));
    useStore.getState().removeSession("s1");

    expect(hasSessionAttentionProjection(useStore.getState(), "s1")).toBe(false);
    expect(hasSessionNavigationProjection(useStore.getState(), "s1")).toBe(false);
    expect(useStore.getState().syncedProjectionVersions.size).toBe(0);
    expect(useStore.getState().sessionAttention.has("s1")).toBe(false);

    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ key: "s2" }));
    useStore.getState().reset();
    expect(useStore.getState().syncedProjectionValues.size).toBe(0);
    expect(useStore.getState().syncedProjectionVersions.size).toBe(0);
    expect(useStore.getState().syncedProjectionKeys.size).toBe(0);
    expect(useStore.getState().syncedProjectionOrderings.size).toBe(0);
  });
});
