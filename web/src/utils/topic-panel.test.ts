import { describe, expect, it } from "vitest";
import { nextKeptTopicPages } from "./topic-panel.js";

describe("nextKeptTopicPages", () => {
  // The panel keeps the three most recently shown topic pages mounted so reopening one restores
  // it as it was; the order of first showing stays fixed so a kept page's DOM never moves.
  it("keeps the most recent pages, keeping each page's first-shown order", () => {
    let kept = nextKeptTopicPages([], "a");
    kept = nextKeptTopicPages(kept, "b");
    kept = nextKeptTopicPages(kept, "c");
    kept = nextKeptTopicPages(kept, "a");
    expect(kept.map((page) => page.topicId)).toEqual(["a", "c", "b"]);
    expect(kept.find((page) => page.topicId === "a")!.seq).toBe(0);

    // A fourth topic drops the least recently shown one.
    kept = nextKeptTopicPages(kept, "d");
    expect(kept.map((page) => page.topicId)).toEqual(["d", "a", "c"]);
    expect(kept[0]!.seq).toBe(3);
  });

  it("returns the same list when the topic list or the page already on top is shown", () => {
    const kept = nextKeptTopicPages([], "a");
    expect(nextKeptTopicPages(kept, null)).toBe(kept);
    expect(nextKeptTopicPages(kept, "a")).toBe(kept);
  });
});
