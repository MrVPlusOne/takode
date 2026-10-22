import { describe, expect, it } from "vitest";
import {
  checkGuidedReviewCoverage,
  formatGuidedReviewMarkdown,
  guidedReviewSnippet,
  outlineGuidedReviewDiff,
  parseGuidedReviewDiff,
  parseGuidedReviewMapInput,
  withGuidedReviewSnippets,
  type GuidedReviewMap,
} from "./guided-review.js";
import {
  GUIDED_REVIEW_FIXTURE_DIFF,
  GUIDED_REVIEW_FIXTURE_MAP,
  makeGuidedReviewMetaFixture,
} from "./test-fixtures/guided-review.js";

const files = parseGuidedReviewDiff(GUIDED_REVIEW_FIXTURE_DIFF);
const withMap = (change: (map: GuidedReviewMap) => void) => {
  const map = structuredClone(GUIDED_REVIEW_FIXTURE_MAP);
  change(map);
  return checkGuidedReviewCoverage(map, files).problems;
};

describe("parseGuidedReviewDiff", () => {
  it("numbers lines and anchors removed lines to the new-file line they sat before", () => {
    // The anchor is what lets a new-file line range claim deletions.
    const client = files.find((file) => file.path === "src/client.ts")!;
    const lines = client.hunks[0].lines;
    const removedCall = lines.find((line) => line.kind === "del" && line.text.includes("fetchJson"))!;
    expect(removedCall).toMatchObject({ oldNo: 4, anchor: 5 });
    expect(lines.find((line) => line.text.includes("15_000"))).toMatchObject({ kind: "add", newNo: 10 });
    expect(files.map((file) => file.path)).toEqual(["src/retry.ts", "src/client.ts", "src/retry.test.ts"]);
  });
});

describe("checkGuidedReviewCoverage", () => {
  it("accepts a map that accounts for every changed line and counts lines per tier", () => {
    const { problems, stats } = checkGuidedReviewCoverage(GUIDED_REVIEW_FIXTURE_MAP, files);
    expect(problems).toEqual([]);
    expect(stats).toMatchObject({ files: 3, additions: 24, deletions: 3, linesInStops: 20 });
    expect(stats.linesByTier).toEqual({ decide: 16, check: 3, checked: 1 });
  });

  it("names the uncovered lines of a file in no stop and no summary", () => {
    // Dropping the client summary leaves its import line (2) uncovered.
    const problems = withMap((map) => map.summaries.splice(0, 1));
    expect(problems).toEqual(["src/client.ts: added lines 2 are in no stop; add the file to a summary or a stop."]);
  });

  it("counts removed lines at the end of a range as uncovered when no stop claims them", () => {
    // Without the timeout stop, line 10 and the two removed lines before it are uncovered.
    const problems = withMap((map) => {
      map.stops.splice(2, 1);
      map.summaries.splice(0, 1);
    });
    expect(problems[0]).toBe(
      "src/client.ts: added lines 2, 10 and 2 removed lines are in no stop; add the file to a summary or a stop.",
    );
  });

  it("refuses a line claimed by two stops, a file in two summaries, unknown paths and empty ranges", () => {
    const problems = withMap((map) => {
      map.stops[2].code.push({ path: "src/client.ts", lines: [6, 6] });
      map.summaries[1].paths.push("src/client.ts", "src/missing.ts");
      map.stops[3].code.push({ path: "src/client.ts", lines: [8, 8] });
    });
    expect(problems).toEqual([
      'stop 3 ("Timeout tripled to 15 seconds"): src/client.ts lines 6 are already in stop "Profiles cached for a day"; each line belongs to one stop.',
      'stop 4 ("The helper\'s comment"): src/client.ts line 8 contains no changed lines; point stops at added or removed lines.',
      'summary 2 ("Tests"): src/client.ts is already in summary "Import"; list each file in one summary.',
      'summary 2 ("Tests"): src/missing.ts is not part of this change.',
    ]);
  });

  it("gives a removed line to the stop containing the line it sat before, not to one ending just above", () => {
    // Removed lines 7-8 sit before new line 10: a stop ending at 9 and one starting at 10 both
    // reach them, but only the one containing line 10 owns them, so nothing is claimed twice.
    const { problems, stats } = checkGuidedReviewCoverage(
      {
        ...GUIDED_REVIEW_FIXTURE_MAP,
        stops: [
          ...GUIDED_REVIEW_FIXTURE_MAP.stops.slice(0, 2),
          { tier: "check", title: "Before", note: "N", code: [{ path: "src/client.ts", lines: [8, 9] }] },
          { tier: "check", title: "Timeout", note: "N", code: [{ path: "src/client.ts", lines: [10, 10] }] },
          GUIDED_REVIEW_FIXTURE_MAP.stops[3],
        ],
      },
      files,
    );
    expect(problems).toEqual([]);
    // "Timeout" owns line 10 and both removed lines; "Before" owns nothing and counts nothing.
    expect(stats.linesByTier.check).toBe(3);
  });

  it("refuses a removed line claimed by two stops at the same level", () => {
    // Two stops ending just above line 10 (and none containing it) both reach its removed lines.
    const problems = withMap((map) => {
      map.stops[2].code = [{ path: "src/client.ts", lines: [9, 9] }];
      map.stops[3].code.push({ path: "src/client.ts", lines: [8, 9] });
      map.summaries.splice(0, 1);
    });
    expect(problems).toContain(
      'src/client.ts: removed lines before line 10 are in stops "Timeout tripled to 15 seconds" and "The helper\'s comment"; each line belongs to one stop.',
    );
  });

  it("requires files without line changes to be named somewhere", () => {
    const binary = parseGuidedReviewDiff(
      `${GUIDED_REVIEW_FIXTURE_DIFF}diff --git a/logo.png b/logo.png\nindex 1..2 100644\nBinary files a/logo.png and b/logo.png differ\n`,
    );
    const { problems } = checkGuidedReviewCoverage(GUIDED_REVIEW_FIXTURE_MAP, binary);
    expect(problems).toEqual([
      "logo.png changed without line changes (binary, rename or mode); list it in a stop or a summary.",
    ]);
  });
});

