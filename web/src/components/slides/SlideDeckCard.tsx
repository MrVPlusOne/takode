import { useCallback, useEffect, useMemo, useState } from "react";
import { splitSlides } from "../../../shared/slides.js";
import { goToPlayedSlide, useReadAloudState } from "../../read-aloud-player.js";
import { exportDeck, type DeckExportFormat } from "../../utils/deck-export.js";
import { CardMoreMenu, useCardExport } from "../CardMoreMenu.js";
import type { ContextMenuItem } from "../ContextMenu.js";
import { SlidePresenter, SlideView, slideLayoutFor, useElementWidth, useSwipe, type RenderSlide } from "./SlideDeck.js";
import {
  DeckToolbar,
  NarrationProgress,
  SlideNotes,
  handleDeckKey,
  narratedDeck,
  slideCommentAttributes,
  useSlideClicks,
  type DeckComments,
  type DeckMessage,
} from "./SlideControls.js";

const DECK_EXPORT_FORMATS: readonly DeckExportFormat[] = ["pdf", "markdown", "html"];

/**
 * A slide deck (a report with `slides: true` front matter) in a conversation, the Library or an
 * artifact window: one slide at a time with its speaker notes below and the deck's controls under
 * it: previous and next, Play (each slide read aloud in turn, right here, where the deck is a
 * conversation message), comments on a slide in a conversation, and Full screen to present it. A
 * click on the slide turns to the next one and a right-click to the previous one; once clicked, the
 * deck takes the arrow keys and Space (play and pause). More's Download saves its Markdown and
 * Export saves it as a PDF with one slide per page.
 */
export function SlideDeckCard({
  title,
  markdown,
  render,
  message,
  comments,
  menuItems = [],
  framed = true,
}: {
  title: string;
  /** The deck's Markdown, front matter included. */
  markdown: string;
  render: RenderSlide;
  /** The message the deck is, which Play reads aloud through; without it there is no Play. */
  message?: DeckMessage;
  /** Where comments on its slides go; without it there is no comment button. */
  comments?: DeckComments;
  /** More menu items before Export (opening it elsewhere, copying its Markdown). */
  menuItems?: ContextMenuItem[];
  /** Bordered like a report card in the feed; the Library shows it unframed under its own title. */
  framed?: boolean;
}) {
  const slides = useMemo(() => splitSlides(markdown), [markdown]);
  const [index, setIndex] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const [measureRef, width] = useElementWidth<HTMLDivElement>();
  const narration = useMemo(() => message && narratedDeck(message, title, slides), [message, title, slides]);
  const read = useReadAloudState(message?.messageId ?? "");
  const playedSlide = read?.slide?.index;
  // While the deck is read aloud, it shows the slide being read; turning a slide reads that one.
  useEffect(() => {
    if (playedSlide !== undefined) setIndex(playedSlide);
  }, [playedSlide]);
  const playing = playedSlide !== undefined;
  const go = useCallback(
    (next: number) => {
      const target = Math.max(0, Math.min(slides.length - 1, next));
      setIndex(target);
      if (playing) goToPlayedSlide(target);
    },
    [playing, slides.length],
  );
  // Leaving full screen keeps the reading going in the card.
  const close = useCallback(() => setPresenting(false), []);
  const swipe = useSwipe((step) => go(index + step));
  const clicks = useSlideClicks((step) => go(index + step));
  const { saveItems, task } = useCardExport(
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
        <CardMoreMenu items={[...menuItems, ...saveItems(DECK_EXPORT_FORMATS)]} task={task} />
      </div>
      {/* The slide and its notes: a comment made in either names the slide. */}
      <div
        className="min-w-0 outline-none"
        tabIndex={-1}
        onKeyDown={(event) =>
          handleDeckKey(event, { index: shown, count: slides.length, go, narration, vertical: false })
        }
        {...(slide ? slideCommentAttributes(slide, shown) : {})}
      >
        <div ref={measureRef} className="min-w-0" {...swipe} {...clicks} data-testid="slide-stepper">
          {width > 0 && slide && (
            <SlideView key={shown} slide={slide} layout={layout} width={width} height={pageHeight()} render={render} />
          )}
        </div>
        {narration && <NarrationProgress messageId={narration.messageId} className="mt-1.5" />}
        <DeckToolbar
          slides={slides}
          index={shown}
          onChange={go}
          narration={narration}
          comments={comments}
          fullScreen={{ active: false, onToggle: () => setPresenting(true) }}
          className="mt-1"
        />
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
          narration={narration}
          comments={comments}
        />
      )}
    </div>
  );
}

/** A page's height in a card: most of a phone's screen, so a slide and its buttons fit together. */
function pageHeight(): number {
  return Math.round(Math.min(560, window.innerHeight * 0.62));
}
