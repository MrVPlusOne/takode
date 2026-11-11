// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({ api: {} }));

import { MarkdownContent } from "../components/MarkdownContent.js";
import { messageCopyForSlack, selectionCopyForSlack, slackCodeBlock } from "./slack-copy.js";

// Slack keeps a small set of formats on paste: bold, italic, strikethrough, inline code, links, nested
// bulleted and numbered lists, quotes and code blocks (<pre>). It has no headings or tables and flattens an
// HTML table into running text. These tests feed Takode's real rendered Markdown through the conversion.
const SAMPLE = `## Status update

The run is **healthy**, *mostly*, ~~not stalled~~, and \`step_time\` is fine. See [the dashboard](https://example.com/dash) and [q-12](quest:q-12).

- First point with **bold**
  - Nested detail
- Second point

1. Step one
2. Step two
   1. Sub-step

> Quoted line one.
> Quoted line two.

---

| Domain | Share |
| --- | --- |
| SWE | 15.5% |

\`\`\`python
def f(x):
    return x * 2
\`\`\`

Final line.`;

function rendered(text = SAMPLE): HTMLElement {
  const { container } = render(
    <div>
      <button aria-label="Message options">...</button>
      <MarkdownContent text={text} />
      <span>4:43 PM</span>
    </div>,
  );
  return container.firstElementChild as HTMLElement;
}

describe("copying a message for Slack", () => {
  it("keeps every format Slack has and maps the rest", () => {
    expect(messageCopyForSlack(rendered()).html).toBe(
      [
        // No headings in Slack: a bold line instead.
        "<p><b>Status update</b></p>",
        // Takode-internal links keep their text; outside links stay links.
        '<p>The run is <b>healthy</b>, <i>mostly</i>, <s>not stalled</s>, and <code>step_time</code> is fine. See <a href="https://example.com/dash">the dashboard</a> and q-12.</p>',
        "<ul><li>First point with <b>bold</b><ul><li>Nested detail</li></ul></li><li>Second point</li></ul>",
        "<ol><li>Step one</li><li>Step two<ol><li>Sub-step</li></ol></li></ol>",
        "<blockquote><p>Quoted line one.<br>Quoted line two.</p></blockquote>",
        // No dividers in Slack: a line of box-drawing characters.
        "<p>──────────</p>",
        // Tables become one code block with aligned columns; code blocks lose their header and highlighting.
        "<pre>Domain  Share\n------  -----\nSWE     15.5%</pre>",
        "<pre>def f(x):\n    return x * 2</pre>",
        "<p>Final line.</p>",
        // No empty paragraphs between blocks: Slack sets them on consecutive lines, the way Jiayi writes,
        // and gives code blocks, lists and quotes their own spacing. Empty lines read as extra in Slack.
      ].join(""),
    );
  });

  it("keeps a link whose label is inline code as a link", () => {
    // Slack pastes <a><code>…</code></a> as a code span and loses the link, so the label's code is
    // dropped and the link kept. Code outside links and internal links' code stay code.
    const text =
      "See [`get_container_resources()`](https://example.com/r), [the `f()` docs](https://example.com/f), `g()` and [`x`](quest:q-12).";
    expect(messageCopyForSlack(rendered(text)).html).toBe(
      '<p>See <a href="https://example.com/r">get_container_resources()</a>, <a href="https://example.com/f">the f() docs</a>, <code>g()</code> and <code>x</code>.</p>',
    );
  });

  it("copies only the rendered Markdown: no classes, controls, menu or time label", () => {
    const { html, plain } = messageCopyForSlack(rendered());
    expect(html).not.toMatch(/class=|style=|<div|<span|<button|<svg|python/);
    expect(plain).not.toContain("4:43 PM");
    expect(plain).not.toContain("...");
  });

  it("writes the same content as Markdown for the plain text, which Slack formats itself", () => {
    // Slack formats pasted text that looks like Markdown (a list is enough) and then ignores the HTML, so
    // the plain text has to carry links and formatting too. Paragraphs stay on consecutive lines through
    // hard breaks; a list or quote ends with a blank line, or Markdown would read on into its last item.
    expect(messageCopyForSlack(rendered()).plain).toBe(
      [
        "**Status update**  ",
        "The run is **healthy**, *mostly*, ~~not stalled~~, and `step_time` is fine. See [the dashboard](https://example.com/dash) and q-12.",
        "- First point with **bold**",
        "  - Nested detail",
        "- Second point",
        "",
        "1. Step one",
        "2. Step two",
        "   1. Sub-step",
        "",
        "> Quoted line one.  ",
        "> Quoted line two.",
        "",
        "──────────",
        "```",
        "Domain  Share",
        "------  -----",
        "SWE     15.5%",
        "```",
        "```",
        "def f(x):",
        "    return x * 2",
        "```",
        "Final line.",
      ].join("\n"),
    );
  });

  it("keeps line breaks, backticks and brackets intact in the Markdown text", () => {
    const text = "One line\nnext line, ``a`b`` and [a [b] c](https://example.com/x_(y)).";
    expect(messageCopyForSlack(rendered(text)).plain).toBe(
      "One line  \nnext line, ``a`b`` and [a \\[b\\] c](<https://example.com/x_(y)>).",
    );
  });

  it("keeps the space next to a formatted word", () => {
    // "**bold **word" must not paste as "boldword".
    const content = document.createElement("div");
    content.innerHTML = '<div class="markdown-body"><p><strong>bold </strong>word</p></div>';
    expect(messageCopyForSlack(content).html).toBe("<p><b>bold</b> word</p>");
  });

  it("leaves the rendered message itself untouched", () => {
    const content = rendered();
    const before = content.innerHTML;
    messageCopyForSlack(content);
    expect(content.innerHTML).toBe(before);
  });

  it("carries underline in the HTML and drops it from the Markdown text, which has no underline", () => {
    // Drafts write Slack's bold-underlined titles as **<u>TL;DR</u>**. Slack's Markdown paste shows <u> as
    // typed, so the plain text keeps only the bold.
    const copy = messageCopyForSlack(rendered("**<u>TL;DR</u>**\nReady for review."));
    expect(copy.html).toBe("<p><b><u>TL;DR</u></b><br>Ready for review.</p>");
    expect(copy.plain).toBe("**TL;DR**  \nReady for review.");
  });

  it("writes Slack's own format, a Quill delta, with every format as Slack's composer copies it", () => {
    // Slack desktop pastes slack/texty exactly: a paste test confirmed bold-underlined titles, tight lists,
    // links, inline code, italic, strikethrough, a nested bullet, a numbered list, a quote and a code block.
    // Each line ends in a newline carrying the line's format; a break inside a list item becomes a space,
    // since a Slack list item holds no line break.
    const text = [
      "**<u>TL;DR</u>**",
      "A [link](https://example.com/a), `code`, *italic*, ~~strike~~.",
      "- First",
      "  second line",
      "  - Nested",
      "1. Step",
      "",
      "> Quoted",
      "",
      "```",
      "run it",
      "",
      "again",
      "```",
      "Last line.",
    ].join("\n");
    const { texty } = messageCopyForSlack(rendered(text));
    expect(JSON.parse(texty!).ops).toEqual([
      { insert: "TL;DR", attributes: { bold: true, underline: true } },
      { insert: "\n" },
      { insert: "A " },
      { insert: "link", attributes: { link: "https://example.com/a" } },
      { insert: ", " },
      { insert: "code", attributes: { code: true } },
      { insert: ", " },
      { insert: "italic", attributes: { italic: true } },
      { insert: ", " },
      { insert: "strike", attributes: { strike: true } },
      { insert: "." },
      { insert: "\n" },
      { insert: "First" },
      { insert: " " },
      { insert: "second line" },
      { insert: "\n", attributes: { list: "bullet" } },
      { insert: "Nested" },
      { insert: "\n", attributes: { list: "bullet", indent: 1 } },
      { insert: "Step" },
      { insert: "\n", attributes: { list: "ordered" } },
      { insert: "Quoted" },
      { insert: "\n", attributes: { blockquote: true } },
      { insert: "run it" },
      { insert: "\n", attributes: { "code-block": true } },
      { insert: "\n", attributes: { "code-block": true } },
      { insert: "again" },
      { insert: "\n", attributes: { "code-block": true } },
      { insert: "Last line." },
      { insert: "\n" },
    ]);
  });
});