describe("guidedReviewSnippet", () => {
  it("cuts a range into a diff with true line numbers, including removed lines", () => {
    const client = files.find((file) => file.path === "src/client.ts")!;
    const snippet = guidedReviewSnippet(client, { path: "src/client.ts", lines: [10, 10] });
    expect(snippet.split("\n").slice(4)).toEqual([
      "@@ -7,2 +10,1 @@",
      "-",
      "-export const PROFILE_TIMEOUT_MS = 5_000;",
      "+export const PROFILE_TIMEOUT_MS = 15_000;",
      "",
    ]);
  });
});

describe("withGuidedReviewSnippets and outlineGuidedReviewDiff", () => {
  it("keeps each stop's code with the map and refuses stops that show too much", () => {
    const map = withGuidedReviewSnippets(GUIDED_REVIEW_FIXTURE_MAP, files);
    expect(map.stops[2].code[0].snippet).toContain("+export const PROFILE_TIMEOUT_MS = 15_000;");
    expect(map.stops[2].code[0].snippet).not.toContain("withRetry<T>");
    const huge = parseGuidedReviewDiff(
      `diff --git a/big.ts b/big.ts\nnew file mode 100644\n--- /dev/null\n+++ b/big.ts\n@@ -0,0 +1,20000 @@\n${"+".concat("x".repeat(60), "\n").repeat(20000)}`,
    );
    const whole: GuidedReviewMap = {
      title: "T",
      overview: "O",
      summaries: [],
      stops: [{ tier: "check", title: "All", note: "N", code: [{ path: "big.ts" }] }],
    };
    expect(() => withGuidedReviewSnippets(whole, huge)).toThrow("The stops show more than 1 MiB of code");
  });

  it("lists each file's changed new-file ranges with git's context", () => {
    expect(outlineGuidedReviewDiff(files).split("\n")).toEqual([
      "src/retry.ts  +13 -0",
      "  1-13",
      "src/client.ts  +5 -3",
      "  2-10",
      "src/retry.test.ts  +6 -0",
      "  1-6",
    ]);
  });
});

describe("parseGuidedReviewMapInput", () => {
  it("reports every problem at once, including decide stops without answers", () => {
    expect(() =>
      parseGuidedReviewMapInput({
        base: "main",
        title: "T",
        overview: "O",
        stops: [{ tier: "decide", title: "S", note: "N", code: [{ path: "a.ts", lines: [3, 1] }] }, { tier: "maybe" }],
        summaries: [],
      }),
    ).toThrow(
      [
        "The review map has problems:",
        '- map: "head" must be a non-empty string.',
        '- stop 1, code 1: "lines" must be [start, end], new-file line numbers with start <= end.',
        '- stop 1: "question" must be a non-empty string.',
        '- stop 1: a decide stop needs "answers": 2 to 4 strings of at most 40 characters.',
      ].join("\n"),
    );
  });
});

describe("formatGuidedReviewMarkdown", () => {
  it("writes the questions, stops and summaries as readable Markdown for agents and search", () => {
    const markdown = formatGuidedReviewMarkdown(makeGuidedReviewMetaFixture());
    expect(markdown).toContain("# Guided review: Retry profile loads and cache profiles");
    expect(markdown).toContain("1. **Retry every error up to 4 times?**");
    expect(markdown).toContain("(Answers: Keep a day / One hour / No cache)");
    expect(markdown).toContain("- **Tests** (1 file): One test for the first success.");
  });
});
