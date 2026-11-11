import { describe, expect, it } from "vitest";
import { markdownToPlainText, stripInlineMarkdown } from "./markdown-plain-text.js";

/**
 * Markdown to plain text for titles, labels and copies. The bug this guards: underscores inside
 * words and code were taken for emphasis, so a to-do titled "... to QA_DATASETS_1031" showed as
 * "... to QADATASETS1031", in the title and in the link built from it.
 */
describe("stripInlineMarkdown", () => {
  it("keeps underscores inside words, identifiers and code spans", () => {
    expect(stripInlineMarkdown("Review Junhong's PR #111645 adding SWE Atlas QA to QA_DATASETS_1031")).toBe(
      "Review Junhong's PR #111645 adding SWE Atlas QA to QA_DATASETS_1031",
    );
    expect(stripInlineMarkdown("Review PR adding SWE Atlas QA to `QA_DATASETS_1031`")).toBe(
      "Review PR adding SWE Atlas QA to QA_DATASETS_1031",
    );
    // `__init__` needs backticks, as when Markdown renders it: bare, it is strong text.
    expect(stripInlineMarkdown("rename snake_case_name and `__init__` in `my_module.py`")).toBe(
      "rename snake_case_name and __init__ in my_module.py",
    );
    // Emphasis marks inside code are code, not emphasis.
    expect(stripInlineMarkdown("run `a *b* _c_`")).toBe("run a *b* _c_");
  });

  it("still drops real emphasis, strong text and strikethrough", () => {
    expect(stripInlineMarkdown("an _important_ and __bold__ point")).toBe("an important and bold point");
    expect(stripInlineMarkdown("_whole title_")).toBe("whole title");
    expect(stripInlineMarkdown("*stars* and **more** and ~~gone~~")).toBe("stars and more and gone");
    expect(stripInlineMarkdown("(_aside_), ok")).toBe("(aside), ok");
  });

  it("keeps link and image labels, including labels with code or identifiers", () => {
    expect(stripInlineMarkdown("see [`MAX_SIZE`](file:web/a.ts:3) and ![a_b](x.png)")).toBe("see MAX_SIZE and a_b");
    expect(stripInlineMarkdown("[q-12](quest:q-12) fixes some_flag")).toBe("q-12 fixes some_flag");
  });

  it("leaves lone or spaced underscores alone", () => {
    expect(stripInlineMarkdown("a _ b _ c")).toBe("a _ b _ c");
    expect(stripInlineMarkdown("fill in ____ here")).toBe("fill in ____ here");
  });

  it("keeps NUL and token-looking text as it was", () => {
    expect(stripInlineMarkdown("x \0C0; `y` \0")).toBe("x \0C0; y \0");
  });
});

describe("markdownToPlainText", () => {
  it("reads a folded <details> section as its title and text, and drops underline tags", () => {
    // Copies and previews of reports with toggles must not show the raw tags; code keeps them as written.
    const markdown = [
      "Intro",
      "",
      "<details><summary>Run logs</summary>",
      "",
      "- **first** item",
      "",
      "</details>",
      "",
      "**<u>TL;DR</u>** done, `<u>kept</u>`",
    ].join("\n");
    expect(markdownToPlainText(markdown)).toBe(
      ["Intro", "", "Run logs", "", "first item", "", "TL;DR done, <u>kept</u>"].join("\n"),
    );
  });

  it("keeps identifiers and code intact in whole messages", () => {
    const markdown = [
      "# Update QA_DATASETS_1031",
      "",
      "- add `swe_atlas_qa` to the _list_",
      "",
      "```python",
      "QA_DATASETS = [*base, swe_atlas]",
      "```",
    ].join("\n");
    expect(markdownToPlainText(markdown)).toBe(
      ["Update QA_DATASETS_1031", "", "add swe_atlas_qa to the list", "", "QA_DATASETS = [*base, swe_atlas]"].join(
        "\n",
      ),
    );
  });
});
