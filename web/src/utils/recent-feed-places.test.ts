// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { isRecentFeedPlace, noteFeedPlaceShown, resetRecentFeedPlacesForTest } from "./recent-feed-places.js";

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("cc-server-id", "test-server");
  resetRecentFeedPlacesForTest();
});

describe("recent feed places", () => {
  it("counts the last three places left as recent, the place being left included", () => {
    // A feed asks before recording itself, so the first place is the one being left.
    for (const place of ["a", "b", "c", "d"]) noteFeedPlaceShown(place);
    // Leaving d: d, c and b are the last three places left; a is older.
    expect(isRecentFeedPlace("b")).toBe(true);
    expect(isRecentFeedPlace("d")).toBe(true);
    expect(isRecentFeedPlace("a")).toBe(false);
    expect(isRecentFeedPlace("never-shown")).toBe(false);
  });

  it("moves a revisited place to the front instead of listing it twice", () => {
    for (const place of ["a", "b", "c", "a", "d"]) noteFeedPlaceShown(place);
    expect(isRecentFeedPlace("a")).toBe(true);
    expect(isRecentFeedPlace("b")).toBe(false);
  });

  it("survives a reload through server-scoped storage", () => {
    noteFeedPlaceShown("a");
    resetRecentFeedPlacesForTest();
    expect(isRecentFeedPlace("a")).toBe(true);
    expect(localStorage.getItem("test-server:cc-recent-feed-places")).toBe('["a"]');
  });
});
