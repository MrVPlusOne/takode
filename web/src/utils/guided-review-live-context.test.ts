// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getGuidedReviewFileDiff = vi.fn();
vi.mock("../api.js", () => ({
  api: { getGuidedReviewFileDiff: (...args: unknown[]) => getGuidedReviewFileDiff(...args) },
}));

import { resetLiveReviewContextForTest, useLiveReviewSnippet } from "./guided-review-live-context.js";

/**
 * The code around a guided review stop is read live from git when the review is viewed (Jiayi,
 * Nov 1), instead of being saved with it: 10 lines a side, up to 30 more on one side per "Show more
 * lines above" or "below" (Jiayi, Nov 14), and the saved lines alone when git can't be reached.
 */

/** A 60-line file whose line 30 changed, as git prints it with the whole file as context. */
function wholeFileDiff(): string {
  const lines = Array.from({ length: 60 }, (_, index) => ` line ${index + 1}`);
  lines.splice(29, 1, "-line 30 old", "+line 30 new");
  return ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1,60 +1,60 @@", ...lines, ""].join("\n");
}

const SAVED = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -30,1 +30,1 @@\n-line 30 old\n+line 30 new\n";
const REF = { path: "a.ts", lines: [30, 30] as [number, number], snippet: SAVED };

/** The new-file line numbers a snippet shows. */
function shownNewLines(snippet: string): number[] {
  const body = snippet.split("\n").slice(snippet.split("\n").findIndex((line) => line.startsWith("@@")));
  const start = Number(/\+(\d+)/.exec(body[0]!)![1]);
  return body
    .slice(1)
    .filter((line) => line.startsWith(" ") || line.startsWith("+"))
    .map((_, index) => start + index);
}

beforeEach(() => {
  resetLiveReviewContextForTest();
  getGuidedReviewFileDiff.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("useLiveReviewSnippet", () => {
  it("shows 10 lines around the stop's lines, and widens one side at a time by up to 30 lines", async () => {
    getGuidedReviewFileDiff.mockResolvedValue({ available: true, diff: wholeFileDiff() });
    const { result } = renderHook(() => useLiveReviewSnippet("leader", "r1", REF));
    // The saved lines show until git answers.
    expect(result.current.snippet).toBe(SAVED);
    await waitFor(() => expect(result.current.snippet).not.toBe(SAVED));
    expect(getGuidedReviewFileDiff).toHaveBeenCalledWith("leader", "r1", "a.ts");
    let lines = shownNewLines(result.current.snippet);
    expect([lines[0], lines.at(-1)]).toEqual([20, 40]);
    // Each button names what it adds: the 19 lines left above line 20, the 20 left below line 40.
    expect(result.current.more).toEqual({ above: 19, below: 20 });
    act(() => result.current.showMore("above"));
    lines = shownNewLines(result.current.snippet);
    expect([lines[0], lines.at(-1)]).toEqual([1, 40]);
    // Nothing is left above, so its button goes; below is untouched.
    expect(result.current.more).toEqual({ above: 0, below: 20 });
    act(() => result.current.showMore("below"));
    lines = shownNewLines(result.current.snippet);
    expect([lines[0], lines.at(-1)]).toEqual([1, 60]);
    expect(result.current.more).toEqual({ above: 0, below: 0 });
  });

  it("adds at most 30 lines per press when more is left", async () => {
    // A 200-line file changed at line 100: 89 lines are left above the first 10.
    const lines = Array.from({ length: 200 }, (_, index) => ` line ${index + 1}`);
    lines.splice(99, 1, "+line 100 new");
    const diff = ["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1,199 +1,200 @@", ...lines, ""];
    getGuidedReviewFileDiff.mockResolvedValue({ available: true, diff: diff.join("\n") });
    const ref = { path: "a.ts", lines: [100, 100] as [number, number], snippet: SAVED };
    const { result } = renderHook(() => useLiveReviewSnippet("leader", "r7", ref));
    await waitFor(() => expect(result.current.snippet).not.toBe(SAVED));
    expect(result.current.more).toEqual({ above: 30, below: 30 });
    act(() => result.current.showMore("above"));
    expect(shownNewLines(result.current.snippet)[0]).toBe(60);
    act(() => result.current.showMore("above"));
    act(() => result.current.showMore("above"));
    // 89 left: 30, 30, then the last 29.
    expect(shownNewLines(result.current.snippet)[0]).toBe(1);
    expect(result.current.more.above).toBe(0);
  });

  it("keeps the saved lines and says why when git can't be reached or the commits are gone", async () => {
    // Jiayi (Nov 1): the stop says the code around it isn't available, rather than falling back
    // silently; a file too large to show says that instead.
    getGuidedReviewFileDiff.mockResolvedValueOnce({ available: false, reason: "commits_not_available" });
    const gone = renderHook(() => useLiveReviewSnippet("leader", "r2", REF));
    await waitFor(() => expect(gone.result.current.unavailable).toBe("unreachable"));
    expect(gone.result.current).toMatchObject({ snippet: SAVED, more: { above: 0, below: 0 } });
    getGuidedReviewFileDiff.mockRejectedValueOnce(new Error("offline"));
    const offline = renderHook(() => useLiveReviewSnippet("leader", "r3", REF));
    await waitFor(() => expect(offline.result.current.unavailable).toBe("unreachable"));
    expect(offline.result.current.snippet).toBe(SAVED);
    getGuidedReviewFileDiff.mockResolvedValueOnce({ available: false, reason: "too_large" });
    const large = renderHook(() => useLiveReviewSnippet("leader", "r5", REF));
    await waitFor(() => expect(large.result.current.unavailable).toBe("too_large"));
  });

  it("reads again on Retry, and only then", async () => {
    // Jiayi chose an on-demand Retry over retrying by itself when a stop reopens.
    getGuidedReviewFileDiff.mockRejectedValueOnce(new Error("offline"));
    const first = renderHook(() => useLiveReviewSnippet("leader", "r6", REF));
    await waitFor(() => expect(first.result.current.unavailable).toBe("unreachable"));
    // Reopening the stop keeps the failure; nothing is read again.
    first.unmount();
    const reopened = renderHook(() => useLiveReviewSnippet("leader", "r6", REF));
    await waitFor(() => expect(reopened.result.current.unavailable).toBe("unreachable"));
    expect(getGuidedReviewFileDiff).toHaveBeenCalledTimes(1);
    getGuidedReviewFileDiff.mockResolvedValueOnce({ available: true, diff: wholeFileDiff() });
    act(() => reopened.result.current.retry());
    await waitFor(() => expect(reopened.result.current.unavailable).toBeNull());
    await waitFor(() => expect(reopened.result.current.snippet).not.toBe(SAVED));
    expect(getGuidedReviewFileDiff).toHaveBeenCalledTimes(2);
  });

  it("reads each file once per review, and nothing for a stop showing a whole file", async () => {
    getGuidedReviewFileDiff.mockResolvedValue({ available: true, diff: wholeFileDiff() });
    renderHook(() => useLiveReviewSnippet("leader", "r4", REF));
    renderHook(() => useLiveReviewSnippet("leader", "r4", { ...REF, lines: [31, 31] }));
    const whole = renderHook(() => useLiveReviewSnippet("leader", "r4", { path: "b.ts", snippet: SAVED }));
    await waitFor(() => expect(getGuidedReviewFileDiff).toHaveBeenCalledTimes(1));
    expect(whole.result.current.snippet).toBe(SAVED);
  });
});
