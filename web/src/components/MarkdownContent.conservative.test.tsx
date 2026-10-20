// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { useStore } from "../store.js";

vi.mock("../api.js", () => ({ api: { getSettings: vi.fn(async () => ({})) } }));

import { MarkdownContent } from "./MarkdownContent.js";

// The conservative variant renders text people type (user messages, to-dos, quest previews and similar).
// Its rule: syntax it renders looks as in replies, and syntax it does not render stays exactly as typed,
// never dropped. Headings are the one element it deliberately leaves as text.
function renderTyped(text: string) {
  const { container } = render(<MarkdownContent text={text} variant="conservative" />);
  return container.querySelector(".markdown-body") as HTMLElement;
}

describe("MarkdownContent conservative variant", () => {
  beforeEach(() => {
    useStore.getState().reset();
  });

  it("keeps an ATX heading as a line of text with its hashes, on its own line next to the following text", () => {
    // A stray `#` at the start of a line must not turn the line into a large section title or lose the `#`.
    const body = renderTyped("## Heading line with **bold** ##\nbody");

    expect(body.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
    const paragraphs = body.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.textContent).toBe("## Heading line with bold ##\nbody");
    // Inline Markdown inside the line still renders; only the heading itself stays as typed.
    expect(paragraphs[0]?.querySelector("strong")?.textContent).toBe("bold");
  });

  it("keeps a lone hash line visible", () => {
    // An empty heading has no inner text, so dropping its marker would leave nothing at all.
    expect(renderTyped("before\n#\nafter").textContent).toBe("before\n#\nafter");
  });

  it("shows a line of text over --- as the text followed by a divider", () => {
    // Markdown would read this as a heading; typed messages mean a divider.
    const body = renderTyped("Notes before a divider\n---\nmore");

    expect(body.querySelector("h1, h2")).toBeNull();
    expect(body.querySelector("hr")).toBeTruthy();
    expect(body.textContent).toContain("Notes before a divider");
    expect(body.textContent).toContain("more");
  });

  it("keeps a line of text over === as both typed lines, also inside a quote", () => {
    // The underline is kept without the quote marker that the blockquote already shows.
    const body = renderTyped("> Title\n> ===\n> after");

    expect(body.querySelector("h1")).toBeNull();
    expect(body.querySelector("blockquote")?.textContent?.trim()).toBe("Title\n===\nafter");
  });

  it("renders dividers, tables and images like replies", () => {
    // These used to be dropped: dividers vanished, table cells ran together and images disappeared.
    const body = renderTyped(
      "above\n\n***\n\nbelow\n\n| Option | Cost |\n|---|---|\n| A | $5 |\n\nsee ![diagram](https://example.com/d.png)",
    );

    expect(body.querySelector("hr")).toBeTruthy();
    expect([...body.querySelectorAll("th")].map((cell) => cell.textContent)).toEqual(["Option", "Cost"]);
    expect(body.querySelector("img")?.getAttribute("alt")).toBe("diagram");
  });

  it("still renders headings as sections in the full variant", () => {
    // Replies keep standard Markdown headings, including a line over ---.
    const { container } = render(<MarkdownContent text={"# Title\n\nText\n---"} />);

    expect(container.querySelector("h1")?.textContent).toBe("Title");
    expect(container.querySelector("h2")?.textContent).toBe("Text");
  });
});
