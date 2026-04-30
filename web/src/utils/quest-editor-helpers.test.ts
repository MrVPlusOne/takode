import { describe, expect, it } from "vitest";
import {
  extractHashtags,
  findHashtagTokenAtCursor,
  getQuestDebrief,
  getQuestDebriefTldr,
} from "./quest-editor-helpers.js";
import type { QuestmasterTask } from "../types.js";

describe("quest-editor-helpers hashtag parsing", () => {
  it("extracts valid tags while skipping numeric-leading session references", () => {
    // Session references like #123 should remain plain text and never become
    // quest tags when text is parsed for tag extraction.
    expect(extractHashtags("Track #alpha and #Beta_2 after checking #123 and #9followup")).toEqual(["alpha", "beta_2"]);
  });

  it("does not expose numeric-leading hashtags to editor autocomplete", () => {
    // Editor autocomplete is driven by the token-at-cursor helper, so numeric
    // references must return null instead of opening hashtag suggestions.
    expect(findHashtagTokenAtCursor("Use #alpha for triage", "Use #alpha".length)).toEqual({
      start: 4,
      end: 10,
      query: "alpha",
    });
    expect(findHashtagTokenAtCursor("Hand off to #123 next", "Hand off to #123".length)).toBeNull();
    expect(findHashtagTokenAtCursor("Draft bare #", "Draft bare #".length)).toEqual({
      start: 11,
      end: 12,
      query: "",
    });
  });

  it("returns final debrief metadata only for non-cancelled done quests", () => {
    const doneQuest = {
      id: "q-1",
      questId: "q-1",
      version: 1,
      title: "Done",
      status: "done",
      description: "Initial",
      debrief: "Final outcome.",
      debriefTldr: "Final TLDR.",
      createdAt: 1,
      completedAt: 2,
      verificationItems: [],
    } as QuestmasterTask;
    const cancelledQuest = { ...doneQuest, cancelled: true } as QuestmasterTask;

    expect(getQuestDebrief(doneQuest)).toBe("Final outcome.");
    expect(getQuestDebriefTldr(doneQuest)).toBe("Final TLDR.");
    expect(getQuestDebrief(cancelledQuest)).toBeUndefined();
    expect(getQuestDebriefTldr(cancelledQuest)).toBeUndefined();
  });
});
