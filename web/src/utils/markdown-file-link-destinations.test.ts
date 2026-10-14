import { describe, expect, it } from "vitest";
import { wrapSpacedFileLinkDestinations } from "./markdown-file-link-destinations.js";

describe("wrapSpacedFileLinkDestinations", () => {
  it("wraps every spaced file: target in prose and nothing else", () => {
    // Several links on a line, balanced parentheses in a name, and a Chinese full stop after
    // the link (as in the reported message) all keep their surrounding text unchanged.
    const text = "见 [a](file:/My Docs/a.md)。 [b](file:/x/Doc (1).md:4) [c](file:/plain.md)";

    expect(wrapSpacedFileLinkDestinations(text)).toBe(
      "见 [a](<file:/My Docs/a.md>)。 [b](<file:/x/Doc (1).md:4>) [c](file:/plain.md)",
    );
  });

  it("leaves code, already-bracketed targets and links that already parse as written", () => {
    // A link with a title already parses, so its space is the title separator, not part of the path.
    const text = [
      "`[a](file:/My Docs/a.md)`",
      "[b](<file:/My Docs/b.md>)",
      '[c](file:/c.md "the title")',
      "    [d](file:/My Docs/d.md)",
    ].join("\n\n");

    expect(wrapSpacedFileLinkDestinations(text)).toBe(text);
  });

  it("leaves targets it cannot safely bracket", () => {
    // No link text on the line, a line break inside the target, or an unbalanced parenthesis.
    const text = "see ](file:/a b.md)\n\n[e](file:/a\nb.md)\n\n[f](file:/a b (.md";

    expect(wrapSpacedFileLinkDestinations(text)).toBe(text);
  });
});
