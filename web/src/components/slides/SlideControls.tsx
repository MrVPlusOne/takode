import { useState } from "react";
import type { MarkdownReportSource } from "../../../shared/markdown-report.js";
import type { Slide } from "../../../shared/slides.js";
import {
  READ_ALOUD_PLAYBACK_RATES,
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

/** Present's notes toggle. */
export function NotesToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={shown}
      className={`${PILL} ${shown ? "bg-cc-hover text-cc-fg" : ""}`}
      data-testid="slide-notes-toggle"
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" className="h-3.5 w-3.5">
        <path d="M3 3.5h10M3 6.5h10M3 9.5h6.5M3 12.5h4.5" strokeLinecap="round" />
      </svg>
      Notes
    </button>
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

/**
 * The card's Play button: presents the deck and reads it aloud slide by slide (`onPlay` opens
 * Present); the slides turn as each one's audio ends.
 */
export function PlayDeckButton({ deck, index, onPlay }: { deck: NarratedDeck; index: number; onPlay: () => void }) {
  return (
    <button
      type="button"
      onClick={() => {
        playDeck(deck, index);
        onPlay();
      }}
      className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-cc-border px-2 text-[12.5px] text-cc-fg hover:bg-cc-hover pointer-coarse:h-9"
      data-testid="play-deck-button"
    >
      <PlayIcon className="h-3 w-3" />
      Play
    </button>
  );
}

/**
 * Present's narration controls: Play (from the slide shown), then pause/resume and speed while the
 * deck is read aloud, and the error when a slide's audio failed (Play tries again).
 */
export function NarrationControls({ deck, index }: { deck: NarratedDeck; index: number }) {
  const read = useReadAloudState(deck.messageId);
  const playback = useReadAloudPlayback();
  const preferences = useReadAloudPreferences();
  const playing = read?.slide && read.status !== "error";
  return (
    <span className="relative flex items-center gap-1">
      {playing && (
        <select
          value={preferences.playbackRate}
          onChange={(event) => setReadAloudPlaybackRate(Number(event.target.value))}
          aria-label="Playback speed"
          className="h-8 rounded-md border border-cc-border bg-cc-input-bg px-1.5 text-[12.5px] text-cc-fg pointer-coarse:h-10"
        >
          {READ_ALOUD_PLAYBACK_RATES.map((rate) => (
            <option key={rate} value={rate}>
              {rate}×
            </option>
          ))}
        </select>
      )}
      <button
        type="button"
        onClick={() => (playing ? toggleReadAloudPause() : playDeck(deck, index))}
        aria-busy={read?.status === "preparing" || undefined}
        aria-label={!playing ? "Play, reading each slide aloud" : playback.paused ? "Resume" : "Pause"}
        title={!playing ? "Play: read each slide aloud" : undefined}
        className={`${ICON_BUTTON} ${playing ? "text-cc-primary" : ""}`}
        data-testid="narration-button"
      >
        {playing && read.status === "preparing" ? (
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
        ) : playing && !playback.paused ? (
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
            <rect x="4" y="3" width="3" height="10" rx="0.8" />
            <rect x="9" y="3" width="3" height="10" rx="0.8" />
          </svg>
        ) : (
          <PlayIcon className="h-4 w-4" />
        )}
      </button>
      {read?.status === "error" && (
        <button
          type="button"
          role="alert"
          onClick={stopReadAloud}
          className="absolute bottom-full right-0 z-20 mb-1 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-cc-error/40 bg-cc-card px-2.5 py-1.5 text-left text-xs text-cc-error shadow-md"
        >
          {read.error}
        </button>
      )}
    </span>
  );
}

/** How far the slide being read aloud is, as a thin line; nothing when the deck isn't being read. */
export function NarrationProgress({ messageId }: { messageId: string }) {
  const read = useReadAloudState(messageId);
  const playback = useReadAloudPlayback();
  if (!read?.slide || read.status === "error") return <div className="h-0.5" />;
  const fraction = playback.duration ? playback.currentTime / playback.duration : 0;
  return (
    <div className="h-0.5 bg-cc-border" data-testid="narration-progress">
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
const PILL =
  "inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-[12.5px] text-cc-muted hover:bg-cc-hover hover:text-cc-fg pointer-coarse:h-10";
