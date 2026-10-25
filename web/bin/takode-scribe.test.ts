import { describe, expect, it } from "vitest";
import { formatScribeStatus, type ScribeStatusResponse } from "./takode-scribe.js";

/**
 * `takode scribe status` for a leader: a few lines naming the Scribe by session number, what it is
 * doing, the user's grouping
 * instructions and renames waiting for the user; with topics off, one line saying so.
 */

const STATUS: ScribeStatusResponse = {
  leader: { sessionId: "leader-1", sessionNum: 2957, space: "MSI" },
  enabled: true,
  topics: 9,
  scribe: {
    activity: { state: "idle", text: "Up to date", sessionId: "scribe-1", sessionNum: 3146, pending: 0 },
    paused: true,
    instructions: "One topic per training run.",
  },
  suggestions: [{ id: "s1", topicId: "t1", topicName: "Interview with Qi Chen", name: "Interviews", at: 0 }],
};

describe("formatScribeStatus", () => {
  it("names the Scribe, its spend, the instructions and waiting renames", () => {
    expect(formatScribeStatus(STATUS).split("\n")).toEqual([
      "Topics for #2957 (space MSI): 9 topics",
      "Scribe #3146: Up to date (paused)",
      'Instructions: "One topic per training run."',
      'Waiting for the user: rename "Interview with Qi Chen" to "Interviews"',
    ]);
  });

  it("says when topics are off, so the leader has no Scribe", () => {
    expect(formatScribeStatus({ ...STATUS, enabled: false })).toBe(
      "Topics are off for #2957, so it has no Scribe; the user turns topics on in the topics panel.",
    );
  });
});
