import { getHighlightParts } from "./highlight.js";

describe("getHighlightParts", () => {
  it("returns a single unmatched part when query is empty", () => {
    expect(getHighlightParts("Quest title", "")).toEqual([{ text: "Quest title", matched: false }]);
  });

  it("splits text and marks matched segments case-insensitively", () => {
    expect(getHighlightParts("Fix Codex trim crash", "codex")).toEqual([
      { text: "Fix ", matched: false },
      { text: "Codex", matched: true },
      { text: " trim crash", matched: false },
    ]);
  });

  it("marks multiple matches in the same string", () => {
    expect(getHighlightParts("tag tags TAG", "tag")).toEqual([
      { text: "tag", matched: true },
      { text: " ", matched: false },
      { text: "tag", matched: true },
      { text: "s ", matched: false },
      { text: "TAG", matched: true },
    ]);
  });

  it("highlights divided word tokens independently", () => {
    expect(getHighlightParts("a+b a+b", "a+b")).toEqual([
      { text: "a", matched: true },
      { text: "+", matched: false },
      { text: "b", matched: true },
      { text: " ", matched: false },
      { text: "a", matched: true },
      { text: "+", matched: false },
      { text: "b", matched: true },
    ]);
  });

  it("does not highlight arbitrary mid-word substrings", () => {
    expect(getHighlightParts("memory recall guidance required", "memory ui")).toEqual([
      { text: "memory", matched: true },
      { text: " recall guidance required", matched: false },
    ]);
  });

  it("highlights word prefixes and CamelCase tokens", () => {
    expect(getHighlightParts("renderSearchHighlightText", "search high")).toEqual([
      { text: "render", matched: false },
      { text: "Search", matched: true },
      { text: "High", matched: true },
      { text: "lightText", matched: false },
    ]);
    expect(getHighlightParts("memory interface", "mem inter")).toEqual([
      { text: "mem", matched: true },
      { text: "ory ", matched: false },
      { text: "inter", matched: true },
      { text: "face", matched: false },
    ]);
  });
});