describe("copying a selection for Slack", () => {
  it("keeps the formatting of a selection inside a paragraph", () => {
    const content = rendered();
    const paragraph = content.querySelectorAll("p")[0]!;
    const range = document.createRange();
    range.setStart(paragraph, 1);
    range.setEnd(paragraph, 6);
    expect(selectionCopyForSlack(range).html).toBe("<p><b>healthy</b>, <i>mostly</i>, <s>not stalled</s></p>");
  });

  it("keeps selected list items as a list, nesting included", () => {
    const content = rendered();
    const list = content.querySelector("ul")!;
    const range = document.createRange();
    range.selectNodeContents(list);
    expect(selectionCopyForSlack(range).html).toBe(
      "<ul><li>First point with <b>bold</b><ul><li>Nested detail</li></ul></li><li>Second point</li></ul>",
    );
  });

  it("turns selected table rows into an aligned code block", () => {
    const content = rendered();
    const range = document.createRange();
    range.selectNode(content.querySelector("table")!);
    expect(selectionCopyForSlack(range).html).toBe("<pre>Domain  Share\n------  -----\nSWE     15.5%</pre>");
  });
});

it("copies a single block as an HTML <pre> with a fenced plain-text fallback", () => {
  expect(slackCodeBlock("a  b\n1  <2>")).toMatchObject({
    plain: "```\na  b\n1  <2>\n```",
    html: "<pre>a  b\n1  &lt;2&gt;</pre>",
  });
});
