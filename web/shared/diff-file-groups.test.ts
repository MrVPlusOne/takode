import { describe, expect, it } from "vitest";
import { isLikelyTestFile, orderDiffFilesCodeFirst, summarizeDiffFileStats } from "./diff-file-groups.js";

describe("diff file grouping", () => {
  it("recognizes conventional test paths without matching broad substrings", () => {
    const testPaths = [
      "tests/unit/auth.ts",
      "src/__tests__/auth.tsx",
      "src/auth.test.ts",
      "src/auth.spec.tsx",
      "pkg/auth_test.go",
      "pkg/test_auth.py",
      "src\\spec\\auth.rb",
    ];
    const codePaths = [
      "src/contest.ts",
      "src/specification.ts",
      "docs/tests.md",
      "src/testing/auth.ts",
      "src/latest.ts",
    ];

    for (const path of testPaths) expect(isLikelyTestFile(path), path).toBe(true);
    for (const path of codePaths) expect(isLikelyTestFile(path), path).toBe(false);
  });

  it("stably places code before tests while preserving every item", () => {
    const testA = { path: "src/a.test.ts", marker: "test-a" };
    const codeA = { path: "src/b.ts", marker: "code-a" };
    const testB = { path: "tests/c.ts", marker: "test-b" };
    const codeB = { path: "src/d.ts", marker: "code-b" };

    expect(orderDiffFilesCodeFirst([testA, codeA, testB, codeB, testA], (file) => file.path)).toEqual([
      codeA,
      codeB,
      testA,
      testB,
      testA,
    ]);
  });

  it("accumulates additions and deletions separately for code and tests", () => {
    expect(
      summarizeDiffFileStats([
        { path: "src/app.ts", additions: 8, deletions: 3 },
        { path: "src/app.test.ts", additions: 5, deletions: 2 },
        { path: "tests/helpers.ts", additions: 4, deletions: 1 },
        { path: "docs/guide.md", additions: 2, deletions: 0 },
      ]),
    ).toEqual({
      code: { additions: 10, deletions: 3 },
      tests: { additions: 9, deletions: 3 },
    });
  });
});
