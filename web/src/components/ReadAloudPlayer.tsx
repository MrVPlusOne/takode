import {
  READ_ALOUD_PLAYBACK_RATES,
  READ_ALOUD_PLAYER_VOICES,
  seekReadAloud,
  setReadAloudPlaybackRate,
  setReadAloudVoice,
  skipReadAloud,
  stopReadAloud,
  toggleReadAloudPause,
  useCurrentReadAloud,
  useReadAloudPlayback,
  useReadAloudPreferences,
  type ReadAloudState,
  type ReadAloudVoice,
} from "../read-aloud-player.js";

/**
 * The Read aloud player, shown under the message being read: seek bar, voice,
 * back and forward 5 seconds, play/pause, speed and close.
 */
export function ReadAloudPlayer({ messageId }: { messageId: string }) {
  const read = useCurrentReadAloud();
  // A failed read shows its error beside the message options button instead.
  if (!read || read.status === "error" || read.messageId !== messageId) return null;
  return (
    <div className="mt-2 rounded-xl border border-cc-border bg-cc-card px-3 py-2" data-testid="read-aloud-player">
      <ReadAloudPlayerHeader read={read} />
      <ReadAloudControls read={read} />
    </div>
  );
}

function ReadAloudPlayerHeader({ read }: { read: ReadAloudState }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <SpeakerIcon />
      <span className="min-w-0 flex-1 truncate text-cc-muted">{statusText(read)}</span>
      <CloseButton />
    </div>
  );
}

/** Seek bar, then voice, back 5 s, play/pause, forward 5 s and speed. */
function ReadAloudControls({ read }: { read: ReadAloudState }) {
  const playback = useReadAloudPlayback();
  const preferences = useReadAloudPreferences();
  const ready = read.status === "ready";
  return (
    <div className="mt-1.5 space-y-1.5">
      <div className="flex items-center gap-2 text-[11px] tabular-nums text-cc-muted">
        <span className="w-9 text-right">{formatTime(playback.currentTime)}</span>
        <input
          type="range"
          min={0}
          max={playback.duration || 0}
          step={0.1}
          value={playback.currentTime}
          disabled={!ready}
          onChange={(event) => seekReadAloud(Number(event.target.value))}
          aria-label="Position"
          className="h-6 min-w-0 flex-1 accent-[var(--color-cc-primary)]"
        />
        <span className="w-9">{formatTime(playback.duration)}</span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <select
          value={preferences.voice}
          onChange={(event) => setReadAloudVoice(event.target.value as ReadAloudVoice)}
          aria-label="Voice"
          className="h-9 w-24 rounded-lg border border-cc-border bg-cc-input-bg px-2 text-sm text-cc-fg"
        >
          {READ_ALOUD_PLAYER_VOICES.map((voice) => (
            <option key={voice} value={voice}>
              {voiceLabel(voice)}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-1">
          <SkipButton direction={-1} disabled={!ready} />
          <PlayPauseButton read={read} paused={playback.paused} />
          <SkipButton direction={1} disabled={!ready} />
        </div>
        <select
          value={preferences.playbackRate}
          onChange={(event) => setReadAloudPlaybackRate(Number(event.target.value))}
          aria-label="Playback speed"
          className="h-9 w-24 rounded-lg border border-cc-border bg-cc-input-bg px-2 text-sm text-cc-fg"
        >
          {READ_ALOUD_PLAYBACK_RATES.map((rate) => (
            <option key={rate} value={rate}>
              {formatRate(rate)}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function PlayPauseButton({ read, paused }: { read: ReadAloudState; paused: boolean }) {
  const preparing = read.status === "preparing";
  return (
    <button
      type="button"
      onClick={toggleReadAloudPause}
      aria-busy={preparing || undefined}
      aria-label={preparing ? "Preparing audio" : paused ? "Play" : "Pause"}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-cc-primary text-white"
    >
      {paused || preparing ? (
        <svg viewBox="0 0 16 16" fill="currentColor" className="h-5 w-5">
          <path d="M5 3.2v9.6a.6.6 0 00.9.5l7.4-4.8a.6.6 0 000-1L5.9 2.7a.6.6 0 00-.9.5z" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" fill="currentColor" className="h-5 w-5">
          <rect x="4" y="3" width="3" height="10" rx="0.8" />
          <rect x="9" y="3" width="3" height="10" rx="0.8" />
        </svg>
      )}
    </button>
  );
}

function SkipButton({ direction, disabled }: { direction: -1 | 1; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={() => skipReadAloud(direction)}
      disabled={disabled}
      aria-label={direction < 0 ? "Back 5 seconds" : "Forward 5 seconds"}
      className="inline-flex h-10 w-10 items-center justify-center rounded-full text-cc-fg hover:bg-cc-hover disabled:opacity-40"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-6 w-6">
        {direction < 0 ? (
          <path d="M4.5 12a7.5 7.5 0 107.5-7.5H9m0 0l2.5-2.5M9 4.5L11.5 7" strokeLinecap="round" />
        ) : (
          <path d="M19.5 12A7.5 7.5 0 1112 4.5h3m0 0l-2.5-2.5M15 4.5L12.5 7" strokeLinecap="round" />
        )}
        <text x="12" y="15.5" textAnchor="middle" fontSize="7" fill="currentColor" stroke="none">
          5
        </text>
      </svg>
    </button>
  );
}

function CloseButton() {
  return (
    <button
      type="button"
      onClick={stopReadAloud}
      aria-label="Stop reading aloud"
      className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-cc-muted hover:bg-cc-hover hover:text-cc-fg"
    >
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" className="h-3.5 w-3.5">
        <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
      </svg>
    </button>
  );
}

function SpeakerIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      className="h-3.5 w-3.5 text-cc-primary"
    >
      <path d="M2.5 6h2.5l3.5-3v10l-3.5-3H2.5z" strokeLinejoin="round" />
      <path d="M11 5.5a3.5 3.5 0 010 5M12.8 3.5a6 6 0 010 9" strokeLinecap="round" />
    </svg>
  );
}

function statusText(read: ReadAloudState): string {
  return read.status === "preparing" ? "Preparing audio…" : "Reading aloud";
}

function voiceLabel(voice: string): string {
  return voice.charAt(0).toUpperCase() + voice.slice(1);
}

function formatRate(rate: number): string {
  return `${rate}×`;
}

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
