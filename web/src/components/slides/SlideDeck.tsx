import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { Slide } from "../../../shared/slides.js";
import { useConversationShown } from "../KeptConversationViews.js";
import { usePreviewSheetHistoryEntry } from "../quest-preview-sheet-history.js";

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

/** A title slide (one led by a top-level heading) sits in the middle of the stage; others start at its top. */
export function isTitleSlide(markdown: string): boolean {
  return /^#[ \t]/.test(markdown.trimStart());
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
  useEffect(() => {
    const box = boxRef.current;
    const content = contentRef.current;
    if (!box || !content || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      // Drawn sizes: both include the stage's scale and the content's current zoom.
      const available = box.getBoundingClientRect().height;
      const needed = content.getBoundingClientRect().height;
      if (!available || !needed) return;
      // Grows back too: a visual's placeholder can be taller than the visual it becomes.
      setFit((current) => {
        if (current === 1 && needed <= available + 1) return current;
        const next = Math.max(MIN_FIT, Math.min(1, (current * available) / needed));
        return Math.abs(next - current) < 0.01 ? current : next;
      });
    };
    measure();
    // Images and visuals arrive after the first render and make the slide taller.
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="flex h-full flex-col px-[72px] py-[52px]">
      <div ref={boxRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto" data-testid="slide-stage-box">
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

/** Previous and next buttons around the slide picker ("3 / 17", which lists the slides' titles). */
export function SlideNav({
  slides,
  index,
  onChange,
  className = "",
}: {
  slides: readonly Slide[];
  index: number;
  onChange: (index: number) => void;
  className?: string;
}) {
  const button =
    "inline-flex h-8 w-8 items-center justify-center rounded-md text-cc-muted hover:bg-cc-hover hover:text-cc-fg disabled:opacity-30 disabled:hover:bg-transparent pointer-coarse:h-10 pointer-coarse:w-10";
  return (
    <div className={`flex items-center justify-center gap-1 ${className}`} data-copy-exclude="">
      <button
        type="button"
        className={button}
        disabled={index === 0}
        onClick={() => onChange(index - 1)}
        aria-label="Previous slide"
        title="Previous slide"
      >
        <Chevron direction="left" />
      </button>
      <label className="relative inline-flex items-center rounded-md px-2 py-1 text-[13px] tabular-nums text-cc-muted hover:bg-cc-hover hover:text-cc-fg">
        <span>
          {index + 1} / {slides.length}
        </span>
        {/* A native list: the phone's own picker on touch screens. */}
        <select
          value={index}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-label="Go to slide"
          className="absolute inset-0 cursor-pointer opacity-0"
        >
          {slides.map((slide, position) => (
            <option key={position} value={position}>
              {position + 1}. {slide.title || `Slide ${position + 1}`}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={button}
        disabled={index === slides.length - 1}
        onClick={() => onChange(index + 1)}
        aria-label="Next slide"
        title="Next slide"
      >
        <Chevron direction="right" />
      </button>
    </div>
  );
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
 * where it can; arrow keys, Space and Page Up/Down move, Home and End go to the ends, swiping moves
 * on touch screens, and Escape, Close or the back gesture closes it.
 */
export function SlidePresenter({
  title,
  slides,
  index,
  onChange,
  render,
  onClose,
}: {
  title: string;
  slides: readonly Slide[];
  index: number;
  onChange: (index: number) => void;
  render: RenderSlide;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const go = useCallback(
    (next: number) => onChange(Math.max(0, Math.min(slides.length - 1, next))),
    [onChange, slides.length],
  );
  const layout = slideLayoutFor(size.width);
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
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if ((event.target as HTMLElement | null)?.closest?.("select, input, textarea")) return;
      // On a page, up and down scroll the page; on the stage they move between slides too.
      const vertical = layout === "stage";
      const forward = ["ArrowRight", "PageDown", " "].includes(event.key) || (vertical && event.key === "ArrowDown");
      const back = ["ArrowLeft", "PageUp"].includes(event.key) || (vertical && event.key === "ArrowUp");
      if (forward || back) go(index + (forward ? 1 : -1));
      else if (event.key === "Home") go(0);
      else if (event.key === "End") go(slides.length - 1);
      else if (event.key === "Escape") onClose();
      else return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, index, layout, onClose, slides.length]);

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
  // Portaled outside its conversation, so it must leave when a kept conversation is hidden.
  const conversationShown = useConversationShown();
  if (!conversationShown) return null;
  const slide = slides[index];
  const stageWidth = Math.min(size.width, (size.height * STAGE_WIDTH) / STAGE_HEIGHT);
  return createPortal(
    <div
      ref={panelRef}
      className="fixed inset-0 z-50 flex flex-col bg-cc-bg"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="slide-presenter"
    >
      <div className="flex items-center gap-2 px-3 py-1.5 text-[13px] text-cc-muted" data-copy-exclude="">
        <span className="min-w-0 flex-1 truncate">{title}</span>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2.5 py-1 text-[13px] text-cc-muted hover:bg-cc-hover hover:text-cc-fg pointer-coarse:min-h-9"
        >
          Close
        </button>
      </div>
      <div ref={setFrame} className="flex min-h-0 flex-1 items-center justify-center px-2 sm:px-6" {...swipe}>
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
      <SlideNav slides={slides} index={index} onChange={go} className="py-1.5" />
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

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4" aria-hidden="true">
      <path
        d={direction === "left" ? "M10 3.5L5.5 8l4.5 4.5" : "M6 3.5L10.5 8 6 12.5"}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The icon of the Present button: a screen with a play mark. */
export function PresentIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className={className}
      aria-hidden="true"
    >
      <rect x="1.75" y="2.5" width="12.5" height="8.5" rx="1.2" />
      <path d="M8 11v2.5M5.5 13.75h5M6.75 5.25l2.5 1.5-2.5 1.5z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
