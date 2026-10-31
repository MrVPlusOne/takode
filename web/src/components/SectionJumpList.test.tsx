// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("../api.js", () => ({ api: {} }));

import { MarkdownContent } from "./MarkdownContent.js";

const sections = (count: number) =>
  Array.from({ length: count }, (_, index) => `## Part ${index + 1}\n\nText ${index + 1}.`).join("\n\n");
const REPORT = `# Title\n\n**The answer first.**\n\n${sections(4)}\n\n\`\`\`md\n## Not a section\n\`\`\``;

// A long report lists its top-level sections under its opening, so a reader sees its shape and
// can jump to any part; surfaces widen their column when the list is there.
describe("section jump list", () => {
  it("lists a long report's ## sections before the first one, as the headings read", () => {
    const { container } = render(
      <MarkdownContent text={REPORT.replace("## Part 2", "## Part *2*: `code`")} sectionJumpList />,
    );
    const nav = screen.getByRole("navigation", { name: "Sections" });
    expect(nav).toHaveAttribute("data-section-jump-list");
    // Between the opening lines and the first section.
    const firstSection = container.querySelector("h2")!;
    expect(screen.getByText("The answer first.").compareDocumentPosition(nav)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(nav.compareDocumentPosition(firstSection)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    // A `##` line inside a code block is not a section.
    expect(
      within(nav)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Part 1", "Part 2: code", "Part 3", "Part 4"]);
    // Controls, not content: copies and exports leave it out.
    expect(nav).toHaveAttribute("data-copy-exclude");
  });

  it("scrolls to the section an entry names", () => {
    const { container } = render(<MarkdownContent text={REPORT} sectionJumpList />);
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
      scrolled.push(this);
    });
    fireEvent.click(within(screen.getByRole("navigation", { name: "Sections" })).getByText("Part 3"));
    expect(scrolled).toEqual([container.querySelectorAll("h2")[2]]);
  });

  it("is left out of short reports and of Markdown that didn't ask for it", () => {
    render(<MarkdownContent text={`# Title\n\n${sections(3)}`} sectionJumpList />);
    expect(screen.queryByRole("navigation")).toBeNull();
    render(<MarkdownContent text={REPORT} />);
    expect(screen.queryByRole("navigation")).toBeNull();
  });
});
