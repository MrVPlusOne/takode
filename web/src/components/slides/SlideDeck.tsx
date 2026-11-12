import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { isTitleSlide, type Slide } from "../../../shared/slides.js";
import type { NarratedDeck } from "../../read-aloud-player.js";
import { SelectableMessage } from "../ArtifactPanel.js";
import { useConversationShown } from "../KeptConversationViews.js";
import { usePreviewSheetHistoryEntry } from "../quest-preview-sheet-history.js";
import {
  DeckToolbar,
  NarrationProgress,
  SlideNotes,
  handleDeckKey,
  slideCommentAttributes,
  usePresenterNotes,
  useSlideClicks,
  type DeckComments,
} from "./SlideControls.js";

/** How a slide is laid out: on a 16:9 stage scaled to fit, or as a page at reading size. */
export type SlideLayout = "stage" | "page";

/** The stage's design size: slides are laid out at this size and scaled to the space they get. */
export const STAGE_WIDTH = 1280;
export const STAGE_HEIGHT = 720;
/** A slide too long for the stage shrinks down to this, then scrolls. */
const MIN_FIT = 0.5;
/**
 * Narrower than this, a stage's text would be too small to read (a phone held upright, a narrow
 * side column), so slides show as pages there. A phone turned sideways gets the stage.
 */
const STAGE_MIN_WIDTH = 640;

export type RenderSlide = (markdown: string) => ReactNode;

/** The layout for slides shown in a box `width` pixels wide. */
export function slideLayoutFor(width: number): SlideLayout {
  return width < STAGE_MIN_WIDTH ? "page" : "stage";
}

/**
 * One slide. On the stage it is laid out at 1280x720 with slide type sizes and scaled to `width`;
 * a slide longer than the stage shrinks to fit (down to half size), then scrolls. As a page it is
 * shown at reading size in `height` and scrolls when longer.
 */
export function SlideView({
  slide,
  layout,
  width,
  height,
  render,
}: {
  slide: Slide;
  layout: SlideLayout;
  width: number;
  /** The page's height; the stage's height follows from its width. */
  height?: number;
  render: RenderSlide;
}) {
  if (layout === "page") {
    return (
      <div
        className="takode-slide-page w-full overflow-y-auto rounded-lg border border-cc-border bg-cc-bg"
        style={{ height }}
        data-testid="slide-page"
      >
        <div className="mx-auto max-w-[860px] px-5 py-5 sm:px-8 sm:py-7">{render(slide.markdown)}</div>
      </div>
    );
  }
  const scale = width / STAGE_WIDTH;
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-lg border border-cc-border bg-cc-bg"
      style={{ width, height: STAGE_HEIGHT * scale }}
      data-testid="slide-stage"
    >
      <div
        className="takode-slide-stage absolute left-0 top-0 origin-top-left"
        style={{ width: STAGE_WIDTH, height: STAGE_HEIGHT, transform: `scale(${scale})` }}
      >
        <FittedSlide markdown={slide.markdown} render={render} />
      </div>
    </div>
  );
}

/** Slide content on the stage, zoomed down until it fits (to `MIN_FIT`), scrolling beyond that. */
function FittedSlide({ markdown, render }: { markdown: string; render: RenderSlide }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(1);
  useLayoutEffect(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content) return;
    const measure = () => {
      const next = fitContent(box, content);
      if (next !== null) setFit(next);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    // Images and visuals arrive after the first render and make the slide taller. Fitting tries
    // zooms on the content, so it runs in the next frame rather than inside the observer's callback,
    // which must not resize what it observes; the frame ends on the result, so nothing flashes.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    observer.observe(content);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  return (
    <div className="flex h-full flex-col px-[72px] py-[52px]">
      {/* A stable gutter: a scrollbar showing up must not narrow the content and rewrap it. */}
      <div
        ref={boxRef}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto [scrollbar-gutter:stable]"
        data-testid="slide-stage-box"
      >
        <div
          ref={contentRef}
          className={isTitleSlide(markdown) ? "my-auto" : ""}
          style={{ zoom: fit }}
          data-slide-fit={fit}
        >
          {render(markdown)}
        </div>
      </div>
    </div>
  );
}

/** Zooms tried when fitting a slide: hundredths from 1 down to `MIN_FIT`. */
const FIT_STEPS = Math.round((1 - MIN_FIT) * 100);

/**
 * The largest zoom (in hundredths, down to `MIN_FIT`) at which the content's height fits the box,
 * found by trying zooms on the content, which is left at the result. Each fit is searched afresh,
 * so the same content in the same box always gets the same zoom. Refitting from the zoom it had
 * swung between two sizes for ever when one size rewrapped a line or gave a code block a
 * scrollbar and the other did not. Null while the slide is not laid out (a hidden view).
 */
function fitContent(box: HTMLElement, content: HTMLElement): number | null {
  // Drawn sizes: both include the stage's scale and the content's zoom. The box's height doesn't
  // depend on the content's.
  const available = box.getBoundingClientRect().height;
  if (!available) return null;
  const fits = (zoom: number) => {
    content.style.zoom = String(zoom);
    return content.getBoundingClientRect().height <= available + 1;
  };
  const zoom = largestFitting(fits);
  content.style.zoom = String(zoom);
  return zoom;
}

/** The largest of 1, 0.99, ... `MIN_FIT` that `fits`, or `MIN_FIT` when none does (the slide scrolls). */
function largestFitting(fits: (zoom: number) => boolean): number {
  const zoomAt = (step: number) => Math.round(100 - step) / 100;
  if (fits(1)) return 1;
  // Smaller zooms make content shorter, so search for the first step that fits.
  let low = 1;
  let high = FIT_STEPS;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (fits(zoomAt(middle))) high = middle;
    else low = middle + 1;
  }
  return zoomAt(low);
}

