// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({ api: {} }));

import { MarkdownContent } from "./MarkdownContent.js";

const TABLE = "| Domain | Share |\n| --- | --- |\n| SWE | **15.5%** |\n| TB | 12.8% |";

/** What each copy wrote, by MIME type, read back from the ClipboardItem blobs. */
const written: Array<Record<string, string>> = [];
const originalClipboardItem = globalThis.ClipboardItem;

beforeEach(() => {
  written.length = 0;
  (globalThis as any).ClipboardItem = class {
    constructor(public items: Record<string, Blob>) {}
  };
  Object.assign(navigator, {
    clipboard: {
      writeText: vi.fn(async (text: string) => void written.push({ "text/plain": text })),
      write: vi.fn(async ([item]: Array<{ items: Record<string, Blob> }>) => {
        const out: Record<string, string> = {};
        for (const [type, blob] of Object.entries(item!.items)) out[type] = await blob.text();
        written.push(out);
      }),
    },
  });
});

afterEach(() => {
  (globalThis as any).ClipboardItem = originalClipboardItem;
});

function copyAs(label: string) {
  fireEvent.click(screen.getByRole("button", { name: "Copy table" }));
  fireEvent.click(screen.getByRole("button", { name: label }));
}

// Each table has its own Copy menu next to View table. Slack builds its native table from
// tab-separated text (even with an HTML table alongside) and turns an HTML <pre> into one code block;
// both were checked by pasting into Slack desktop.
describe("table Copy menu", () => {
  it("copies a table as tab-separated cells with an HTML table alongside", async () => {
    render(<MarkdownContent text={TABLE} />);
    copyAs("Copy as table (Slack, sheets, docs)");

    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]!["text/plain"]).toBe("Domain\tShare\nSWE\t15.5%\nTB\t12.8%");
    expect(written[0]!["text/html"]).toContain("<td>15.5%</td>");
  });

  it("copies a code block of aligned columns, and Markdown", async () => {
    render(<MarkdownContent text={TABLE} />);
    copyAs("Copy as code block");
    await waitFor(() => expect(written).toHaveLength(1));
    expect(written[0]!["text/html"]).toBe("<pre>Domain  Share\n------  -----\nSWE     15.5%\nTB      12.8%</pre>");

    copyAs("Copy as Markdown");
    await waitFor(() => expect(written).toHaveLength(2));
    expect(written[1]!["text/plain"]).toBe("| Domain | Share |\n| --- | --- |\n| SWE | 15.5% |\n| TB | 12.8% |");
  });

  it("keeps its controls out of selections", () => {
    render(<MarkdownContent text={TABLE} />);
    const controls = screen.getByRole("button", { name: "Copy table" }).parentElement!;
    expect(controls).toHaveAttribute("data-copy-exclude");
    expect(controls.className).toContain("select-none");
  });
});
