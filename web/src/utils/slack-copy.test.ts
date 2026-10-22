// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { messageCopyForSlack, slackCodeBlock } from "./slack-copy.js";

/** A rendered assistant message: prose, a table block with its controls, more prose. */
function renderedMessage(): HTMLElement {
  const content = document.createElement("div");
  content.innerHTML = `
    <button aria-label="Message options">...</button>
    <div class="markdown-body">
    <p>About <strong>10%</strong> of rollouts run past 256K.</p>
    <div data-markdown-table="">
      <div data-copy-exclude=""><button>Copy</button><button>View table</button></div>
      <div><table>
        <thead><tr><th>Domain</th><th>Share</th></tr></thead>
        <tbody><tr><td>SWE</td><td>15.5%</td></tr><tr><td>TB</td><td>12.8%</td></tr></tbody>
      </table></div>
    </div>
    <p>In evals it's mainly DeepSWE.</p>
    <div data-read-aloud-player="">Player</div>
    </div>
    <span>4:43 PM</span>`;
  return content;
}

const ALIGNED = ["Domain  Share", "------  -----", "SWE     15.5%", "TB      12.8%"].join("\n");

describe("copying a message for Slack", () => {
  it("keeps prose as rich text and turns each table into one code block, without the table controls", () => {
    // Slack flattens HTML tables into running text; a <pre> becomes a single code block.
    const copy = messageCopyForSlack(renderedMessage());

    expect(copy.html).toContain("<strong>10%</strong>");
    expect(copy.html).toContain(`<pre>${ALIGNED}</pre>`);
    expect(copy.html).not.toContain("<table");
    expect(copy.html).not.toContain("View table");
    expect(copy.html).not.toContain("Player");
  });

  it("writes plain text with each table in a code fence between the prose", () => {
    const plain = messageCopyForSlack(renderedMessage()).plain;

    expect(plain).toContain("About 10% of rollouts run past 256K.");
    expect(plain).toContain("```\n" + ALIGNED + "\n```");
    expect(plain.indexOf("```")).toBeGreaterThan(plain.indexOf("256K"));
    expect(plain.lastIndexOf("```")).toBeLessThan(plain.indexOf("DeepSWE"));
    expect(plain).not.toContain("View table");
    // Only the rendered Markdown: not the message's menu or corner time, and no runs of blank lines.
    expect(plain).not.toContain("4:43 PM");
    expect(plain).not.toMatch(/\n{3,}/);
  });

  it("leaves the rendered message itself untouched", () => {
    const content = renderedMessage();
    messageCopyForSlack(content);
    expect(content.querySelector("table")).not.toBeNull();
    expect(content.querySelector("[data-copy-exclude]")).not.toBeNull();
  });

  it("copies a single block as an HTML <pre> with a fenced plain-text fallback", () => {
    expect(slackCodeBlock("a  b\n1  <2>")).toMatchObject({
      plain: "```\na  b\n1  <2>\n```",
      html: "<pre>a  b\n1  &lt;2&gt;</pre>",
    });
  });
});
