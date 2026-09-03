import { describe, expect, it } from "vitest";
import { leaderResponseOwnerThreadKey } from "./leader-thread-response-routing.js";

describe("leader answer ownership routing", () => {
  it("uses the newest non-backfill assignment instead of the original route", () => {
    expect(
      leaderResponseOwnerThreadKey({
        threadKey: "main",
        threadRefs: [
          { threadKey: "q-1", questId: "q-1", source: "explicit", attachedAt: 10 },
          { threadKey: "q-2", questId: "q-2", source: "inferred", attachedAt: 20 },
        ],
      }),
    ).toBe("q-2");
  });

  it("keeps backfill membership visibility-only", () => {
    expect(
      leaderResponseOwnerThreadKey({
        threadKey: "main",
        threadRefs: [{ threadKey: "q-1", questId: "q-1", source: "backfill", attachedAt: 20 }],
      }),
    ).toBe("main");
  });

  it("fails malformed direct ownership conservatively to Main", () => {
    expect(leaderResponseOwnerThreadKey({ threadKey: "q-1", questId: "q-2" })).toBe("main");
  });
});
