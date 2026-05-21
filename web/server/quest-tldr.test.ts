import { describe, expect, it } from "vitest";
import { hasLikelyHashBookkeepingInTldr, tldrWarningForContent, tldrWarningsForContent } from "./quest-tldr.js";

describe("quest TLDR warnings", () => {
  it("warns for likely raw commit bookkeeping in TLDR metadata", () => {
    const warning = tldrWarningForContent(
      "debrief",
      "Final debrief body carries the detailed commit metadata.",
      "Synced and verified commit 5f72a9c1d0e7b8a91c2d3e4f5061728394abcdef.",
    );

    expect(warning).toContain("quest debrief TLDR appears to include raw commit/hash bookkeeping");
    expect(warning).toContain("structured commit metadata");
    expect(warning).toContain("Synced SHAs");
  });

  it("does not warn for hash-like values unless the TLDR context looks like bookkeeping", () => {
    expect(hasLikelyHashBookkeepingInTldr("Documented artifact digest 5f72a9c for the dataset provenance note.")).toBe(
      false,
    );
  });

  it("allows narrow cases where the exact identifier is the subject", () => {
    expect(hasLikelyHashBookkeepingInTldr("Debugged invalid commit reference 5f72a9c in the parser.")).toBe(false);
  });

  it("does not replace long-content warnings or hash-bookkeeping warnings", () => {
    expect(tldrWarningsForContent("feedback", "Long implementation detail. ".repeat(80), undefined)).toEqual([
      expect.stringContaining("quest feedback is 1200+ characters"),
    ]);

    const warnings = tldrWarningsForContent(
      "feedback",
      "Long implementation detail. ".repeat(80),
      "Ported commit 5f72a9c.",
    );

    expect(warnings).toEqual([
      expect.stringContaining("quest feedback TLDR appears to include raw commit/hash bookkeeping"),
    ]);
  });
});
