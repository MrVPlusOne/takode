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
        // Slack sets pasted paragraphs on consecutive lines; an empty paragraph is the blank line between blocks.
      ].join("<p><br></p>"),
    );
  });

  it("copies only the rendered Markdown: no classes, controls, menu or time label", () => {
    const { html, plain } = messageCopyForSlack(rendered());
    expect(html).not.toMatch(/class=|style=|<div|<span|<button|<svg|python/);
    expect(plain).not.toContain("4:43 PM");
    expect(plain).not.toContain("...");
  });

  it("writes readable plain text with code blocks fenced and no runs of blank lines", () => {
    const { plain } = messageCopyForSlack(rendered());
    expect(plain).toContain("The run is healthy, mostly, not stalled, and step_time is fine.");
    expect(plain).toContain("```\nDomain  Share\n------  -----\nSWE     15.5%\n```");
    expect(plain).toContain("```\ndef f(x):\n    return x * 2\n```");
    expect(plain).not.toMatch(/\n{3,}/);
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
