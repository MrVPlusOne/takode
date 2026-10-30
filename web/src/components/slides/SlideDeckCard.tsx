import { useCallback, useMemo, useState, type ReactNode } from "react";
import { splitSlides } from "../../../shared/slides.js";
import { exportDeck, type DeckExportFormat } from "../../utils/deck-export.js";
import { CardMoreMenu, useCardExport } from "../CardMoreMenu.js";
import type { ContextMenuItem } from "../ContextMenu.js";
import {
  PresentIcon,
  SlideNav,
  SlidePresenter,
  SlideView,
  slideLayoutFor,
  useElementWidth,
  useSwipe,
  type RenderSlide,
} from "./SlideDeck.js";

const DECK_EXPORT_FORMATS: readonly DeckExportFormat[] = ["pdf", "markdown", "html"];

/**
 * A slide deck (a report with `slides: true` front matter) in a conversation, the Library or an
 * artifact window: one slide at a time with previous and next, Present for the whole screen, and
 * More, whose Export saves the deck as a PDF with one slide per page.
 */
export function SlideDeckCard({
  title,
  markdown,
  render,
  readAloud,
  menuItems = [],
  framed = true,
}: {
  title: string;
  /** The deck's Markdown, front matter included. */
  markdown: string;
  render: RenderSlide;
  /** The Read aloud button, where the deck can be read aloud. */
  readAloud?: ReactNode;
  /** More menu items before Export (opening it elsewhere, copying its Markdown). */
  menuItems?: ContextMenuItem[];
  /** Bordered like a report card in the feed; the Library shows it unframed under its own title. */
  framed?: boolean;
}) {
  const slides = useMemo(() => splitSlides(markdown), [markdown]);
  const [index, setIndex] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const [measureRef, width] = useElementWidth<HTMLDivElement>();
  const close = useCallback(() => setPresenting(false), []);
  const go = useCallback((next: number) => setIndex(Math.max(0, Math.min(slides.length - 1, next))), [slides.length]);
  const swipe = useSwipe((step) => go(index + step));
  const { exportItems, task } = useCardExport(
    useCallback(
      (format) => exportDeck(format as DeckExportFormat, { markdown, title, render }),
      [markdown, title, render],
    ),
  );
  const shown = Math.min(index, slides.length - 1);
  const slide = slides[shown];
  const layout = slideLayoutFor(width);
  return (
    <div
      className={`min-w-0 ${framed ? "rounded-lg border border-cc-border bg-cc-card px-3 py-2.5" : ""}`}
      data-testid="slide-deck-card"
    >
      <div className="mb-2 flex items-center gap-2 text-xs text-cc-muted" data-copy-exclude="">
        <div className="min-w-0 flex-1">
          {framed && <div className="truncate font-medium text-cc-fg">{title}</div>}
          <div>{slides.length === 1 ? "1 slide" : `${slides.length} slides`}</div>
        </div>
        <button
          type="button"
          onClick={() => setPresenting(true)}
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-cc-border px-2 text-[12.5px] text-cc-fg hover:bg-cc-hover pointer-coarse:h-9"
          data-testid="present-button"
        >
          <PresentIcon />
          Present
        </button>
        {readAloud}
        <CardMoreMenu items={[...menuItems, exportItems(DECK_EXPORT_FORMATS)]} task={task} />
      </div>
      <div ref={measureRef} className="min-w-0" {...swipe} data-testid="slide-stepper">
        {width > 0 && slide && (
          <SlideView key={shown} slide={slide} layout={layout} width={width} height={pageHeight()} render={render} />
        )}
      </div>
      <SlideNav slides={slides} index={shown} onChange={go} className="mt-1.5" />
      {presenting && (
        <SlidePresenter title={title} slides={slides} index={shown} onChange={go} render={render} onClose={close} />
      )}
    </div>
  );
}

/** A page's height in a card: most of a phone's screen, so a slide and its buttons fit together. */
function pageHeight(): number {
  return Math.round(Math.min(560, window.innerHeight * 0.62));
}
