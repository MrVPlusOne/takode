import { describe, expect, it } from "vitest";
import { GLOSSARY, parseGlossary } from "./glossary.js";
import source from "./glossary.md?raw";

describe("parseGlossary", () => {
  // The glossary is one Markdown file people edit by hand: a title, an intro, then `##` sections of
  // `- **Term**: meaning` items. Anything else in a section is not an entry and is skipped.
  it("reads the title, intro, sections and their entries", () => {
    const glossary = parseGlossary(
      [
        "# Takode glossary",
        "",
        "Intro with a **leader**.",
        "",
        "## People and roles",
        "",
        "- **Quest thread**: a thread whose request became a quest.",
        "- **Lease**: a turn on a shared resource such as `dev-server`.",
        "A stray paragraph that is not an entry.",
        "",
        "## Common workflows",
        "- **Ask for something new**: type it on Home.",
      ].join("\n"),
    );

    expect(glossary.title).toBe("Takode glossary");
    expect(glossary.intro).toEqual(["Intro with a **leader**."]);
    expect(glossary.sections.map((section) => [section.title, section.id])).toEqual([
      ["People and roles", "people-and-roles"],
      ["Common workflows", "common-workflows"],
    ]);
    expect(glossary.sections[0].entries).toEqual([
      { term: "Quest thread", text: "a thread whose request became a quest.", id: "quest-thread" },
      { term: "Lease", text: "a turn on a shared resource such as `dev-server`.", id: "lease" },
    ]);
  });
});

describe("glossary.md", () => {
  // Guards the shipped file's format: a heading or item written another way would silently drop
  // terms from the page, so every section must parse into entries with distinct anchors.
  it("parses into sections that each have entries, with unique ids", () => {
    expect(GLOSSARY.intro.length).toBeGreaterThan(0);
    expect(GLOSSARY.sections.length).toBeGreaterThan(0);
    for (const section of GLOSSARY.sections) expect(section.entries.length).toBeGreaterThan(0);
    const ids = GLOSSARY.sections.flatMap((section) => section.entries.map((entry) => entry.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("turns every list item into an entry", () => {
    const items = source.split("\n").filter((line) => line.trim().startsWith("- ")).length;
    expect(GLOSSARY.sections.reduce((count, section) => count + section.entries.length, 0)).toBe(items);
  });
});
