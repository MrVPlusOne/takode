// @vitest-environment jsdom

import { act, render, screen } from "@testing-library/react";
import { Profiler, type ProfilerOnRenderCallback } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LEADER_THREAD_TABS_PROJECTION } from "../shared/leader-thread-tabs-projection.js";
import { syncedProjectionEntryId } from "../shared/synced-projection.js";
import {
  createLeaderThreadTabsProjectionEnvelope,
  createLeaderThreadTabsProjectionValue,
} from "./test-fixtures/leader-thread-tabs-projection.js";
import { getLeaderThreadTabsProjection, hasLeaderThreadTabsProjection } from "./store-synced-projections.js";

vi.mock("./api.js", () => ({
  api: {
    markSessionUnread: vi.fn().mockResolvedValue({ ok: true }),
    markAllSessionsRead: vi.fn().mockResolvedValue({ ok: true }),
  },
}));

import { useStore } from "./store.js";

beforeEach(() => {
  localStorage.clear();
  useStore.getState().reset();
});

describe("leader thread tabs synchronized projection store", () => {
  it("validates the projection and preserves unchanged slices, tabs, and statuses by identity", () => {
    expect(useStore.getState().applySyncedProjectionSnapshot(createLeaderThreadTabsProjectionEnvelope())).toEqual({
      applied: true,
      accepted: true,
      requestResync: false,
    });
    const before = getLeaderThreadTabsProjection(useStore.getState(), "s1")!;
    const next = createLeaderThreadTabsProjectionValue();
    next.tabs[1] = {
      ...next.tabs[1]!,
      attention: { ...next.tabs[1]!.attention, reviewUnread: false, updatedAt: 120 },
      updatedAt: 120,
    };
    next.threadStatuses["q-2"] = {
      kind: "ready",
      label: "Thread Ready",
      threadKey: "q-2",
      questId: "q-2",
      summary: "validation complete",
      messageId: "status-q-2-ready",
      timestamp: 120,
      updatedAt: 120,
    };

    expect(
      useStore
        .getState()
        .applySyncedProjectionUpdate(
          createLeaderThreadTabsProjectionEnvelope({ type: "synced_projection_update", revision: 2, value: next }),
        ),
    ).toEqual({ applied: true, accepted: true, requestResync: false });

    const after = getLeaderThreadTabsProjection(useStore.getState(), "s1")!;
    expect(after).not.toBe(before);
    expect(after.tabState).toBe(before.tabState);
    expect(after.tabs).not.toBe(before.tabs);
    expect(after.tabs[0]).toBe(before.tabs[0]);
    expect(after.tabs[1]).not.toBe(before.tabs[1]);
    expect(after.mainAttention).toBe(before.mainAttention);
    expect(after.threadStatuses).not.toBe(before.threadStatuses);
    expect(after.threadStatuses.main).toBe(before.threadStatuses.main);
    expect(after.threadStatuses["q-2"]).not.toBe(before.threadStatuses["q-2"]);
    expect(after.activePhaseSummary).toBe(before.activePhaseSummary);
    expect(hasLeaderThreadTabsProjection(useStore.getState(), "s1")).toBe(true);
  });

  it("accepts an explicit authoritative clear and rejects malformed order without reviving prior state", () => {
    useStore.getState().applySyncedProjectionSnapshot(createLeaderThreadTabsProjectionEnvelope());
    const cleared = createLeaderThreadTabsProjectionValue({
      tabState: null,
      tabs: [],
      mainAttention: { needsInput: false, mutedNeedsInput: false, reviewUnread: false, updatedAt: 0 },
      threadStatuses: {},
      activePhaseSummary: [],
    });

    expect(
      useStore
        .getState()
        .applySyncedProjectionUpdate(
          createLeaderThreadTabsProjectionEnvelope({ type: "synced_projection_update", revision: 2, value: cleared }),
        ),
    ).toEqual({ applied: true, accepted: true, requestResync: false });
    expect(getLeaderThreadTabsProjection(useStore.getState(), "s1")).toEqual(cleared);

    const malformed = createLeaderThreadTabsProjectionValue();
    malformed.tabState!.orderedOpenThreadKeys = ["q-2", "q-1"];
    const stateBeforeMalformed = useStore.getState();
    expect(
      useStore
        .getState()
        .applySyncedProjectionSnapshot(createLeaderThreadTabsProjectionEnvelope({ revision: 3, value: malformed })),
    ).toEqual({ applied: false, accepted: false, requestResync: false });
    expect(useStore.getState()).toBe(stateBeforeMalformed);
    expect(getLeaderThreadTabsProjection(useStore.getState(), "s1")).toEqual(cleared);
  });

  it("does not rerender an unchanged tab when another projected tab changes", () => {
    useStore.getState().applySyncedProjectionSnapshot(createLeaderThreadTabsProjectionEnvelope());
    const renderCounts = new Map<string, number>();
    const onRender: ProfilerOnRenderCallback = (id) => {
      renderCounts.set(id, (renderCounts.get(id) ?? 0) + 1);
    };

    function TabProbe({ threadKey }: { threadKey: string }) {
      const tab = useStore((state) =>
        getLeaderThreadTabsProjection(state, "s1")?.tabs.find((candidate) => candidate.threadKey === threadKey),
      );
      return <span>{tab?.attention.reviewUnread ? `${threadKey}:unread` : `${threadKey}:clear`}</span>;
    }

    render(
      <>
        <Profiler id="q-1" onRender={onRender}>
          <TabProbe threadKey="q-1" />
        </Profiler>
        <Profiler id="q-2" onRender={onRender}>
          <TabProbe threadKey="q-2" />
        </Profiler>
      </>,
    );
    expect(screen.getByText("q-1:clear")).toBeTruthy();
    expect(screen.getByText("q-2:unread")).toBeTruthy();
    expect(renderCounts).toEqual(
      new Map([
        ["q-1", 1],
        ["q-2", 1],
      ]),
    );

    act(() => {
      const next = createLeaderThreadTabsProjectionValue();
      next.tabs[1] = {
        ...next.tabs[1]!,
        attention: { ...next.tabs[1]!.attention, reviewUnread: false, updatedAt: 120 },
        updatedAt: 120,
      };
      useStore
        .getState()
        .applySyncedProjectionUpdate(
          createLeaderThreadTabsProjectionEnvelope({ type: "synced_projection_update", revision: 2, value: next }),
        );
    });

    expect(screen.getByText("q-1:clear")).toBeTruthy();
    expect(screen.getByText("q-2:clear")).toBeTruthy();
    expect(renderCounts).toEqual(
      new Map([
        ["q-1", 1],
        ["q-2", 2],
      ]),
    );

    act(() => {
      useStore.getState().applySyncedProjectionSnapshot(
        createLeaderThreadTabsProjectionEnvelope({
          revision: 3,
          value: getLeaderThreadTabsProjection(useStore.getState(), "s1")!,
        }),
      );
    });
    expect(renderCounts).toEqual(
      new Map([
        ["q-1", 1],
        ["q-2", 2],
      ]),
    );
    expect(
      useStore.getState().syncedProjectionVersions.get(syncedProjectionEntryId(LEADER_THREAD_TABS_PROJECTION, "s1")),
    ).toEqual({ generation: "leader-tabs-generation-a", revision: 3 });
  });
});
