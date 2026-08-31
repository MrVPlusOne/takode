// @vitest-environment jsdom

import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  SESSION_ATTENTION_PROJECTION,
  SESSION_ATTENTION_PROJECTION_MAX_VALUE_BYTES,
  type SessionAttentionProjectionValue,
} from "../shared/session-attention-projection.js";
import {
  SESSION_NAVIGATION_PROJECTION,
  SESSION_NAVIGATION_PROJECTION_MAX_VALUE_BYTES,
} from "../shared/session-navigation-projection.js";
import { syncedProjectionEntryId } from "../shared/synced-projection.js";
import { createSessionNavigationProjectionEnvelope } from "./test-fixtures/session-navigation-projection.js";
import { getSyncedProjectionValue, hasSyncedProjectionValue } from "./store-synced-projections.js";

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
    projection: SESSION_ATTENTION_PROJECTION,
    key: options.key ?? "s1",
    generation: options.generation ?? "generation-a",
    revision: options.revision ?? 1,
    value: {
      attentionReason: options.reason === undefined ? "review" : options.reason,
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

function navigationPatchEnvelope(options: {
  key?: string;
  generation?: string;
  revision: number;
  patch: Record<string, unknown>;
}) {
  return {
    type: "synced_projection_update",
    projection: SESSION_NAVIGATION_PROJECTION,
    key: options.key ?? "s1",
    generation: options.generation ?? "navigation-generation-a",
    revision: options.revision,
    patch: options.patch,
  } as const;
}

beforeEach(() => {
  localStorage.clear();
  useStore.getState().reset();
});

describe("synced projection store", () => {
  it("installs a new-generation snapshot and exposes typed value and authority helpers", () => {
    const result = useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({}));
    const state = useStore.getState();

    expect(result).toEqual({ applied: true, accepted: true, requestResync: false });
    expectTypeOf(getSyncedProjectionValue(state, SESSION_ATTENTION_PROJECTION, "s1")).toEqualTypeOf<
      SessionAttentionProjectionValue | undefined
    >();
    expect(getSyncedProjectionValue(state, SESSION_ATTENTION_PROJECTION, "s1")).toEqual({
      attentionReason: "review",
      status: { urgency: "review", count: 1 },
    });
    expect(hasSyncedProjectionValue(state, SESSION_ATTENTION_PROJECTION, "s1")).toBe(true);
    expect(getSyncedProjectionValue(state, SESSION_ATTENTION_PROJECTION, "s1")).toBe(
      getSyncedProjectionValue(state, SESSION_ATTENTION_PROJECTION, "s1"),
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
    expect(hasSyncedProjectionValue(useStore.getState(), SESSION_ATTENTION_PROJECTION, "s1")).toBe(true);
    expect(hasSyncedProjectionValue(useStore.getState(), SESSION_NAVIGATION_PROJECTION, "s1")).toBe(true);
    expect(hasSyncedProjectionValue(useStore.getState(), SESSION_ATTENTION_PROJECTION, "s2")).toBe(true);
    expect(hasSyncedProjectionValue(useStore.getState(), SESSION_NAVIGATION_PROJECTION, "s2")).toBe(true);

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

  it("materializes accepted navigation values into one SDK row without replacing unrelated rows", () => {
    const first = { sessionId: "s1", state: "connected", cwd: "/legacy", createdAt: 1, name: "Legacy" } as const;
    const second = { sessionId: "s2", state: "connected", cwd: "/other", createdAt: 2, name: "Other" } as const;
    useStore.setState({ sdkSessions: [first, second] as never });

    useStore.getState().applySyncedProjectionSnapshot(
      createSessionNavigationProjectionEnvelope({
        key: "s1",
        revision: 1,
        overrides: { identity: { name: "Projected" }, lifecycle: { status: "idle" } },
      }),
      { source: "live" },
    );
    const afterSnapshot = useStore.getState().sdkSessions;
    expect(afterSnapshot[0]).toMatchObject({ name: "Projected", status: "idle", pendingPermissionCount: 0 });
    expect(afterSnapshot[1]).toBe(second);

    const unchanged = afterSnapshot[1];
    const patch = navigationPatchEnvelope({ revision: 2, patch: { status: "running" } });
    useStore.getState().applySyncedProjectionUpdate(patch);
    const afterPatch = useStore.getState().sdkSessions;
    expect(afterPatch[0]).not.toBe(afterSnapshot[0]);
    expect(afterPatch[0]?.status).toBe("running");
    expect(afterPatch[1]).toBe(unchanged);

    const beforeDuplicate = useStore.getState();
    useStore.getState().applySyncedProjectionUpdate(patch);
    expect(useStore.getState()).toBe(beforeDuplicate);
    expect(useStore.getState().sdkSessions).toBe(afterPatch);
  });

  it("publishes live navigation name and claim changes with rename animation atomically", () => {
    const first = { sessionId: "s1", state: "connected", cwd: "/repo", createdAt: 1, name: "Original" } as const;
    const second = { sessionId: "s2", state: "connected", cwd: "/repo", createdAt: 2, name: "Other" } as const;
    useStore.setState({ sdkSessions: [first, second] as never });
    useStore.getState().applySyncedProjectionSnapshot(
      createSessionNavigationProjectionEnvelope({
        key: "s1",
        overrides: { identity: { name: "Original" } },
      }),
      { source: "live" },
    );

    const observed: Array<{ name?: string; claimedQuestId?: string | null; renamed: boolean }> = [];
    const unsubscribe = useStore.subscribe((state) => {
      observed.push({
        name: state.sdkSessions[0]?.name,
        claimedQuestId: state.sdkSessions[0]?.claimedQuestId,
        renamed: state.recentlyRenamed.has("s1"),
      });
    });
    useStore.getState().applySyncedProjectionUpdate(
      navigationPatchEnvelope({
        revision: 2,
        patch: {
          name: "Renamed",
          claimedQuestId: "q-42",
          claimedQuestTitle: "Canonical quest",
          claimedQuestStatus: "in_progress",
        },
      }),
    );
    unsubscribe();

    expect(observed).toEqual([{ name: "Renamed", claimedQuestId: "q-42", renamed: true }]);
    expect(useStore.getState().sdkSessions[1]).toBe(second);

    useStore.getState().clearRecentlyRenamed("s1");
    useStore
      .getState()
      .applySyncedProjectionUpdate(navigationPatchEnvelope({ revision: 3, patch: { claimedQuestStatus: "done" } }));
    expect(useStore.getState().recentlyRenamed.has("s1")).toBe(false);
  });

  it("never replays rename animation from live, reconnect, or REST snapshots", () => {
    useStore.setState({
      sdkSessions: [{ sessionId: "s1", state: "connected", cwd: "/repo", createdAt: 1, name: "Before" }] as never,
    });

    useStore.getState().applySyncedProjectionSnapshot(
      createSessionNavigationProjectionEnvelope({
        revision: 1,
        overrides: { identity: { name: "Initial snapshot" } },
      }),
      { source: "live", activeRequestSequence: 1 },
    );
    expect(useStore.getState().sdkSessions[0]?.name).toBe("Initial snapshot");
    expect(useStore.getState().recentlyRenamed.has("s1")).toBe(false);

    useStore.getState().applySyncedProjectionSnapshot(
      createSessionNavigationProjectionEnvelope({
        revision: 2,
        overrides: { identity: { name: "Reconnect snapshot" } },
      }),
      { source: "live", activeRequestSequence: 1 },
    );
    expect(useStore.getState().sdkSessions[0]?.name).toBe("Reconnect snapshot");
    expect(useStore.getState().recentlyRenamed.has("s1")).toBe(false);

    useStore.getState().applySyncedProjectionSnapshots(
      [
        createSessionNavigationProjectionEnvelope({
          revision: 3,
          overrides: { identity: { name: "REST snapshot" } },
        }),
      ],
      { source: "rest", activeRequestSequence: 2 },
    );
    expect(useStore.getState().sdkSessions[0]?.name).toBe("REST snapshot");
    expect(useStore.getState().recentlyRenamed.has("s1")).toBe(false);
  });

  it("validates navigation snapshots and preserves unchanged fields across full updates", () => {
    const initial = createSessionNavigationProjectionEnvelope({ key: "s1", revision: 1 });
    expect(useStore.getState().applySyncedProjectionSnapshot(initial)).toEqual({
      applied: true,
      accepted: true,
      requestResync: false,
    });
    const before = getSyncedProjectionValue(useStore.getState(), SESSION_NAVIGATION_PROJECTION, "s1")!;
    expect(hasSyncedProjectionValue(useStore.getState(), SESSION_NAVIGATION_PROJECTION, "s1")).toBe(true);

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

    const after = getSyncedProjectionValue(useStore.getState(), SESSION_NAVIGATION_PROJECTION, "s1")!;
    expect(after).not.toBe(before);
    expect(after).toMatchObject({ pendingPermissionCount: 2, status: "running" });
    expect(after.name).toBe(before.name);
    expect(after.lastMessagePreview).toBe(before.lastMessagePreview);
  });

  it("applies contiguous navigation field patches and suppresses exact duplicate delivery", () => {
    useStore.getState().applySyncedProjectionSnapshot(createSessionNavigationProjectionEnvelope({ revision: 1 }), {
      source: "live",
    });
    const before = getSyncedProjectionValue(useStore.getState(), SESSION_NAVIGATION_PROJECTION, "s1")!;
    const patch = navigationPatchEnvelope({
      revision: 2,
      patch: { status: "running", pendingPermissionCount: 2 },
    });

    expect(useStore.getState().applySyncedProjectionUpdate(patch)).toEqual({
      applied: true,
      accepted: true,
      requestResync: false,
    });
    const after = getSyncedProjectionValue(useStore.getState(), SESSION_NAVIGATION_PROJECTION, "s1")!;
    expect(after).not.toBe(before);
    expect(after).toMatchObject({ status: "running", pendingPermissionCount: 2 });
    expect(after.lastMessagePreview).toBe(before.lastMessagePreview);

    const beforeDuplicate = useStore.getState();
    expect(useStore.getState().applySyncedProjectionUpdate(patch)).toEqual({
      applied: false,
      accepted: true,
      requestResync: false,
    });
    expect(useStore.getState()).toBe(beforeDuplicate);
    expect(getSyncedProjectionValue(useStore.getState(), SESSION_NAVIGATION_PROJECTION, "s1")).toBe(after);
  });

  it("rejects unknown navigation patch fields and retains the accepted value while requesting resync", () => {
    useStore.setState({
      sdkSessions: [{ sessionId: "s1", state: "connected", cwd: "/repo", createdAt: 1 }] as never,
    });
    useStore.getState().applySyncedProjectionSnapshot(createSessionNavigationProjectionEnvelope({ revision: 1 }), {
      source: "live",
    });
    const before = getSyncedProjectionValue(useStore.getState(), SESSION_NAVIGATION_PROJECTION, "s1")!;
    const beforeRow = useStore.getState().sdkSessions[0];
    const beforeVersion = useStore
      .getState()
      .syncedProjectionVersions.get(syncedProjectionEntryId(SESSION_NAVIGATION_PROJECTION, "s1"));

    expect(
      useStore
        .getState()
        .applySyncedProjectionUpdate(navigationPatchEnvelope({ revision: 2, patch: { legacyStatus: "running" } })),
    ).toEqual({ applied: false, accepted: false, requestResync: true });
    expect(getSyncedProjectionValue(useStore.getState(), SESSION_NAVIGATION_PROJECTION, "s1")).toBe(before);
    expect(useStore.getState().sdkSessions[0]).toBe(beforeRow);
    expect(
      useStore.getState().syncedProjectionVersions.get(syncedProjectionEntryId(SESSION_NAVIGATION_PROJECTION, "s1")),
    ).toEqual(beforeVersion);
  });

  it("rejects a forward-gap navigation field patch and retains the accepted revision for resync", () => {
    useStore.setState({
      sdkSessions: [{ sessionId: "s1", state: "connected", cwd: "/repo", createdAt: 1 }] as never,
    });
    useStore.getState().applySyncedProjectionSnapshot(createSessionNavigationProjectionEnvelope({ revision: 1 }), {
      source: "live",
    });
    const before = getSyncedProjectionValue(useStore.getState(), SESSION_NAVIGATION_PROJECTION, "s1")!;
    const beforeRow = useStore.getState().sdkSessions[0];

    expect(
      useStore
        .getState()
        .applySyncedProjectionUpdate(navigationPatchEnvelope({ revision: 3, patch: { status: "running" } })),
    ).toEqual({ applied: false, accepted: false, requestResync: true });
    expect(getSyncedProjectionValue(useStore.getState(), SESSION_NAVIGATION_PROJECTION, "s1")).toBe(before);
    expect(useStore.getState().sdkSessions[0]).toBe(beforeRow);
    expect(
      useStore.getState().syncedProjectionVersions.get(syncedProjectionEntryId(SESSION_NAVIGATION_PROJECTION, "s1")),
    ).toEqual({ generation: "navigation-generation-a", revision: 1 });
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
    const value = getSyncedProjectionValue(before, SESSION_ATTENTION_PROJECTION, "s1");

    expect(useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ revision: 2, count: 9 }))).toEqual({
      applied: false,
      accepted: false,
      requestResync: true,
    });
    expect(useStore.getState()).toBe(before);
    expect(getSyncedProjectionValue(useStore.getState(), SESSION_ATTENTION_PROJECTION, "s1")).toBe(value);
  });

  it("advances an equal newer snapshot without replacing the stored value reference", () => {
    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ revision: 1 }));
    const before = useStore.getState();
    const value = getSyncedProjectionValue(before, SESSION_ATTENTION_PROJECTION, "s1");

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
    expect(getSyncedProjectionValue(after, SESSION_ATTENTION_PROJECTION, "s1")).toBe(value);
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
    expect(getSyncedProjectionValue(useStore.getState(), SESSION_ATTENTION_PROJECTION, "s1")?.status?.count).toBe(2);

    expect(
      useStore
        .getState()
        .applySyncedProjectionUpdate(attentionEnvelope({ type: "synced_projection_update", revision: 5, count: 5 })),
    ).toEqual({ applied: true, accepted: true, requestResync: true });
    expect(getSyncedProjectionValue(useStore.getState(), SESSION_ATTENTION_PROJECTION, "s1")?.status?.count).toBe(5);
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
    expect(hasSyncedProjectionValue(useStore.getState(), SESSION_ATTENTION_PROJECTION, "s1")).toBe(false);

    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({ revision: 1 }));
    const value = getSyncedProjectionValue(useStore.getState(), SESSION_ATTENTION_PROJECTION, "s1");
    expect(
      useStore
        .getState()
        .applySyncedProjectionUpdate(
          attentionEnvelope({ type: "synced_projection_update", generation: "generation-b", revision: 2, count: 9 }),
        ),
    ).toEqual({ applied: false, accepted: false, requestResync: true });
    expect(getSyncedProjectionValue(useStore.getState(), SESSION_ATTENTION_PROJECTION, "s1")).toBe(value);

    expect(
      useStore
        .getState()
        .applySyncedProjectionSnapshot(attentionEnvelope({ generation: "generation-b", revision: 1, count: 9 })),
    ).toEqual({ applied: true, accepted: true, requestResync: false });
    expect(getSyncedProjectionValue(useStore.getState(), SESSION_ATTENTION_PROJECTION, "s1")?.status?.count).toBe(9);
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
    expect(getSyncedProjectionValue(useStore.getState(), SESSION_ATTENTION_PROJECTION, "s1")?.status?.count).toBe(2);
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
    expect(getSyncedProjectionValue(useStore.getState(), SESSION_ATTENTION_PROJECTION, "s1")?.status?.count).toBe(2);

    expect(
      useStore
        .getState()
        .applySyncedProjectionSnapshot(
          attentionEnvelope({ generation: "generation-restarted", revision: 1, count: 3 }),
          { source: "rest", activeRequestSequence: 5 },
        ),
    ).toMatchObject({ accepted: true, requestResync: false });
    expect(getSyncedProjectionValue(useStore.getState(), SESSION_ATTENTION_PROJECTION, "s1")?.status?.count).toBe(3);
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

    expect(hasSyncedProjectionValue(useStore.getState(), SESSION_ATTENTION_PROJECTION, "s1")).toBe(true);
    expect(hasSyncedProjectionValue(useStore.getState(), SESSION_NAVIGATION_PROJECTION, "s1")).toBe(true);
    expect(hasSyncedProjectionValue(useStore.getState(), SESSION_ATTENTION_PROJECTION, "s2")).toBe(false);
    expect(hasSyncedProjectionValue(useStore.getState(), SESSION_NAVIGATION_PROJECTION, "s2")).toBe(false);
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

  it("fails closed for inherited projection IDs and descriptor-oversized values", () => {
    for (const projection of ["__proto__", "constructor"]) {
      expect(() =>
        useStore.getState().applySyncedProjectionSnapshot({
          ...attentionEnvelope({}),
          projection,
        }),
      ).not.toThrow();
      expect(
        useStore.getState().applySyncedProjectionSnapshot({
          ...attentionEnvelope({}),
          projection,
        }),
      ).toEqual({ applied: false, accepted: false, requestResync: false });
    }

    const oversizedAttention = attentionEnvelope({}) as Record<string, unknown>;
    oversizedAttention.value = {
      ...(oversizedAttention.value as Record<string, unknown>),
      padding: "x".repeat(SESSION_ATTENTION_PROJECTION_MAX_VALUE_BYTES),
    };
    expect(useStore.getState().applySyncedProjectionSnapshot(oversizedAttention)).toEqual({
      applied: false,
      accepted: false,
      requestResync: false,
    });

    const oversizedNavigation = createSessionNavigationProjectionEnvelope({}) as Record<string, unknown>;
    oversizedNavigation.value = {
      ...(oversizedNavigation.value as Record<string, unknown>),
      padding: "x".repeat(SESSION_NAVIGATION_PROJECTION_MAX_VALUE_BYTES),
    };
    expect(useStore.getState().applySyncedProjectionSnapshot(oversizedNavigation)).toEqual({
      applied: false,
      accepted: false,
      requestResync: false,
    });
    expect(useStore.getState().syncedProjectionKeys.size).toBe(0);
  });

  it("changes the projection-owned reason index only through accepted projection state", () => {
    useStore.setState({
      sdkSessions: [{ sessionId: "s1", archived: false } as never],
      sessionAttention: new Map([["s1", "review"]]),
    });
    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({}));

    useStore.getState().addPermission("s1", { request_id: "p1" } as never);
    useStore.getState().removePermission("s1", "p1");
    useStore.getState().clearPermissions("s1");
    expect(useStore.getState().sessionAttention.get("s1")).toBe("review");

    useStore
      .getState()
      .applySyncedProjectionUpdate(
        attentionEnvelope({ type: "synced_projection_update", revision: 2, reason: null, urgency: null }),
      );
    expect(useStore.getState().sessionAttention.get("s1")).toBeNull();
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

    expect(hasSyncedProjectionValue(useStore.getState(), SESSION_ATTENTION_PROJECTION, "s1")).toBe(false);
    expect(hasSyncedProjectionValue(useStore.getState(), SESSION_NAVIGATION_PROJECTION, "s1")).toBe(false);
    expect(useStore.getState().sessionAttention.has("s1")).toBe(false);
    expect(hasSyncedProjectionValue(useStore.getState(), SESSION_ATTENTION_PROJECTION, "s2")).toBe(true);
    expect(hasSyncedProjectionValue(useStore.getState(), SESSION_NAVIGATION_PROJECTION, "s2")).toBe(true);
  });

  it("cleans projection maps when a session is removed or the store resets", () => {
    useStore.setState({ sdkSessions: [{ sessionId: "s1" } as never] });
    useStore.getState().applySyncedProjectionSnapshot(attentionEnvelope({}));
    useStore.getState().applySyncedProjectionSnapshot(createSessionNavigationProjectionEnvelope({ key: "s1" }));
    useStore.getState().removeSession("s1");

    expect(hasSyncedProjectionValue(useStore.getState(), SESSION_ATTENTION_PROJECTION, "s1")).toBe(false);
    expect(hasSyncedProjectionValue(useStore.getState(), SESSION_NAVIGATION_PROJECTION, "s1")).toBe(false);
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
