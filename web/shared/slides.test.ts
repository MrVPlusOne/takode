import { describe, expect, it } from "vitest";
import { isSlideDeck, splitSlides, withoutFrontMatter } from "./slides.js";

describe("slide decks", () => {
  it("is a deck only when the front matter says slides: true (or Marp's marp: true)", () => {
    expect(isSlideDeck("---\nslides: true\n---\n\n# Title")).toBe(true);
    expect(isSlideDeck("---\ntheme: default\nmarp: true\n---\n# Title")).toBe(true);
    expect(isSlideDeck("---\nslides: false\n---\n# Title")).toBe(false);
    // A report using --- as section rules is not a deck; it never opted in.
    expect(isSlideDeck("# Report\n\n---\n\n## Part 2")).toBe(false);
    // Front matter must open the file.
    expect(isSlideDeck("# Title\n\n---\nslides: true\n---\n")).toBe(false);
  });

  it("splits at --- lines after a blank line, leaving fences and heading underlines alone", () => {
    const deck = [
      "---",
      "slides: true",
      "---",
      "",
      "# The deck",
      "",
      "*Subtitle*",
      "",
      "---",
      "",
      "## First point",
      "",
      "```visual",
      "title: A flow",
      "alt: Two boxes",
      "---",
      "<div></div>",
      "```",
      "",
      "Setext heading",
      "---",
      "",
      "---",
      "",
      "",
      "---",
      "",
      "## Last point",
    ].join("\n");
    const slides = splitSlides(deck);
    // The empty slide between two separators is dropped.
    expect(slides.map((slide) => slide.title)).toEqual(["The deck", "First point", "Last point"]);
    // The visual's header separator and the heading underline stayed inside the second slide.
    expect(slides[1].markdown).toContain("alt: Two boxes\n---\n<div></div>");
    expect(slides[1].markdown).toContain("Setext heading\n---");
    expect(slides[0].markdown).toBe("# The deck\n\n*Subtitle*");
  });

  it("names a slide by its first heading outside code, else leaves it untitled", () => {
    const slides = splitSlides("---\nslides: true\n---\n```sh\n# a comment\n```\n\nNo heading here.");
    expect(slides).toEqual([{ markdown: "```sh\n# a comment\n```\n\nNo heading here.", title: "" }]);
  });

  it("removes the front matter for display and keeps other text as it is", () => {
    expect(withoutFrontMatter("---\nslides: true\n---\n# Title")).toBe("# Title");
    expect(withoutFrontMatter("# Title\n\n---\n\nMore")).toBe("# Title\n\n---\n\nMore");
  });
});
