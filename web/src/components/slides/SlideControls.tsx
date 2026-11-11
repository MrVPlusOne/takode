import { useRef, useState } from "react";
import type { MarkdownReportSource } from "../../../shared/markdown-report.js";
import type { Slide } from "../../../shared/slides.js";
import {
  READ_ALOUD_PLAYBACK_RATES,
  getReadAloudState,
  playDeck,
  setReadAloudPlaybackRate,
  stopReadAloud,
  toggleReadAloudPause,
  useReadAloudPlayback,
  useReadAloudPreferences,
  useReadAloudState,
  type NarratedDeck,
} from "../../read-aloud-player.js";
import { useStore } from "../../store.js";
import { useComposerTarget } from "../composer-target.js";
import type { RenderSlide } from "./SlideDeck.js";
import { setLocalStorageItem } from "../../utils/scoped-storage.js";
import { Spinner } from "../LoadingIndicators.js";

/** The conversation message a deck is, which its narration and its comments belong to. */
export interface DeckMessage {
  sessionId: string;
  messageId: string;
  historyIndex?: number;
}

/** Where comments on a deck go: the session showing it, and the report it is. */
export interface DeckComments {
  sessionId: string;
  messageId: string;
  source: MarkdownReportSource;
}

/** The deck as the read-aloud player plays it: each slide says its notes, or its own text when it has none. */
export function narratedDeck(message: DeckMessage, title: string, slides: readonly Slide[]): NarratedDeck {
  return {
    ...message,
    title,
    slides: slides.map((slide) => ({ narration: slide.notes || slide.markdown, shown: slide.markdown })),
  };
}

/** The attribute that tells a comment made in a slide (or its notes) which slide it is on. */
export function slideCommentAttributes(slide: Slide, index: number) {
  return { "data-annotation-slide": JSON.stringify({ number: index + 1, title: slide.title }) };
}

/** A slide's speaker notes: what is said over it, below the slide at reading size. */
export function SlideNotes({
  notes,
  render,
  className = "",
}: {
  notes: string;
  render: RenderSlide;
  className?: string;
}) {
  return (
    <div className={`min-w-0 text-[13.5px] ${className}`} data-testid="slide-notes">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-cc-muted" data-copy-exclude="">
        Notes
      </div>
      {render(notes)}
    </div>
  );
}

/** Whether Present shows each slide's notes, remembered by this browser; off by default, as for an audience. */
export function usePresenterNotes(): [boolean, () => void] {
  const [shown, setShown] = useState(() => localStorage.getItem(NOTES_KEY) === "1");
  const toggle = () => {
    setShown((current) => {
      setLocalStorageItem(NOTES_KEY, current ? "0" : "1");
      return !current;
    });
  };
  return [shown, toggle];
}
const NOTES_KEY = "cc-slide-presenter-notes";

/**
 * The deck's controls, under the slide in the card and in full screen: one group in the middle, so
 * nothing sits far out in a corner. Playback (speed, Play) is left of ‹ n / N ›, and the view
 * (notes, comment, full screen) right of it. The counter stays centered and no control appears or
 * disappears when playing starts, so nothing moves under the pointer.
 */
export function DeckToolbar({
  slides,
  index,
  onChange,
  narration,
  comments,
  notes,
  fullScreen,
  className = "",
}: {
  slides: readonly Slide[];
  index: number;
  onChange: (index: number) => void;
  /** The deck as read aloud; without it there is no Play. */
  narration?: NarratedDeck;
  /** Where comments on a slide go; without it there is no comment button. */
  comments?: DeckComments;
  /** Whether notes show under the slide, where they can be turned off. */
  notes?: { shown: boolean; onToggle: () => void };
  fullScreen: { active: boolean; onToggle: () => void };
  className?: string;
}) {
  const slide = slides[index];
  return (
    <div className={`grid grid-cols-[1fr_auto_1fr] items-center gap-x-3 ${className}`} data-copy-exclude="">
      <div className="flex items-center justify-end gap-1">
        {narration && (
          <>
            <SpeedSelect />
            <PlayButton deck={narration} index={index} />
          </>
        )}
      </div>
      <SlideNav slides={slides} index={index} onChange={onChange} />
      <div className="flex items-center gap-1">
        {notes && <NotesToggle shown={notes.shown} onToggle={notes.onToggle} />}
        {comments && slide && <SlideCommentButton comments={comments} slide={slide} index={index} />}
        <FullScreenToggle active={fullScreen.active} onToggle={fullScreen.onToggle} />
      </div>
    </div>
  );
}