/** The width an element gets, kept current as it resizes. */
export function useElementWidth<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [node, setNode] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    if (!node) return;
    setWidth(node.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(node.clientWidth));
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);
  return [setNode, width];
}

/**
 * The deck over the whole screen, one slide at a time, for presenting: the browser goes full screen
 * where it can. A click or the arrow keys, Page Up/Down and swipes move (a right-click goes back),
 * Home and End go to the ends, and Escape, Exit full screen or the back gesture closes it. Notes shows
 * each slide's speaker notes under it; with `narration`, Play (or Space) reads the slides aloud one by
 * one; with `comments`, slides can be commented on.
 */
export function SlidePresenter({
  title,
  slides,
  index,
  onChange,
  render,
  onClose,
  narration,
  comments,
  layout: fixedLayout,
}: {
  title: string;
  slides: readonly Slide[];
  index: number;
  onChange: (index: number) => void;
  render: RenderSlide;
  onClose: () => void;
  narration?: NarratedDeck;
  comments?: DeckComments;
  /** Always this layout, whatever the width (slide pictures read best on the stage). */
  layout?: SlideLayout;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const go = useCallback(
    (next: number) => onChange(Math.max(0, Math.min(slides.length - 1, next))),
    [onChange, slides.length],
  );
  const layout = fixedLayout ?? slideLayoutFor(size.width);
  const [notesShown, toggleNotes] = usePresenterNotes();
  usePreviewSheetHistoryEntry(true, panelRef, onClose);

  useLayoutEffect(() => {
    if (!frame) return;
    const measure = () => setSize({ width: frame.clientWidth, height: frame.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [frame]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // On a page, up and down scroll the page; on the stage they move between slides too.
      const deck = { index, count: slides.length, go, narration, vertical: layout === "stage" };
      if (handleDeckKey(event, deck) || event.defaultPrevented || event.key !== "Escape") return;
      onClose();
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index, layout, narration, onClose, slides.length]);

  useEffect(() => {
    // Full screen hides the browser's own bars; where it isn't offered (iPhone) the window is used.
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) root.requestFullscreen().catch(() => {});
    // Leaving full screen (the browser's own Escape) closes the presenter too.
    const onFullscreenChange = () => {
      if (!document.fullscreenElement) onClose();
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
  }, [onClose]);

  const swipe = useSwipe((step) => go(index + step));
  const clicks = useSlideClicks((step) => go(index + step));
  // Portaled outside its conversation, so it must leave when a kept conversation is hidden.
  const conversationShown = useConversationShown();
  if (!conversationShown) return null;
  const slide = slides[index];
  const stageWidth = Math.min(size.width, (size.height * STAGE_WIDTH) / STAGE_HEIGHT);
  const hasNotes = slides.some((candidate) => candidate.notes);
  const shown = (
    <>
      {/* Measured inside its padding, so the slide keeps a margin from the screen's edges. */}
      <div className="flex min-h-0 flex-1 px-2 py-1 sm:px-6 sm:py-2" {...swipe} {...clicks}>
        <div ref={setFrame} className="flex min-w-0 flex-1 items-center justify-center">
          {slide && size.width > 0 && (
            <SlideView
              key={index}
              slide={slide}
              layout={layout}
              width={layout === "stage" ? stageWidth : size.width}
              height={size.height}
              render={render}
            />
          )}
        </div>
      </div>
      {notesShown && slide?.notes && (
        <SlideNotes
          notes={slide.notes}
          render={render}
          className="mx-auto mt-2 max-h-[35%] w-full max-w-[1100px] shrink-0 overflow-y-auto border-t border-cc-border px-4 pt-2 sm:px-8"
        />
      )}
    </>
  );
  return createPortal(
    <div
      ref={panelRef}
      className="fixed inset-0 z-50 flex flex-col bg-cc-bg"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="slide-presenter"
    >
      <div className="truncate px-3 py-1.5 text-center text-[13px] text-cc-muted" data-copy-exclude="">
        {title}
      </div>
      {comments ? (
        // Text selected here is commented on like the deck in the conversation, naming its slide.
        <SelectableMessage
          sessionId={comments.sessionId}
          messageId={comments.messageId}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div
            className="flex min-h-0 flex-1 flex-col"
            data-markdown-report-source={JSON.stringify(comments.source)}
            {...(slide ? slideCommentAttributes(slide, index) : {})}
          >
            {shown}
          </div>
        </SelectableMessage>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">{shown}</div>
      )}
      {narration && <NarrationProgress messageId={narration.messageId} />}
      <DeckToolbar
        slides={slides}
        index={index}
        onChange={go}
        narration={narration}
        comments={comments}
        notes={hasNotes ? { shown: notesShown, onToggle: toggleNotes } : undefined}
        fullScreen={{ active: true, onToggle: onClose }}
        className="px-2 py-1.5"
      />
    </div>,
    document.body,
  );
}

/** Touch handlers calling `onStep(1)` for a swipe to the left and `onStep(-1)` for one to the right. */
export function useSwipe(onStep: (step: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (event: React.TouchEvent) => {
      const touch = event.touches[0];
      start.current = event.touches.length === 1 && touch ? { x: touch.clientX, y: touch.clientY } : null;
    },
    onTouchEnd: (event: React.TouchEvent) => {
      const from = start.current;
      const touch = event.changedTouches[0];
      start.current = null;
      if (!from || !touch) return;
      const dx = touch.clientX - from.x;
      const dy = touch.clientY - from.y;
      // Mostly sideways, so scrolling a long page or a wide code block doesn't change slides.
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) onStep(dx < 0 ? 1 : -1);
    },
  };
}
