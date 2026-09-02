import { describe, expect, it } from "vitest";
import { buildChangePatchGroups } from "./diff-change-groups.js";

describe("buildChangePatchGroups", () => {
  it("groups repeated file changes and stably places code groups before test groups", () => {
    const testFirst = {
      path: "src/app.test.ts",
      diff: "@@ -1 +1 @@\n-old test one\n+new test one",
      content: "test content one",
    };
    const codeFirst = {
      path: "src/app.ts",
      diff: "@@ -1 +1 @@\n-old code\n+new code",
      content: "code content",
    };
    const testSecond = {
      path: "src/app.test.ts",
      diff: "@@ -2 +2 @@\n-old test two\n+new test two",
      content: "test content two",
    };

    const groups = buildChangePatchGroups([testFirst, codeFirst, testSecond]);

    expect(groups.map((group) => group.filePath)).toEqual(["src/app.ts", "src/app.test.ts"]);
    expect(groups[0].changes).toEqual([codeFirst]);
    expect(groups[1].changes).toEqual([testFirst, testSecond]);
    expect(groups[1].unifiedDiff).toBe(`${testFirst.diff}\n${testSecond.diff}`);
    expect(groups[1].newText).toBe("test content one\ntest content two");
  });

  it("uses the fallback path when a change omits its own path", () => {
    const diff = "@@ -1 +1 @@\n-old\n+new";
    expect(buildChangePatchGroups([{ diff }], "tests/fallback.ts")).toMatchObject([
      { filePath: "tests/fallback.ts", unifiedDiff: diff },
    ]);
  });
});
