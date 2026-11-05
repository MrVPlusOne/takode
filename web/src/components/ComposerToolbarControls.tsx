import { useEffect, useState } from "react";
import { toggleVoiceback, useVoiceback } from "../voiceback.js";
import type { VoiceLevelSample } from "./composer-voice-types.js";
import { VoiceLevelWaveform } from "./VoiceRecordingStatus.js";

export function formatRecordingElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * While recording, takes over the left side of the composer's button row: cancel, the running
 * time and the input level. Cancel sits next to the mic so a thumb reaches it; the time counts
 * once the mic has opened.
 */
export function ComposerRecordingBar({
  preparing = false,
  currentLevel,
  samples,
  onCancel,
}: {
  /** The mic is still opening; cancel already works, and the time starts once audio flows. */
  preparing?: boolean;
  currentLevel: number;
  samples: VoiceLevelSample[];
  onCancel: () => void;
}) {
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    if (preparing) return;
    // Count from when audio starts flowing, not from the tap.
    const start = Date.now();
    setStartedAt(start);
    setNow(start);
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [preparing]);
  const elapsed = formatRecordingElapsed(Math.max(0, Math.floor((now - startedAt) / 1000)));

  return (
    <div data-testid="composer-recording-bar" className="flex min-w-0 items-center gap-2 text-[13px]">
      <button
        type="button"
        onClick={onCancel}
        aria-label="Cancel recording"
        title="Cancel recording (Esc)"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg cursor-pointer sm:h-8 sm:w-8"
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-4 w-4">
          <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
        </svg>
      </button>
      {preparing ? (
        <span data-testid="voice-preparing" role="status" className="flex min-w-0 items-center gap-1.5 text-cc-warning">
          <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-cc-warning" />
          <span className="truncate">Preparing mic…</span>
        </span>
      ) : (
        <>
          <span
            data-testid="voice-recording-elapsed"
            className="flex shrink-0 items-center gap-1.5 text-cc-primary tabular-nums"
            aria-label={`Recording, ${elapsed}`}
          >
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-cc-primary" />
            {elapsed}
          </span>
          {/* In a narrow composer (or with Stop showing) the meter gives way first, clipping its oldest
          bars on the left so the current level stays visible. */}
          <div className="flex min-w-0 shrink justify-end overflow-hidden">
            <VoiceLevelWaveform currentLevel={currentLevel} samples={samples} />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Turns voiceback on or off on this device (voiceback.ts): new final messages of the session on
 * screen are read aloud as they arrive, in every session until it is turned off.
 */
export function ComposerVoicebackButton() {
  const voiceback = useVoiceback();
  return (
    <VoicebackButton
      on={!!voiceback}
      waiting={voiceback?.waiting ?? 0}
      ready={voiceback?.ready ?? true}
      onToggle={toggleVoiceback}
    />
  );
}

/** The voiceback toggle: lit while on, with how many replies wait to be read after the current one. */
export function VoicebackButton({
  on,
  waiting,
  ready = true,
  onToggle,
}: {
  on: boolean;
  waiting: number;
  /** False after a reload until a first tap lets audio play. */
  ready?: boolean;
  onToggle: () => void;
}) {
  const title = !on
    ? "Voiceback: read new replies aloud as they arrive, in every session, and keep the screen awake"
    : ready
      ? "Voiceback is on: new replies are read aloud as they arrive, and the screen stays awake. Tap to turn off."
      : "Voiceback is on: tap anywhere to let replies play after the reload. Tap here to turn off.";
  return (
    <button
      type="button"
      onClick={onToggle}
      data-testid="composer-voiceback-button"
      aria-pressed={on}
      aria-label={on ? "Turn off voiceback" : "Turn on voiceback"}
      title={title}
      className={`inline-flex h-11 min-w-11 items-center justify-center gap-1.5 rounded-lg px-2 text-[11px] font-medium transition-colors cursor-pointer sm:h-8 sm:min-w-8 ${
        on
          ? `border border-cc-primary/60 bg-cc-primary/10 text-cc-primary hover:bg-cc-primary/20 ${ready ? "" : "border-dashed"}`
          : "text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
      }`}
    >
      <svg
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        className="h-5 w-5 sm:h-4 sm:w-4"
        aria-hidden="true"
      >
        <path d="M2.5 10V8a5.5 5.5 0 0111 0v2" strokeLinecap="round" />
        <rect x="2" y="9.5" width="3" height="4.5" rx="1" />
        <rect x="11" y="9.5" width="3" height="4.5" rx="1" />
      </svg>
      <span className="hidden sm:inline">Voiceback</span>
      {waiting > 0 && (
        <span
          data-testid="composer-voiceback-waiting"
          className="rounded border border-cc-primary/40 bg-cc-card/70 px-1.5 py-0.5 font-mono-code text-[10px]"
        >
          {waiting}
        </span>
      )}
    </button>
  );
}

/** Undo and redo for the draft; phones and tablets only, since keyboards already have shortcuts. */
export function ComposerUndoRedoButtons({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const buttonClass = (enabled: boolean) =>
    `flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${
      enabled ? "text-cc-muted hover:bg-cc-hover hover:text-cc-fg cursor-pointer" : "text-cc-muted opacity-30"
    }`;
  return (
    <div data-testid="composer-undo-redo" className="hidden items-center pointer-coarse:flex">
      <button
        type="button"
        // Keep the keyboard open: a button press must not take focus from the textarea.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onUndo}
        disabled={!canUndo}
        aria-label="Undo last change"
        title="Undo"
        className={buttonClass(canUndo)}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
          <path d="M5.5 3.5L2.5 6.5l3 3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M2.5 6.5H10a3.5 3.5 0 010 7H7" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onRedo}
        disabled={!canRedo}
        aria-label="Redo change"
        title="Redo"
        className={buttonClass(canRedo)}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-5 w-5">
          <path d="M10.5 3.5l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M13.5 6.5H6a3.5 3.5 0 000 7h3" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
