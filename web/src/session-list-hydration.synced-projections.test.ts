// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_ATTENTION_PROJECTION } from "../shared/session-attention-projection.js";
import { SYNCED_PROJECTION_SCHEMA_VERSION } from "../shared/synced-projection.js";
import { getSessionAttentionProjection, hasSessionAttentionProjection } from "./store-synced-projections.js";

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
        }),
      ],
      { preserveMissingArchived: true, activeSnapshotRequestSequence: 1 },
    );

    expect(getSessionAttentionProjection(useStore.getState(), "s1")?.status?.count).toBe(2);
    expect(useStore.getState().syncedProjectionVersions.get(`${SESSION_ATTENTION_PROJECTION}\u0000s1`)).toEqual({
      generation: "generation-new",
      revision: 1,
    });
  });

  it("revokes projection authority when archive is authoritatively confirmed", () => {
    hydrateSessionList([session({ sessionAttentionProjection: projectionSnapshot() })]);
    expect(hasSessionAttentionProjection(useStore.getState(), "s1")).toBe(true);

    applyAuthoritativeSessionArchive("s1", 1234);

    expect(useStore.getState().sdkSessions[0]).toMatchObject({ sessionId: "s1", archived: true, archivedAt: 1234 });
    expect(hasSessionAttentionProjection(useStore.getState(), "s1")).toBe(false);
    expect(useStore.getState().sessionAttention.has("s1")).toBe(false);
  });

  it("does not let a fenced pre-archive REST response reinstall projection authority", () => {
    hydrateSessionList([session({ sessionAttentionProjection: projectionSnapshot() })]);
    const staleRequestSequence = beginActiveSessionListRequest();
    applyAuthoritativeSessionArchive("s1", 1234);

    hydrateSessionList(
      [
        session({
          sessionAttentionProjection: {
            ...projectionSnapshot({ revision: 9 }),
            generation: "stale-pre-archive-generation",
          },
        }),
      ],
      { preserveMissingArchived: true, activeSnapshotRequestSequence: staleRequestSequence },
    );

    expect(useStore.getState().sdkSessions[0]).toMatchObject({ sessionId: "s1", archived: true, archivedAt: 1234 });
    expect(hasSessionAttentionProjection(useStore.getState(), "s1")).toBe(false);
    expect(useStore.getState().sessionAttention.has("s1")).toBe(false);
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
