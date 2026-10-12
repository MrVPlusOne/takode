/**
 * Plain-text tag that voice transcription adds to the composer message. It stays part of
 * the message the agent reads (and the user can delete it before sending), so agents know
 * the text was dictated and may contain transcription errors.
 */
export const TRANSCRIPTION_TAG = "[transcribed]";

/**
 * Ends `text` with exactly one transcription tag. A tag left from an earlier dictation is
 * removed first, so appending after it leaves no tag between the two passages.
 */
export function addTranscriptionTag(text: string): string {
  const parts = text.split(TRANSCRIPTION_TAG);
  const untagged = parts
    .map((part, index) => {
      const next = parts[index + 1];
      // Drop the space before a removed tag only when whitespace or the end follows the tag;
      // text joined straight onto the tag keeps that space as its separator.
      return next !== undefined && /^(\s|$)/.test(next) ? part.replace(/[ \t]+$/, "") : part;
    })
    .join("");
  return `${untagged.trimEnd()} ${TRANSCRIPTION_TAG}`;
}

/**
 * Separates a trailing transcription tag from message text so the feed can show it as a
 * small marker instead of prose. A tag anywhere else is ordinary text.
 */
export function splitTrailingTranscriptionTag(text: string): { text: string; transcribed: boolean } {
  const trimmed = text.trimEnd();
  if (!trimmed.endsWith(TRANSCRIPTION_TAG)) return { text, transcribed: false };
  return { text: trimmed.slice(0, -TRANSCRIPTION_TAG.length).trimEnd(), transcribed: true };
}
