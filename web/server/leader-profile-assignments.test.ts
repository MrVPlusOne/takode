import { describe, expect, it, vi } from "vitest";
import { LEADER_PROFILE_PORTRAITS } from "../shared/leader-profile-portraits.js";
import {
  chooseDistinctLeaderProfilePortraitIds,
  chooseRandomLeaderProfilePortraitId,
  getLeaderProfilePortraitForSession,
  type LeaderProfileSessionRecord,
} from "./leader-profile-assignments.js";

describe("leader profile assignments", () => {
  it("chooses new assignments from enabled pools only", () => {
    for (let i = 0; i < 20; i++) {
      expect(chooseRandomLeaderProfilePortraitId({ tako: false, shmi: true, animals: false })).toMatch(/^shmi/);
    }
    expect(chooseRandomLeaderProfilePortraitId({ tako: false, shmi: false, animals: false })).toBeUndefined();
  });

  it("does not assign portraits to non-leader sessions", () => {
    const persist = vi.fn();
    const session: LeaderProfileSessionRecord = { sessionId: "worker-1", isOrchestrator: false };

    expect(
      getLeaderProfilePortraitForSession(session, { tako: true, shmi: true, animals: false }, persist),
    ).toBeUndefined();
    expect(persist).not.toHaveBeenCalled();
  });

  it("uses stable lazy backfill for unassigned leaders", () => {
    const session: LeaderProfileSessionRecord = { sessionId: "leader-1", isOrchestrator: true };
    const persist = vi.fn((portraitId: string) => {
      session.leaderProfilePortraitId = portraitId;
    });

    const first = getLeaderProfilePortraitForSession(session, { tako: true, shmi: true, animals: false }, persist);
    const second = getLeaderProfilePortraitForSession(session, { tako: true, shmi: true, animals: false }, persist);

    expect(first?.id).toBe(second?.id);
    expect(persist).toHaveBeenCalledWith(first?.id);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("normalizes obsolete sheet-level assignment ids to individual portraits", () => {
    const session: LeaderProfileSessionRecord = {
      sessionId: "leader-legacy",
      isOrchestrator: true,
      leaderProfilePortraitId: "tako2",
    };
    const persist = vi.fn((portraitId: string) => {
      session.leaderProfilePortraitId = portraitId;
    });

    const portrait = getLeaderProfilePortraitForSession(session, { tako: false, shmi: true, animals: false }, persist);

    expect(portrait).toMatchObject({ id: "tako2-01", poolId: "tako" });
    expect(persist).toHaveBeenCalledWith("tako2-01");
  });

  it("gives each leader a different portrait while there are enough, and agrees on a re-run", () => {
    // Switching every leader at once should make them easy to tell apart, so collisions move to the next free slot.
    const portraits = LEADER_PROFILE_PORTRAITS.filter((portrait) => portrait.poolId === "animals").slice(0, 3);
    const ids = ["leader-a", "leader-b", "leader-c"];
    const chosen = chooseDistinctLeaderProfilePortraitIds(ids, portraits);
    expect(new Set(chosen.values()).size).toBe(3);
    expect(chooseDistinctLeaderProfilePortraitIds(ids, portraits)).toEqual(chosen);

    // More leaders than portraits still gives every leader one.
    const crowded = chooseDistinctLeaderProfilePortraitIds([...ids, "leader-d"], portraits);
    expect(crowded.size).toBe(4);
    expect(chooseDistinctLeaderProfilePortraitIds(ids, [])).toEqual(new Map());
  });
});
