import { useEffect, useState } from "react";
import type { VoiceLevelSample } from "./composer-voice-types.js";
import { VoiceLevelWaveform } from "./VoiceRecordingStatus.js";

export function formatRecordingElapsed(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * While recording, takes over the left side of the composer's button row: cancel, the running
 * time and the input level. Cancel sits next to the mic so a thumb reaches it; the time counts
 * from when this bar appears, which is when recording starts.
 */
export function ComposerRecordingBar({
  currentLevel,
  samples,
  onCancel,
}: {
  currentLevel: number;
  samples: VoiceLevelSample[];
  onCancel: () => void;
}) {
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);
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
    </div>
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
