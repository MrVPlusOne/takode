import { describe, expect, it } from "vitest";
import { extractHashtags, findHashtagTokenAtCursor } from "./quest-editor-helpers.js";

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
});
