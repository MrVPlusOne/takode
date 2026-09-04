import { describe, expect, it } from "vitest";
import {
  leaderResponseAssociatedThreadKeys,
  leaderResponseExactAnswerThreadKey,
  leaderResponseMessageIsAssociatedWithThread,
  leaderResponseOwnerThreadKey,
  leaderResponseProvenCurrentOwnerThreadKey,
  leaderResponseStableOwnerThreadKeyForRepair,
} from "./leader-thread-response-routing.js";

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

  it("projects q-only backfill membership alongside the current owner without reviving older assignments", () => {
    expect(
      leaderResponseAssociatedThreadKeys({
        threadKey: "main",
        threadRefs: [
          { threadKey: "q-1", questId: "q-1", source: "backfill", attachedAt: 10 },
          { threadKey: "q-2", questId: "q-2", source: "backfill", attachedAt: 20 },
          { threadKey: "main", source: "backfill", attachedAt: 30 },
        ],
      }),
    ).toEqual(["main", "q-1", "q-2"]);

    const reassigned = {
      threadKey: "main",
      threadRefs: [
        { threadKey: "q-1", questId: "q-1", source: "explicit" as const, attachedAt: 10 },
        { threadKey: "q-3", questId: "q-3", source: "backfill" as const, attachedAt: 15 },
        { threadKey: "q-2", questId: "q-2", source: "inferred" as const, attachedAt: 20 },
        { threadKey: "main", source: "backfill" as const, attachedAt: 30 },
      ],
    };
    expect(leaderResponseAssociatedThreadKeys(reassigned)).toEqual(["q-2", "q-3"]);
    expect(leaderResponseMessageIsAssociatedWithThread(reassigned, "main")).toBe(false);
    expect(leaderResponseMessageIsAssociatedWithThread(reassigned, "q-1")).toBe(false);
    expect(leaderResponseMessageIsAssociatedWithThread(reassigned, "q-2")).toBe(true);
    expect(leaderResponseMessageIsAssociatedWithThread(reassigned, "q-3")).toBe(true);
  });

  it("fails malformed direct ownership conservatively to Main", () => {
    expect(leaderResponseOwnerThreadKey({ threadKey: "q-1", questId: "q-2" })).toBe("main");
  });

  it("proves current ownership without compatibility fallback", () => {
    expect(leaderResponseProvenCurrentOwnerThreadKey({})).toBeNull();
    expect(leaderResponseProvenCurrentOwnerThreadKey({ threadKey: "main" })).toBe("main");
    expect(leaderResponseProvenCurrentOwnerThreadKey({ threadKey: "q-1", questId: "q-2" })).toBeNull();
    expect(
      leaderResponseProvenCurrentOwnerThreadKey({
        threadKey: "main",
        threadRefs: [{ threadKey: "q-2", questId: "q-2", source: "explicit", attachedAt: 20 }],
      }),
    ).toBe("q-2");
    expect(
      leaderResponseProvenCurrentOwnerThreadKey({
        threadKey: "main",
        threadRefs: [{ threadKey: "q-2", questId: "q-3", source: "explicit", attachedAt: 20 }],
      }),
    ).toBeNull();
  });

  it("requires strict owner evidence for automatic answer-route repair", () => {
    expect(leaderResponseStableOwnerThreadKeyForRepair({})).toBeNull();
    expect(leaderResponseStableOwnerThreadKeyForRepair({ threadKey: "main" })).toBe("main");
    expect(leaderResponseStableOwnerThreadKeyForRepair({ threadKey: "q-1", questId: "q-2" })).toBeNull();
    expect(
      leaderResponseStableOwnerThreadKeyForRepair({
        threadKey: "main",
        threadRefs: [{ threadKey: "q-2", questId: "q-2", source: "explicit", attachedAt: 20 }],
      }),
    ).toBeNull();
    expect(
      leaderResponseStableOwnerThreadKeyForRepair({
        threadKey: "q-2",
        questId: "q-2",
        threadRefs: [
          { threadKey: "q-2", questId: "q-2", source: "explicit", attachedAt: 10 },
          { threadKey: "q-3", questId: "q-3", source: "backfill", attachedAt: 20 },
        ],
      }),
    ).toBe("q-2");
    expect(
      leaderResponseStableOwnerThreadKeyForRepair({
        threadKey: "main",
        threadRefs: [{ threadKey: "q-2", questId: "q-3", source: "explicit", attachedAt: 20 }],
      }),
    ).toBeNull();
  });

  it("accepts only exact answer-source routes and fails malformed Main or quest metadata closed", () => {
    expect(leaderResponseExactAnswerThreadKey({ threadKey: "main" })).toBe("main");
    expect(
      leaderResponseExactAnswerThreadKey({
        threadKey: "main",
        threadRefs: [{ threadKey: "q-1", questId: "q-1", source: "backfill" }],
      }),
    ).toBe("main");
    expect(leaderResponseExactAnswerThreadKey({ threadKey: "main", questId: "q-1" })).toBeNull();
    expect(
      leaderResponseExactAnswerThreadKey({
        threadKey: "main",
        threadRefs: [{ threadKey: "q-1", questId: "q-1", source: "explicit" }],
      }),
    ).toBeNull();

    expect(
      leaderResponseExactAnswerThreadKey({
        threadKey: "q-1",
        questId: "q-1",
        threadRefs: [{ threadKey: "q-1", questId: "q-1", source: "explicit" }],
      }),
    ).toBe("q-1");
    expect(leaderResponseExactAnswerThreadKey({ threadKey: "q-1", questId: "q-1" })).toBeNull();
    expect(
      leaderResponseExactAnswerThreadKey({
        threadKey: "q-1",
        questId: "q-2",
        threadRefs: [{ threadKey: "q-1", questId: "q-1", source: "explicit" }],
      }),
    ).toBeNull();
    expect(
      leaderResponseExactAnswerThreadKey({
        threadKey: "q-1",
        questId: "q-1",
        threadRefs: [{ threadKey: "q-1", questId: "q-1", source: "backfill" }],
      }),
    ).toBeNull();
    expect(
      leaderResponseExactAnswerThreadKey({
        threadKey: "q-1",
        questId: "q-1",
        threadRefs: [{ threadKey: "q-2", questId: "q-3", source: "explicit" }],
      }),
    ).toBeNull();
  });
});