/** Previous and next buttons around the slide picker ("3 / 17", which lists the slides' titles). */
export function SlideNav({
  slides,
  index,
  onChange,
}: {
  slides: readonly Slide[];
  index: number;
  onChange: (index: number) => void;
}) {
  return (
    <div className="flex items-center justify-center gap-1">
      <button
        type="button"
        className={`${ICON_BUTTON} disabled:opacity-30 disabled:hover:bg-transparent`}
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
        className={`${ICON_BUTTON} disabled:opacity-30 disabled:hover:bg-transparent`}
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

/** Play the deck from slide `index`, or pause and resume it while it is being read. */
export function toggleDeckPlayback(deck: NarratedDeck, index: number): void {
  const read = getReadAloudState();
  if (read?.messageId === deck.messageId && read.slide && read.status !== "error") toggleReadAloudPause();
  else playDeck(deck, index);
}

/**
 * A deck's keys: arrows, Page Up/Down, Home and End move between slides (up and down too when
 * `vertical`), and Space pauses and resumes the reading, or starts it, when the deck can be read
 * aloud (otherwise it moves on). Takes the key and returns true when it is one of them.
 */
export function handleDeckKey(
  event: Pick<
    KeyboardEvent,
    "key" | "target" | "metaKey" | "ctrlKey" | "altKey" | "defaultPrevented" | "preventDefault"
  >,
  deck: { index: number; count: number; go: (index: number) => void; narration?: NarratedDeck; vertical: boolean },
): boolean {
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return false;
  if ((event.target as HTMLElement | null)?.closest?.("select, input, textarea, [contenteditable]")) return false;
  const { index, count, go, narration, vertical } = deck;
  const key = event.key;
  if (key === " " && narration) toggleDeckPlayback(narration, index);
  else if (["ArrowRight", "PageDown", " "].includes(key) || (vertical && key === "ArrowDown")) go(index + 1);
  else if (["ArrowLeft", "PageUp"].includes(key) || (vertical && key === "ArrowUp")) go(index - 1);
  else if (key === "Home") go(0);
  else if (key === "End") go(count - 1);
  else return false;
  event.preventDefault();
  return true;
}

/** What a click on these leaves alone: links, code, the slide's own controls and visuals. */
const SLIDE_CLICK_EXEMPT =
  'a, button, input, select, textarea, summary, label, pre, code, iframe, [role="button"], [role="link"], [contenteditable]';

/**
 * Handlers that turn slides as presentations do: a click goes to the next slide and a right-click to
 * the previous one (instead of the browser's menu). Touch screens have no right-click, so a tap on the
 * left third goes back. Clicks on links, code and controls, and clicks that end a text selection
 * (for a comment or a copy), are left alone, and so is right-clicking selected text.
 */
export function useSlideClicks(onStep: (step: 1 | -1) => void) {
  const pointer = useRef("mouse");
  return {
    onPointerDown: (event: React.PointerEvent) => {
      pointer.current = event.pointerType;
    },
    onClick: (event: React.MouseEvent<HTMLElement>) => {
      if (event.button !== 0 || event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
      if (!turnsSlide(event)) return;
      const box = event.currentTarget.getBoundingClientRect();
      onStep(pointer.current === "touch" && event.clientX < box.left + box.width / 3 ? -1 : 1);
    },
    onContextMenu: (event: React.MouseEvent<HTMLElement>) => {
      if (!turnsSlide(event)) return;
      event.preventDefault();
      onStep(-1);
    },
  };
}

function turnsSlide(event: React.MouseEvent): boolean {
  if (event.defaultPrevented) return false;
  if ((event.target as Element).closest?.(SLIDE_CLICK_EXEMPT)) return false;
  const selection = window.getSelection();
  return !selection || selection.isCollapsed;
}

/** Play, then pause and resume while the deck is read aloud; the error shows above it when a slide's audio failed. */
function PlayButton({ deck, index }: { deck: NarratedDeck; index: number }) {
  const read = useReadAloudState(deck.messageId);
  const playback = useReadAloudPlayback();
  const playing = read?.slide && read.status !== "error";
  const label = !playing ? "Play: read each slide aloud" : playback.paused ? "Resume" : "Pause";
  return (
    <span className="relative flex">
      <button
        type="button"
        onClick={() => toggleDeckPlayback(deck, index)}
        aria-busy={read?.status === "preparing" || undefined}
        aria-label={label}
        title={`${label} (Space)`}
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-cc-primary text-white hover:opacity-90 pointer-coarse:h-10 pointer-coarse:w-10"
        data-testid="narration-button"
      >
        {playing && read.status === "preparing" ? (
          <Spinner className="h-3.5 w-3.5" />
        ) : playing && !playback.paused ? (
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5" aria-hidden="true">
            <rect x="4" y="3" width="3" height="10" rx="0.8" />
            <rect x="9" y="3" width="3" height="10" rx="0.8" />
          </svg>
        ) : (
          <PlayIcon className="ml-0.5 h-3.5 w-3.5" />
        )}
      </button>
      {read?.status === "error" && (
        <button
          type="button"
          role="alert"
          onClick={stopReadAloud}
          className="absolute bottom-full left-1/2 z-20 mb-1 w-64 max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-md border border-cc-error/40 bg-cc-card px-2.5 py-1.5 text-left text-xs text-cc-error shadow-md"
        >
          {read.error}
        </button>
      )}
    </span>
  );
}

/** The reading speed; kept as the read-aloud preference, so it can be set before playing. */
function SpeedSelect() {
  const preferences = useReadAloudPreferences();
  return (
    <select
      value={preferences.playbackRate}
      onChange={(event) => setReadAloudPlaybackRate(Number(event.target.value))}
      aria-label="Playback speed"
      title="Playback speed"
      className="h-8 cursor-pointer appearance-none rounded-md bg-transparent px-2 text-center text-[12.5px] tabular-nums text-cc-muted hover:bg-cc-hover hover:text-cc-fg pointer-coarse:h-10"
    >
      {READ_ALOUD_PLAYBACK_RATES.map((rate) => (
        <option key={rate} value={rate}>
          {rate}×
        </option>
      ))}
    </select>
  );
}

/** Shows or hides the speaker notes under the slide. */
function NotesToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  const label = shown ? "Hide notes" : "Show notes";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={shown}
      aria-label={label}
      title={label}
      className={`${ICON_BUTTON} ${shown ? "bg-cc-hover text-cc-fg" : ""}`}
      data-testid="slide-notes-toggle"
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path d="M3 3.5h10M3 6.5h10M3 9.5h6.5M3 12.5h4.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/** Opens the deck over the whole screen, or, there, goes back to where it was shown. */
function FullScreenToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  const label = active ? "Exit full screen" : "Full screen";
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={active ? `${label} (Esc)` : label}
      className={ICON_BUTTON}
      data-testid={active ? "exit-full-screen-button" : "present-button"}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path
          d={
            active
              ? "M2 6h3a1 1 0 001-1V2M14 6h-3a1 1 0 01-1-1V2M14 10h-3a1 1 0 00-1 1v3M2 10h3a1 1 0 011 1v3"
              : "M6 2H3.5A1.5 1.5 0 002 3.5V6M10 2h2.5A1.5 1.5 0 0114 3.5V6M14 10v2.5A1.5 1.5 0 0112.5 14H10M6 14H3.5A1.5 1.5 0 012 12.5V10"
          }
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
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

/**
 * Comment on the slide as a whole. The comment names the slide (and the report) for the agent; to
 * comment on part of a slide, select its text as anywhere else.
 */
export function SlideCommentButton({
  comments,
  slide,
  index,
}: {
  comments: DeckComments;
  slide: Slide;
  index: number;
}) {
  const draftKey = useComposerTarget(comments.sessionId);
  const number = index + 1;
  return (
    <button
      type="button"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        useStore.getState().setAnnotationEditor({
          sessionId: comments.sessionId,
          draftKey,
          annotation: {
            id: crypto.randomUUID(),
            selectedText: slide.title || `Slide ${number}`,
            comment: "",
            sourceMessageId: comments.messageId,
            reportSource: comments.source,
            slide: { number, title: slide.title, whole: true },
          },
          position: { x: rect.right - 420, y: rect.bottom + 8 },
        });
      }}
      aria-label={`Comment on slide ${number}`}
      title={`Comment on slide ${number}`}
      className={ICON_BUTTON}
      data-testid="slide-comment-button"
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-4 w-4">
        <path
          d="M2.5 3.75A1.25 1.25 0 013.75 2.5h8.5a1.25 1.25 0 011.25 1.25v6a1.25 1.25 0 01-1.25 1.25H6.5L3.5 13.5v-2.5h0a1 1 0 01-1-1z"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/** How far the slide being read aloud is, as a thin line; nothing when the deck isn't being read. */
export function NarrationProgress({ messageId, className = "" }: { messageId: string; className?: string }) {
  const read = useReadAloudState(messageId);
  const playback = useReadAloudPlayback();
  if (!read?.slide || read.status === "error") return <div className={`h-0.5 ${className}`} />;
  const fraction = playback.duration ? playback.currentTime / playback.duration : 0;
  return (
    <div className={`h-0.5 bg-cc-border ${className}`} data-testid="narration-progress">
      <div className="h-full bg-cc-primary" style={{ width: `${Math.min(100, fraction * 100)}%` }} />
    </div>
  );
}

function PlayIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" className={className} aria-hidden="true">
      <path d="M5 3.2v9.6a.6.6 0 00.9.5l7.4-4.8a.6.6 0 000-1L5.9 2.7a.6.6 0 00-.9.5z" />
    </svg>
  );
}

const ICON_BUTTON =
  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-cc-muted hover:bg-cc-hover hover:text-cc-fg pointer-coarse:h-10 pointer-coarse:w-10";
