import { describe, expect, it, vi } from "vitest";
import {
  chooseRandomLeaderProfilePortraitId,
  getLeaderProfilePortraitForSession,
  type LeaderProfileSessionRecord,
} from "./leader-profile-assignments.js";

describe("leader profile assignments", () => {
  it("chooses new assignments from enabled pools only", () => {
    for (let i = 0; i < 20; i++) {
      expect(chooseRandomLeaderProfilePortraitId({ tako: false, shmi: true })).toMatch(/^shmi/);
    }
    expect(chooseRandomLeaderProfilePortraitId({ tako: false, shmi: false })).toBeUndefined();
  });

  it("does not assign portraits to non-leader sessions", () => {
    const persist = vi.fn();
    const session: LeaderProfileSessionRecord = { sessionId: "worker-1", isOrchestrator: false };

    expect(getLeaderProfilePortraitForSession(session, { tako: true, shmi: true }, persist)).toBeUndefined();
    expect(persist).not.toHaveBeenCalled();
  });

  it("uses stable lazy backfill for unassigned leaders", () => {
    const session: LeaderProfileSessionRecord = { sessionId: "leader-1", isOrchestrator: true };
    const persist = vi.fn((portraitId: string) => {
      session.leaderProfilePortraitId = portraitId;
    });

    const first = getLeaderProfilePortraitForSession(session, { tako: true, shmi: true }, persist);
    const second = getLeaderProfilePortraitForSession(session, { tako: true, shmi: true }, persist);

    expect(first?.id).toBe(second?.id);
    expect(persist).toHaveBeenCalledWith(first?.id);
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
