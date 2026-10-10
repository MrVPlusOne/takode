import { describe, expect, it } from "vitest";
import type { AppState } from "../store-types.js";
import { formatDiffLineCount, hasSessionDiff, resolveSessionDiffSummary } from "./session-diff-summary.js";

function makeState(overrides: Partial<AppState> = {}): AppState {
  return {
    sessions: new Map(),
    sdkSessions: [{ sessionId: "s1", createdAt: 1, state: "connected", cwd: "/repo" }],
    changedFiles: new Map(),
    diffFileStats: new Map(),
    ...overrides,
  } as AppState;
}

describe("resolveSessionDiffSummary", () => {
  // Moved from the removed top-bar Diff button: browser-observed edits outside the session's
  // checkout (such as a plan file in ~/.claude) must not count as changes.
  it("counts only browser-observed files within the session's cwd", () => {
    const summary = resolveSessionDiffSummary(
      makeState({
        changedFiles: new Map([
          ["s1", new Set(["/repo/src/a.ts", "/repo/src/b.ts", "/Users/stan/.claude/plans/plan.md"])],
        ]),
      }),
      "s1",
    );
    expect(summary).toEqual({ linesAdded: 0, linesRemoved: 0, changedFiles: 2 });
  });

  it("reports no diff when every changed file is out of scope", () => {
    const summary = resolveSessionDiffSummary(
      makeState({ changedFiles: new Map([["s1", new Set(["/Users/stan/.claude/plans/plan.md"])]]) }),
      "s1",
    );
    expect(hasSessionDiff(summary)).toBe(false);
  });

  // A worktree's server line stats are authoritative: after the worker commits and its work lands,
  // the stats drop to zero even though the browser still remembers the files it saw edited.
  it("trusts worktree line stats over stale browser-observed files", () => {
    const state = makeState({
      sdkSessions: [
        { sessionId: "w1", createdAt: 1, state: "connected", cwd: "/wt/w1", isWorktree: true, totalLinesAdded: 0 },
      ],
      changedFiles: new Map([["w1", new Set(["/wt/w1/a.ts"])]]),
    });
    expect(hasSessionDiff(resolveSessionDiffSummary(state, "w1"))).toBe(false);
  });

  it("prefers live session state line counts over the session list", () => {
    const state = makeState({
      sessions: new Map([["w1", { total_lines_added: 12, total_lines_removed: 3, is_worktree: true } as never]]),
      sdkSessions: [
        { sessionId: "w1", createdAt: 1, state: "connected", cwd: "/wt/w1", isWorktree: true, totalLinesAdded: 4 },
      ],
    });
    expect(resolveSessionDiffSummary(state, "w1")).toEqual({ linesAdded: 12, linesRemoved: 3, changedFiles: 0 });
  });

  // Skipped stats (for example a worktree too far from its base) leave the browser-observed files as the signal.
  it("falls back to browser-observed files when worktree stats were skipped", () => {
    const state = makeState({
      sdkSessions: [
        {
          sessionId: "w1",
          createdAt: 1,
          state: "connected",
          cwd: "/wt/w1",
          isWorktree: true,
          diffStatsSkippedReason: "branch is 400 commits from base",
        },
      ],
      changedFiles: new Map([["w1", new Set(["/wt/w1/a.ts"])]]),
    });
    expect(resolveSessionDiffSummary(state, "w1").changedFiles).toBe(1);
  });

  it("returns an empty summary for unknown sessions", () => {
    expect(hasSessionDiff(resolveSessionDiffSummary(makeState(), "missing"))).toBe(false);
    expect(hasSessionDiff(resolveSessionDiffSummary(makeState(), null))).toBe(false);
  });
});

describe("formatDiffLineCount", () => {
  it("keeps chip counts short", () => {
    expect(formatDiffLineCount(999)).toBe("999");
    expect(formatDiffLineCount(1000)).toBe("1k");
    expect(formatDiffLineCount(1234)).toBe("1.2k");
    expect(formatDiffLineCount(25_400)).toBe("25k");
  });
});
