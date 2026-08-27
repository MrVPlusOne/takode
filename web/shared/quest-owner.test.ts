import {
  getPreviousQuestOwners,
  getQuestDisplayOwner,
  getQuestOwner,
  getTakodeQuestOwnerSessionId,
  normalizeQuestOwnerRef,
  questOwnerKey,
  sameQuestOwner,
} from "./quest-owner.js";

describe("quest owner helpers", () => {
  it("treats a missing active owner kind as legacy Takode ownership", () => {
    const value = { sessionId: " legacy-session " };

    expect(getQuestOwner(value)).toEqual({ kind: "takode", sessionId: "legacy-session" });
    expect(getTakodeQuestOwnerSessionId(value)).toBe("legacy-session");
  });

  it("never projects an active Codex owner as a Takode session", () => {
    const value = { ownerKind: "codex", sessionId: "same-id" };

    expect(getQuestOwner(value)).toEqual({ kind: "codex", sessionId: "same-id" });
    expect(getTakodeQuestOwnerSessionId(value)).toBeUndefined();
  });

  it("merges canonical and legacy history while deduplicating by provider and id", () => {
    expect(
      getPreviousQuestOwners({
        previousOwners: [
          { kind: "codex", sessionId: "same-id" },
          { kind: "takode", sessionId: "legacy-id" },
        ],
        previousOwnerSessionIds: ["legacy-id", "same-id", "same-id"],
      }),
    ).toEqual([
      { kind: "codex", sessionId: "same-id" },
      { kind: "takode", sessionId: "legacy-id" },
      { kind: "takode", sessionId: "same-id" },
    ]);
  });

  it("prefers active then canonical historical ownership for display", () => {
    const history = {
      previousOwners: [
        { kind: "takode" as const, sessionId: "older" },
        { kind: "codex" as const, sessionId: "same-id" },
      ],
      previousOwnerSessionIds: ["same-id"],
    };

    expect(getQuestDisplayOwner({ ...history, sessionId: "active" })).toEqual({
      kind: "takode",
      sessionId: "active",
    });
    expect(getQuestDisplayOwner(history)).toEqual({ kind: "codex", sessionId: "same-id" });
    expect(getQuestDisplayOwner({ previousOwnerSessionIds: ["legacy-only"] })).toEqual({
      kind: "takode",
      sessionId: "legacy-only",
    });
  });

  it("normalizes and compares provider-aware references", () => {
    const owner = normalizeQuestOwnerRef({ kind: "codex", sessionId: " owner " });

    expect(owner).toEqual({ kind: "codex", sessionId: "owner" });
    expect(questOwnerKey(owner!)).toBe("codex:owner");
    expect(sameQuestOwner(owner, { kind: "codex", sessionId: "owner" })).toBe(true);
    expect(sameQuestOwner(owner, { kind: "takode", sessionId: "owner" })).toBe(false);
  });
});
