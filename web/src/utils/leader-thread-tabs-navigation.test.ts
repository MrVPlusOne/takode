import { describe, expect, it } from "vitest";
import { createLeaderThreadTabsProjectionValue } from "../test-fixtures/leader-thread-tabs-projection.js";
import {
  mergeProjectedLeaderThreadRows,
  mergeProjectedTabsWithRestoredOrder,
} from "./leader-thread-tabs-navigation.js";

describe("leader thread tabs navigation projection", () => {
  it("preserves stronger done-thread completion over a stale projected active phase", () => {
    const projection = createLeaderThreadTabsProjectionValue({
      tabs: [
        {
          ...createLeaderThreadTabsProjectionValue().tabs[0]!,
          threadKey: "q-700",
          questId: "q-700",
          title: "Projected stale active row",
          boardStatus: "PORTING",
          completed: false,
          active: true,
          canClose: false,
        },
      ],
      tabState: {
        version: 1,
        orderedOpenThreadKeys: ["q-700"],
        closedThreadTombstones: [],
        updatedAt: 20,
      },
    });

    const [row] = mergeProjectedLeaderThreadRows(
      [
        {
          threadKey: "q-700",
          questId: "q-700",
          title: "Archived thread",
          section: "done" as const,
          messageCount: 2,
          createdAt: 1,
        },
      ],
      projection,
      new Map(),
    );

    expect(row).toMatchObject({ threadKey: "q-700", status: "done", section: "done" });
  });

  it("keeps restored local order while projected visuals cover overlapping and newly derived tabs", () => {
    const restored = [
      { threadKey: "q-701", title: "Local A" },
      { threadKey: "q-702", title: "Local stale" },
    ];
    const projected = [
      { threadKey: "q-702", title: "Projected current" },
      { threadKey: "q-703", title: "Derived" },
    ];

    expect(mergeProjectedTabsWithRestoredOrder(projected, restored)).toEqual([
      { threadKey: "q-701", title: "Local A" },
      { threadKey: "q-702", title: "Projected current" },
      { threadKey: "q-703", title: "Derived" },
    ]);
  });
});
