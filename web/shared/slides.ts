import { scanFences } from "./draft-posts.js";

/**
 * Slide decks: Markdown an agent wrote to be shown one slide at a time. A deck opts in with front
 * matter (`slides: true`, or Marp's `marp: true`) and separates slides with a `---` line, as Marp
 * does, so a deck reads as an ordinary document anywhere else. A `Notes:` line ends what a slide
 * shows; the text after it is the slide's speaker notes, the script said over it.
 */

export interface Slide {
  /** What the slide shows (Markdown), without its separators or notes. */
  markdown: string;
  /** Its speaker notes (Markdown): what is said over the slide. Empty when it has none. */
  notes: string;
  /** Its first heading, for the slide list; empty when it has none. */
  title: string;
}

const FRONT_MATTER = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;
const DECK_KEY = /^(?:slides|marp)[ \t]*:[ \t]*true[ \t]*$/m;
const HEADING = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/m;
/** The line that starts a slide's speaker notes. */
const NOTES_LINE = /^ {0,3}Notes:[ \t]*$/;

/** Whether `markdown` is a slide deck: its front matter says `slides: true` (or `marp: true`). */
export function isSlideDeck(markdown: string): boolean {
  const front = FRONT_MATTER.exec(markdown.replace(/^﻿/, ""));
  return !!front && DECK_KEY.test(front[1]);
}

/** The Markdown without its front matter, as it shows on screen. */
export function withoutFrontMatter(markdown: string): string {
  const text = markdown.replace(/^﻿/, "");
  const front = FRONT_MATTER.exec(text);
  return front ? text.slice(front[0].length) : text;
}

/**
 * The slides of a deck, in order: split at `---` lines outside code fences that follow a blank line
 * (right after a paragraph, `---` underlines a heading instead). In each slide, a `Notes:` line on
 * its own, after a blank line and outside fences, starts the speaker notes. Empty slides are dropped.
 */
export function splitSlides(markdown: string): Slide[] {
  const text = withoutFrontMatter(markdown);
  const { fences } = scanFences(text);
  const slides: Slide[] = [];
  let start = 0;
  let notes: { at: number; from: number } | null = null;
  let offset = 0;
  let previousBlank = true;
  const push = (end: number) => {
    pushSlide(slides, text.slice(start, notes?.at ?? end), notes ? text.slice(notes.from, end) : "");
  };
  for (const line of text.split("\n")) {
    const lineStart = offset;
    offset += line.length + 1;
    const inFence = fences.some((fence) => lineStart >= fence.start && lineStart <= fence.end);
    if (!inFence && previousBlank && /^ {0,3}-{3,}[ \t]*$/.test(line)) {
      push(lineStart);
      start = offset;
      notes = null;
    } else if (!inFence && previousBlank && !notes && NOTES_LINE.test(line)) {
      notes = { at: lineStart, from: offset };
    }
    previousBlank = !inFence && !line.trim();
  }
  push(text.length);
  return slides;
}

function pushSlide(slides: Slide[], markdown: string, notes: string): void {
  const shown = markdown.trim();
  const said = notes.trim();
  if (!shown && !said) return;
  const heading = HEADING.exec(shown.replace(/```[\s\S]*?```/g, ""))?.[1] ?? "";
  slides.push({ markdown: shown, notes: said, title: heading.replace(/[*_`]/g, "") });
}
