/**
 * Plain-text tag that voice transcription adds to the composer message. It stays part of
 * the message the agent reads (and the user can delete it before sending), so agents know
 * the text was dictated and may contain transcription errors.
 */
export const TRANSCRIPTION_TAG = "[transcribed]";

/** Appends the transcription tag to `text` unless the text already carries it. */
export function addTranscriptionTag(text: string): string {
  if (text.includes(TRANSCRIPTION_TAG)) return text;
  return `${text.trimEnd()} ${TRANSCRIPTION_TAG}`;
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
