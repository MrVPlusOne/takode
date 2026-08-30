import { describe, expect, it } from "vitest";
import {
  isInMotionLeaderThreadTabRow,
  isNeverStartedScheduledLeaderThreadTabRow,
  isScheduledLeaderThreadTabStatus,
  promoteInMotionLeaderThreadTabsBeforeScheduled,
} from "./leader-thread-tab-priority.js";

describe("leader thread tab priority", () => {
  it("classifies active Journey phases and only active decision checkpoints as in motion", () => {
    // The priority class follows canonical Journey execution, not mere board presence.
    expect(isInMotionLeaderThreadTabRow({ status: "PLANNING" })).toBe(true);
    expect(isInMotionLeaderThreadTabRow({ status: "WORKING" })).toBe(true);
    expect(isInMotionLeaderThreadTabRow({ status: "MEMORY" })).toBe(true);
    expect(isInMotionLeaderThreadTabRow({ status: "USER_CHECKPOINTING", waitForInput: ["n-1"] })).toBe(true);
    expect(isInMotionLeaderThreadTabRow({ status: "USER_CHECKPOINTING", waitForInput: [] })).toBe(false);
    expect(isInMotionLeaderThreadTabRow({ status: "QUEUED" })).toBe(false);
    expect(isInMotionLeaderThreadTabRow({ status: "PROPOSED" })).toBe(false);
    expect(isInMotionLeaderThreadTabRow({ status: "WORKING", completedAt: 10 })).toBe(false);
    expect(isInMotionLeaderThreadTabRow({ status: "DONE" })).toBe(false);
    expect(isInMotionLeaderThreadTabRow({ status: "WAITING" })).toBe(false);
    expect(
      isInMotionLeaderThreadTabRow({
        journey: { mode: "active", phaseIds: ["alignment", "work", "memory"], activePhaseIndex: 1 },
      }),
    ).toBe(true);
    expect(isScheduledLeaderThreadTabStatus(" queued ")).toBe(true);
    expect(isScheduledLeaderThreadTabStatus("proposed")).toBe(true);
    expect(isScheduledLeaderThreadTabStatus("working")).toBe(false);
    expect(isNeverStartedScheduledLeaderThreadTabRow({ status: "QUEUED" })).toBe(true);
    expect(isNeverStartedScheduledLeaderThreadTabRow({ status: "QUEUED", threadTabActivatedAt: 50 })).toBe(false);
  });

  it("promotes only in-motion tabs across scheduled tabs while preserving peer order", () => {
    // Repair the reported inversion without turning projection refreshes into a global sort.
    const result = promoteInMotionLeaderThreadTabsBeforeScheduled(
      ["q-completed-a", "q-queued-a", "q-review", "q-work-a", "q-proposed", "q-memory", "q-completed-b"],
      new Set(["q-work-a", "q-memory"]),
      new Set(["q-queued-a", "q-proposed"]),
    );

    expect(result).toEqual([
      "q-completed-a",
      "q-work-a",
      "q-memory",
      "q-queued-a",
      "q-review",
      "q-proposed",
      "q-completed-b",
    ]);
  });

  it("does not disturb an already valid or unrelated order", () => {
    // Equal snapshots and unrelated peer classes must remain stable for no-op suppression.
    const valid = ["q-work-b", "q-work-a", "q-completed", "q-queued-b", "q-queued-a"];
    expect(
      promoteInMotionLeaderThreadTabsBeforeScheduled(
        valid,
        new Set(["q-work-b", "q-work-a"]),
        new Set(["q-queued-b", "q-queued-a"]),
      ),
    ).toEqual(valid);
    expect(promoteInMotionLeaderThreadTabsBeforeScheduled(["q-completed", "q-review"], new Set(), new Set())).toEqual([
      "q-completed",
      "q-review",
    ]);
  });
});
