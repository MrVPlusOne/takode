// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  displayWidth,
  readTableRows,
  tableToAlignedText,
  tableToHtml,
  tableToMarkdown,
  tableToTsv,
} from "./table-copy.js";

function table(html: string): HTMLTableElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container.querySelector("table")!;
}

const RENDERED = table(`
  <table>
    <thead><tr><th>Domain</th><th>Steps 80–89</th></tr></thead>
    <tbody>
      <tr><td>SWE (SB)</td><td><strong>15.5%</strong> (14–21%/step)</td></tr>
      <tr><td>QA | WebDev</td><td><a href="https://example.com">~0%</a></td></tr>
    </tbody>
  </table>`);

describe("table copy formats", () => {
  it("reads cells as they read on screen: formatting and links become their text", () => {
    expect(readTableRows(RENDERED)).toEqual([
      ["Domain", "Steps 80–89"],
      ["SWE (SB)", "15.5% (14–21%/step)"],
      ["QA | WebDev", "~0%"],
    ]);
  });

  it("writes tab-separated rows, the shape Slack's table and spreadsheets paste as cells", () => {
    expect(tableToTsv(readTableRows(RENDERED))).toBe(
      "Domain\tSteps 80–89\nSWE (SB)\t15.5% (14–21%/step)\nQA | WebDev\t~0%",
    );
  });

  it("lines up columns for a code block, with an underlined header", () => {
    expect(tableToAlignedText(readTableRows(RENDERED))).toBe(
      [
        "Domain       Steps 80–89",
        "-----------  -------------------",
        "SWE (SB)     15.5% (14–21%/step)",
        "QA | WebDev  ~0%",
      ].join("\n"),
    );
  });

  it("counts Chinese characters as two columns wide so mixed tables stay aligned", () => {
    // Jiayi writes some tables in Chinese; a monospace font draws each such character two columns wide.
    expect(displayWidth("中文ab")).toBe(6);
    expect(
      tableToAlignedText([
        ["名称", "x"],
        ["ab", "y"],
      ]),
    ).toBe(["名称  x", "----  -", "ab    y"].join("\n"));
  });

  it("escapes pipes in Markdown cells and pads short rows to the header's columns", () => {
    expect(tableToMarkdown([["A", "B"], ["a|b"]])).toBe("| A | B |\n| --- | --- |\n| a\\|b |  |");
    expect(tableToTsv([["A", "B", "C"], ["1"]])).toBe("A\tB\tC\n1\t\t");
  });

  it("writes a clean HTML table with escaped cells", () => {
    expect(tableToHtml([["A<b>"], ["1 & 2"]])).toBe(
      "<table><thead><tr><th>A&lt;b&gt;</th></tr></thead><tbody><tr><td>1 &amp; 2</td></tr></tbody></table>",
    );
  });
});
