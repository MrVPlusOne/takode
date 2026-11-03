// @vitest-environment jsdom
/**
 * A brief cue when something new needs the user (Jiayi, Nov 3): it plays when a count rises because
 * something new arrived, never for items loaded with the page, re-renders or a falling count.
 */
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FRESH_CUE_MS, useAttentionCue } from "./attention-cue.js";

const NOW = 10_000_000;
const now = () => NOW;

describe("useAttentionCue", () => {
  it("cues each rise with a fresh newest item, once", () => {
    const { result, rerender } = renderHook(({ count, at }) => useAttentionCue(count, at, now), {
      initialProps: { count: 0, at: 0 },
    });
    expect(result.current).toBe(0);
    rerender({ count: 1, at: NOW - 1000 });
    expect(result.current).toBe(1);
    // A re-render with the same count plays nothing new.
    rerender({ count: 1, at: NOW - 1000 });
    expect(result.current).toBe(1);
    rerender({ count: 2, at: NOW - 500 });
    expect(result.current).toBe(2);
    // Reading one makes the count fall: no cue.
    rerender({ count: 1, at: NOW - 1000 });
    expect(result.current).toBe(2);
  });

  it("doesn't cue what was already there: the first count, or old items arriving with the page", () => {
    const { result, rerender } = renderHook(({ count, at }) => useAttentionCue(count, at, now), {
      initialProps: { count: 3, at: NOW - 1000 },
    });
    expect(result.current).toBe(0);
    // Notifications loaded after the row showed (page load, reconnect) are old.
    rerender({ count: 5, at: NOW - FRESH_CUE_MS - 1 });
    expect(result.current).toBe(0);
  });
});
