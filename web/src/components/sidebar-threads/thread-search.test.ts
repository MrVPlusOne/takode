import { describe, expect, it } from "vitest";
import type { ThreadRow } from "./SidebarThreadsMode.js";
import { searchThreadRows } from "./thread-search.js";

// Universal Search lists threads by name above every tab's own results (Jiayi, Nov 10: a thread
// just read, "T9 FV training progress plots", couldn't be found by search), and with nothing typed
// the threads the user last dealt with or viewed.

const row = (title: string, at: number, activityAt = 0): ThreadRow =>
  ({
    key: `leader:${title}`,
    leader: { leader: { id: "leader", name: "Daily Leader", sessionNum: 2957 } },
    threadKey: title,
    questId: null,
    title,
    counts: { permission: 0, unread: 0, running: 0 },
    group: "idle",
    at,
    activityAt,
  }) as unknown as ThreadRow;

describe("searchThreadRows", () => {
  const rows = [
    row("T9 FV training progress plots", 300),
    row("T9 FV pass rate drops to zero", 100),
    row("Slow server restart again", 900),
    row("Lean eval tiers", 0, 950),
  ];

  it("matches every typed word by word start, the most recently dealt-with first", () => {
    expect(searchThreadRows(rows, "t9 fv").map((r) => r.title)).toEqual([
      "T9 FV training progress plots",
      "T9 FV pass rate drops to zero",
    ]);
    expect(searchThreadRows(rows, "progress plo").map((r) => r.title)).toEqual(["T9 FV training progress plots"]);
    // Mid-word fragments don't match, as elsewhere in search.
    expect(searchThreadRows(rows, "rogress")).toEqual([]);
  });

  it("lists the threads the user dealt with or viewed when nothing is typed, up to the limit", () => {
    expect(searchThreadRows(rows, "  ").map((r) => r.title)).toEqual([
      "Slow server restart again",
      "T9 FV training progress plots",
      "T9 FV pass rate drops to zero",
    ]);
    expect(searchThreadRows(rows, "", 1)).toHaveLength(1);
  });
});
