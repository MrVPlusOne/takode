/**
 * Voice transcription results the server keeps until a browser puts them into their draft.
 *
 * A dictation's text belongs in the draft it was recorded for (the session's composer or one
 * needs-input answer). The browser that recorded it normally applies it, but it may have moved
 * to another session, been reloaded or been suspended by the phone by the time the result is
 * ready. So the server keeps each finished result with its target until one browser claims it:
 * claiming is atomic, so exactly one browser applies a result, and drafts are synced, so it
 * reaches every browser from there.
 */

/** Which draft the text goes into: the composer, one needs-input question, or one guided review answer. */
export type VoiceResultDestination =
  | { kind: "composer" }
  | { kind: "needs-input"; notificationId: string; questionKey: string }
  | { kind: "guided-review"; reviewId: string; stopKey: string };

/** Where the text goes, and the draft text it was recorded against. */
export type VoiceResultTarget = VoiceResultDestination & {
  /** The draft's text when recording started, and the selection the text replaces in it. */
  baseText: string;
  selectionStart: number;
  selectionEnd: number;
};

export interface PendingVoiceResult {
  requestId: string;
  target: VoiceResultTarget;
  mode: "dictation" | "append" | "edit";
  /** The transcript to insert; for a voice edit, the whole edited composer text. */
  text: string;
  /** For a voice edit: the spoken instruction. */
  instructionText?: string;
  createdAt: number;
}

/** Older results are dropped: by then the user has long moved on. */
export const PENDING_VOICE_RESULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const MAX_PENDING_VOICE_RESULTS = 20;
const MAX_TARGET_TEXT_CHARS = 200_000;
const MAX_ID_CHARS = 200;

/** Validates a target sent by a browser; throws on a malformed one. */
export function readVoiceResultTarget(value: unknown): VoiceResultTarget | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const target = typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!target || typeof target !== "object") throw new Error("Invalid voice result target.");
  const { kind, baseText, selectionStart, selectionEnd, notificationId, questionKey, reviewId, stopKey } =
    target as Record<string, unknown>;
  if (typeof baseText !== "string" || baseText.length > MAX_TARGET_TEXT_CHARS)
    throw new Error("Invalid voice result target text.");
  const start = readOffset(selectionStart, baseText.length);
  const end = readOffset(selectionEnd, baseText.length);
  if (end < start) throw new Error("Invalid voice result target selection.");
  const base = { baseText, selectionStart: start, selectionEnd: end };
  if (kind === "composer") return { kind, ...base };
  if (kind === "needs-input" && isShortId(notificationId) && isShortId(questionKey)) {
    return { kind, notificationId, questionKey, ...base };
  }
  if (kind === "guided-review" && isShortId(reviewId) && typeof stopKey === "string" && /^\d{1,3}$/.test(stopKey)) {
    return { kind, reviewId, stopKey, ...base };
  }
  throw new Error("Invalid voice result target.");
}

/**
 * The draft text after inserting `text`: in place of the recorded selection when the draft is
 * unchanged since recording started, otherwise at its end, so text typed meanwhile is kept.
 * The composer separates the insertion from preceding text with a space; answers do not.
 */
export function mergeVoiceText(current: string, target: VoiceResultTarget, text: string): string {
  const unchanged = current === target.baseText;
  const before = unchanged ? current.slice(0, target.selectionStart) : current;
  const after = unchanged ? current.slice(target.selectionEnd) : "";
  const separator = target.kind === "composer" && before && !/\s$/.test(before) ? " " : "";
  return before + separator + text + after;
}

function readOffset(value: unknown, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max)
    throw new Error("Invalid voice result target selection.");
  return value;
}

function isShortId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_CHARS;
}
