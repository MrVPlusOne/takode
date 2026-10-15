import { describe, expect, it } from "vitest";

import { findOversizedTrackedFiles, getRepoRoot, MAX_FILE_LINES } from "./check-staged-file-line-limit";

// The repository's file-size rule, checked over the whole tree. The pre-commit hook
// only sees commits made where it is installed, and the landing gate tests the
// combined tree of every change it lands, so this test is what keeps an oversized
// file from landing. Fix a failure by splitting the named file along natural lines.
describe("tracked file line limit", () => {
  it(`keeps every tracked file at or under ${MAX_FILE_LINES} lines`, async () => {
    const oversized = await findOversizedTrackedFiles(await getRepoRoot(import.meta.dirname));
    expect(oversized, `Split these files to ${MAX_FILE_LINES} lines or fewer`).toEqual([]);
  });
});
