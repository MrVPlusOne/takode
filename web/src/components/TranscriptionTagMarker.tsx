import { VoiceInputIcon } from "./VoiceInputIcon.js";

/** Compact feed marker shown in place of a trailing `[transcribed]` tag. */
export function TranscriptionTagMarker({ testId }: { testId: string }) {
  return (
    <span
      data-testid={testId}
      title="Dictated with voice transcription"
      className="inline-flex items-center gap-1 text-[11px] text-cc-muted/70"
    >
      <VoiceInputIcon className="h-3 w-3" />
      transcribed
    </span>
  );
}
