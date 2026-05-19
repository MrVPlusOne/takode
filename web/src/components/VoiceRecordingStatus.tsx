import type { ReactNode } from "react";
import type { VoiceLevelSample } from "./composer-voice-types.js";

const VOICE_HISTORY_BAR_COUNT = 40;
const VOICE_LEVEL_CLIPPING_THRESHOLD = 0.95;

export function VoiceRecordingStatus({
  currentLevel,
  samples,
  prefix,
  className = "",
  waveformClassName = "",
  testId = "voice-recording-status",
}: {
  currentLevel: number;
  samples: VoiceLevelSample[];
  prefix?: ReactNode;
  className?: string;
  waveformClassName?: string;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className={`flex min-w-0 items-center gap-2 text-[11px] text-cc-primary ${className}`}>
      {prefix}
      <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-cc-primary" />
      <span className="shrink-0 font-medium">Recording</span>
      <VoiceLevelWaveform currentLevel={currentLevel} samples={samples} className={waveformClassName} />
    </div>
  );
}

export function VoiceLevelWaveform({
  currentLevel,
  samples,
  className = "",
}: {
  currentLevel: number;
  samples: VoiceLevelSample[];
  className?: string;
}) {
  const visibleSamples = samples.slice(-(VOICE_HISTORY_BAR_COUNT - 1));
  const paddedSamples = [
    ...Array.from({ length: Math.max(0, VOICE_HISTORY_BAR_COUNT - 1 - visibleSamples.length) }, () => ({
      kind: "empty" as const,
      level: 0,
      key: "empty",
    })),
    ...visibleSamples.map((sample) => ({
      kind: "history" as const,
      level: clampVoiceLevel(sample.level),
      key: sample.time,
    })),
    { kind: "current" as const, level: clampVoiceLevel(currentLevel), key: "current" },
  ];

  return (
    <div
      data-testid="voice-level-waveform"
      role="img"
      aria-label="Current and recent input level"
      title="Current and recent input level"
      className={`relative flex h-4 w-[72px] shrink-0 items-center gap-[1px] overflow-hidden rounded-[3px] border border-cc-primary/20 bg-cc-primary/5 px-[2px] py-[2px] sm:w-[112px] ${className}`}
    >
      {paddedSamples.map((sample, index) => {
        const level = sample.level;
        const isClipping = level >= VOICE_LEVEL_CLIPPING_THRESHOLD;
        return (
          <span
            key={`${sample.key}-${index}`}
            data-current-sample={sample.kind === "current" ? "true" : undefined}
            data-clipping={isClipping ? "true" : undefined}
            data-testid="voice-level-waveform-bar"
            className="relative z-10 min-w-0 flex-1 rounded-full transition-[height,opacity] duration-75"
            style={{
              height: `${Math.max(2, Math.round(2 + level * 12))}px`,
              opacity: sample.kind === "empty" ? 0.12 : Math.max(0.28, 0.38 + level * 0.62),
              backgroundColor: isClipping ? "rgb(252 129 129)" : "rgb(174 86 48)",
            }}
          />
        );
      })}
      <span className="pointer-events-none absolute left-[2px] right-[2px] top-1/2 h-px -translate-y-1/2 bg-cc-primary/20" />
    </div>
  );
}

function clampVoiceLevel(level: number): number {
  return Math.min(1, Math.max(0, level));
}
