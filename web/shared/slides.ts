import { scanFences } from "./draft-posts.js";

/**
 * Slide decks: Markdown an agent wrote to be shown one slide at a time. A deck opts in with front
 * matter (`slides: true`, or Marp's `marp: true`) and separates slides with a `---` line, as Marp
 * does, so a deck reads as an ordinary document anywhere else.
 */

export interface Slide {
  /** The slide's Markdown, without its separators. */
  markdown: string;
  /** Its first heading, for the slide list; empty when it has none. */
  title: string;
}

const FRONT_MATTER = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;
const DECK_KEY = /^(?:slides|marp)[ \t]*:[ \t]*true[ \t]*$/m;
const HEADING = /^ {0,3}#{1,6}[ \t]+(.+?)[ \t#]*$/m;

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
 * (right after a paragraph, `---` underlines a heading instead). Empty slides are dropped.
 */
export function splitSlides(markdown: string): Slide[] {
  const text = withoutFrontMatter(markdown);
  const { fences } = scanFences(text);
  const slides: Slide[] = [];
  let start = 0;
  let offset = 0;
  let previousBlank = true;
  for (const line of text.split("\n")) {
    const lineStart = offset;
    offset += line.length + 1;
    const inFence = fences.some((fence) => lineStart >= fence.start && lineStart <= fence.end);
    if (!inFence && previousBlank && /^ {0,3}-{3,}[ \t]*$/.test(line)) {
      pushSlide(slides, text.slice(start, lineStart));
      start = offset;
    }
    previousBlank = !inFence && !line.trim();
  }
  pushSlide(slides, text.slice(start));
  return slides;
}

function pushSlide(slides: Slide[], markdown: string): void {
  const trimmed = markdown.trim();
  if (!trimmed) return;
  const heading = HEADING.exec(trimmed.replace(/```[\s\S]*?```/g, ""))?.[1] ?? "";
  slides.push({ markdown: trimmed, title: heading.replace(/[*_`]/g, "") });
}
