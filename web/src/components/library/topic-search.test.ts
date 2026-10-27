import { describe, expect, it } from "vitest";
import type { TopicSummary } from "../../../shared/library-topics.js";
import { searchTopics, topicRowLine } from "./topic-search.js";

/**
 * Searching a leader's topics: names match first, then the newest update line, and the list's
 * own (activity) order holds within each kind of match.
 */
function topic(id: string, name: string, latestUpdate?: string, summary = ""): TopicSummary {
  return { id, name, latestUpdate, summary, questIds: [], activityAt: 0 } as unknown as TopicSummary;
}

const TOPICS = [
  topic("a", "Formal verification", "Oct 27 · Lean eval runs on the T7 checkpoint."),
  topic("b", "T7 run", "Evals stalled overnight."),
  topic("c", "Daily briefing", undefined, "Morning and evening reports."),
  topic("d", "T7 twin", "Caught up."),
];

describe("searchTopics", () => {
  it("lists name matches before update-line matches, each in the list's order", () => {
    // "Formal verification" mentions T7 only in its update, so it follows both T7 topics.
    expect(searchTopics(TOPICS, "t7").map((item) => item.id)).toEqual(["b", "d", "a"]);
  });

  it("matches the start of words, every word in any order, ignoring case, across the name and line together", () => {
    expect(searchTopics(TOPICS, "EVAL lean").map((item) => item.id)).toEqual(["a"]);
    expect(searchTopics(TOPICS, "t7 stalled").map((item) => item.id)).toEqual(["b"]);
    // A topic with no update yet is found by its description, the line its row shows.
    expect(searchTopics(TOPICS, "evening").map((item) => item.id)).toEqual(["c"]);
    expect(searchTopics(TOPICS, "relay")).toEqual([]);
    // Words match from their start: "lean" finds Lean, not a word that only contains it.
    expect(searchTopics([topic("x", "Condor cleanup"), ...TOPICS], "lean").map((item) => item.id)).toEqual(["a"]);
  });

  it("returns the whole list for an empty or blank query", () => {
    expect(searchTopics(TOPICS, "  ").map((item) => item.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("does not match the date the update line starts with", () => {
    // The row hides the date, so searching for it would find topics for no visible reason.
    expect(topicRowLine(TOPICS[0]!)).toBe("Lean eval runs on the T7 checkpoint.");
    expect(searchTopics(TOPICS, "oct")).toEqual([]);
  });
});
