/**
 * Takode's glossary, read from the one Markdown file people edit: `glossary.md` beside this file. It is
 * bundled with the frontend, so the app always shows the glossary of its own build.
 *
 * The file is plain Markdown that also reads well on GitHub: an intro paragraph under the
 * `#` title, then `##` sections whose entries are list items starting with a bold term,
 * `- **Term**: what it means.`
 */
import source from "./glossary.md?raw";

export interface GlossaryEntry {
  /** The entry's bold term, such as "Quest thread". */
  term: string;
  /** The text after the colon, with inline `**bold**` and backticks kept. */
  text: string;
  /** Stable anchor id derived from the term, such as `quest-thread`. */
  id: string;
}

export interface GlossarySection {
  title: string;
  id: string;
  entries: GlossaryEntry[];
}

export interface Glossary {
  title: string;
  /** The paragraphs between the title and the first section. */
  intro: string[];
  sections: GlossarySection[];
}

/** The parsed glossary of this build. */
export const GLOSSARY: Glossary = parseGlossary(source);

/** Parses the glossary Markdown described at the top of this file. */
export function parseGlossary(markdown: string): Glossary {
  const glossary: Glossary = { title: "Glossary", intro: [], sections: [] };
  let section: GlossarySection | null = null;
  for (const rawLine of markdown.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("## ")) {
      const title = line.slice(3).trim();
      section = { title, id: slug(title), entries: [] };
      glossary.sections.push(section);
      continue;
    }
    if (line.startsWith("# ")) {
      glossary.title = line.slice(2).trim();
      continue;
    }
    if (!section) {
      glossary.intro.push(line);
      continue;
    }
    const entry = parseEntry(line);
    if (entry) section.entries.push(entry);
  }
  return glossary;
}

function parseEntry(line: string): GlossaryEntry | null {
  const match = /^- \*\*(.+?)\*\*:\s*(.+)$/.exec(line);
  if (!match) return null;
  return { term: match[1], text: match[2], id: slug(match[1]) };
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
