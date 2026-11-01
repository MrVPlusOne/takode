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
 * Nov 1), instead of being saved with it: 10 lines a side, 20 more per "Show more", and the saved
 * lines alone when git can't be reached.
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
  it("shows 10 lines around the stop's lines, and 20 more each time Show more is pressed", async () => {
    getGuidedReviewFileDiff.mockResolvedValue({ available: true, diff: wholeFileDiff() });
    const { result } = renderHook(() => useLiveReviewSnippet("leader", "r1", REF));
    // The saved lines show until git answers.
    expect(result.current.snippet).toBe(SAVED);
    await waitFor(() => expect(result.current.snippet).not.toBe(SAVED));
    expect(getGuidedReviewFileDiff).toHaveBeenCalledWith("leader", "r1", "a.ts");
    let lines = shownNewLines(result.current.snippet);
    expect([lines[0], lines.at(-1)]).toEqual([20, 40]);
    expect(result.current.canShowMore).toBe(true);
    act(() => result.current.showMore());
    lines = shownNewLines(result.current.snippet);
    expect([lines[0], lines.at(-1)]).toEqual([1, 60]);
    // The whole file shows: nothing more around it.
    expect(result.current.canShowMore).toBe(false);
  });

  it("keeps the saved lines when git can't be reached or the commits are gone", async () => {
    getGuidedReviewFileDiff.mockResolvedValueOnce({ available: false, reason: "commits_not_available" });
    const gone = renderHook(() => useLiveReviewSnippet("leader", "r2", REF));
    await waitFor(() => expect(getGuidedReviewFileDiff).toHaveBeenCalled());
    expect(gone.result.current).toMatchObject({ snippet: SAVED, canShowMore: false });
    getGuidedReviewFileDiff.mockRejectedValueOnce(new Error("offline"));
    const offline = renderHook(() => useLiveReviewSnippet("leader", "r3", REF));
    await waitFor(() => expect(getGuidedReviewFileDiff).toHaveBeenCalledTimes(2));
    expect(offline.result.current.snippet).toBe(SAVED);
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
