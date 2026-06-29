// @vitest-environment jsdom

import {
  MESSAGE_TARGET_HIGHLIGHT_CLASS,
  MESSAGE_TARGET_HIGHLIGHT_MS,
  flashMessageFeedTarget,
} from "./message-feed-target-highlight.js";

describe("flashMessageFeedTarget", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("adds a transient highlight class and removes it after the fade window", () => {
    vi.useFakeTimers();
    const target = document.createElement("div");

    flashMessageFeedTarget(target);

    expect(target.classList.contains(MESSAGE_TARGET_HIGHLIGHT_CLASS)).toBe(true);

    vi.advanceTimersByTime(MESSAGE_TARGET_HIGHLIGHT_MS - 1);
    expect(target.classList.contains(MESSAGE_TARGET_HIGHLIGHT_CLASS)).toBe(true);

    vi.advanceTimersByTime(1);
    expect(target.classList.contains(MESSAGE_TARGET_HIGHLIGHT_CLASS)).toBe(false);
  });

  it("restarts cleanup when the same target is highlighted again", () => {
    vi.useFakeTimers();
    const target = document.createElement("div");

    flashMessageFeedTarget(target);
    vi.advanceTimersByTime(MESSAGE_TARGET_HIGHLIGHT_MS - 1);
    flashMessageFeedTarget(target);

    vi.advanceTimersByTime(1);
    expect(target.classList.contains(MESSAGE_TARGET_HIGHLIGHT_CLASS)).toBe(true);

    vi.advanceTimersByTime(MESSAGE_TARGET_HIGHLIGHT_MS - 1);
    expect(target.classList.contains(MESSAGE_TARGET_HIGHLIGHT_CLASS)).toBe(false);
  });
});
