/** Server/frontend shared built-in transcription model catalog. */
export const GPT_TRANSCRIBE_STT_MODEL = "gpt-transcribe";

export const TRANSCRIPTION_STT_MODELS = [
  GPT_TRANSCRIBE_STT_MODEL,
  "gpt-4o-mini-transcribe",
  "gpt-4o-transcribe",
  "gpt-4o-mini-transcribe-2025-12-15",
] as const;

export const DEFAULT_TRANSCRIPTION_STT_MODEL = GPT_TRANSCRIBE_STT_MODEL;
export type BuiltInTranscriptionSttModel = (typeof TRANSCRIPTION_STT_MODELS)[number];
