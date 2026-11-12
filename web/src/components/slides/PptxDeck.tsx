import { useCallback, useMemo, useState } from "react";
import type { ArtifactVersionContent } from "../../../shared/artifact-library.js";
import type { Slide } from "../../../shared/slides.js";
import { SlidePresenter, SlideView, slideLayoutFor, useElementWidth, useSwipe, type RenderSlide } from "./SlideDeck.js";
import { DeckToolbar, SlideNotes, handleDeckKey, useSlideClicks } from "./SlideControls.js";

type PptxContent = Extract<ArtifactVersionContent, { kind: "pptx" }>;

/** Marks a slide shown as its picture; the rest of the "Markdown" is the picture's URL. */
const PICTURE = "takode-pptx-picture:";

/**
 * A PowerPoint deck an agent published, in the Library: one slide at a time, as its picture when
 * the deck was published with slide pictures, else as its text, with its speaker notes below and
 * the deck controls (previous and next, the slide list, full screen) under it. Clicks, swipes and
 * keys turn slides as in a Markdown deck. The file itself downloads from the viewer's header.
 */
export function PptxDeck({
  content,
  title,
  renderMarkdown,
}: {
  content: PptxContent;
  title: string;
  renderMarkdown: (text: string) => React.ReactNode;
}) {
  const slides = useMemo(() => content.slides.map(toSlide), [content.slides]);
  const render: RenderSlide = useCallback(
    (markdown) =>
      markdown.startsWith(PICTURE) ? (
        <img
          src={markdown.slice(PICTURE.length)}
          alt=""
          draggable={false}
          // On the stage the picture fills it edge to edge, past the padding text slides keep.
          className="block w-full rounded-md [.takode-slide-stage_&]:absolute [.takode-slide-stage_&]:inset-0 [.takode-slide-stage_&]:h-full [.takode-slide-stage_&]:rounded-none [.takode-slide-stage_&]:object-contain"
          data-testid="pptx-slide-picture"
        />
      ) : (
        renderMarkdown(markdown)
      ),
    [renderMarkdown],
  );
  const [index, setIndex] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const [measureRef, width] = useElementWidth<HTMLDivElement>();
  const go = useCallback((next: number) => setIndex(Math.max(0, Math.min(slides.length - 1, next))), [slides.length]);
  const swipe = useSwipe((step) => go(index + step));
  const clicks = useSlideClicks((step) => go(index + step));
  const close = useCallback(() => setPresenting(false), []);
  const shown = Math.min(index, slides.length - 1);
  const slide = slides[shown];
  // Slide pictures are scaled on the stage even on a phone: a picture doesn't reflow like text.
  const layout = content.slides.some((candidate) => candidate.pictureUrl) ? "stage" : slideLayoutFor(width);
  return (
    <div className="min-w-0" data-testid="pptx-deck">
      <div className="mb-2 text-xs text-cc-muted" data-copy-exclude="">
        {[slides.length === 1 ? "1 slide" : `${slides.length} slides`, content.name, formatBytes(content.bytes)].join(
          " · ",
        )}
      </div>
      <div
        className="min-w-0 outline-none"
        tabIndex={-1}
        onKeyDown={(event) => handleDeckKey(event, { index: shown, count: slides.length, go, vertical: false })}
      >
        <div ref={measureRef} className="min-w-0" {...swipe} {...clicks} data-testid="slide-stepper">
          {width > 0 && slide && (
            <SlideView
              key={shown}
              slide={slide}
              layout={layout}
              width={width}
              height={Math.round(Math.min(560, window.innerHeight * 0.62))}
              render={render}
            />
          )}
        </div>
        {slides.length > 0 && (
          <DeckToolbar
            slides={slides}
            index={shown}
            onChange={go}
            fullScreen={{ active: false, onToggle: () => setPresenting(true) }}
            className="mt-1"
          />
        )}
        {slide?.notes && (
          <SlideNotes notes={slide.notes} render={render} className="mt-2 border-t border-cc-border px-1 pt-2" />
        )}
      </div>
      {presenting && (
        <SlidePresenter
          title={title}
          slides={slides}
          index={shown}
          onChange={go}
          render={render}
          onClose={close}
          layout={layout === "stage" ? "stage" : undefined}
        />
      )}
    </div>
  );
}

/** A published slide as a deck slide: its picture, or its title and text as Markdown; notes as Markdown text. */
function toSlide(slide: PptxContent["slides"][number], index: number): Slide {
  const lines = slide.text.split("\n").filter((line) => line.trim());
  return {
    markdown: slide.pictureUrl
      ? `${PICTURE}${slide.pictureUrl}`
      : [slide.title && `## ${plain(slide.title)}`, ...lines.map(plain)].filter(Boolean).join("\n\n"),
    notes: slide.notes
      .split("\n")
      .filter((line) => line.trim())
      .map(plain)
      .join("\n\n"),
    title: slide.title || `Slide ${index + 1}`,
  };
}

/** Text from a slide shown as written: characters Markdown would read as formatting are escaped. */
function plain(text: string): string {
  return text.replace(/[\\`*_[\]<>#|~]/g, (char) => `\\${char}`).replace(/^(\s*)([-+]|\d+\.)(\s)/, "$1\\$2$3");
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
