/**
 * The input trace: a browser's record of recent input activity, kept only while the user turns
 * it on in Settings > Diagnostics, saved automatically to the server. "Report input glitch"
 * additionally keeps a snapshot in the server log.
 * It never holds typed or pasted text: keys are recorded by name only when they are not plain
 * characters, and text appears only as lengths.
 */

/** How far back the trace reaches. */
export const INPUT_TRACE_WINDOW_MS = 60 * 60 * 1000;
/** The most events the trace keeps; older events go first. */
export const INPUT_TRACE_MAX_EVENTS = 10_000;
/** Small incremental uploads also fit a pagehide keepalive request. */
export const INPUT_TRACE_BATCH_SIZE = 100;
/** The server log component a report is written under (`takode logs --component input-trace`). */
export const INPUT_TRACE_LOG_COMPONENT = "input-trace";

export interface InputTraceEvent {
  /** When it happened, in epoch milliseconds. */
  t: number;
  /**
   * A DOM event type (keydown, keyup, pointerdown, focusin, focusout, beforeinput, input, paste,
   * compositionstart, compositionend), a window change (window-focus, window-blur, page-hidden,
   * page-visible), or a Takode change (composer-expanded, composer-collapsed, draft-sync).
   */
  type: string;
  /** DOM events: distinguishes browser input from a replayed event. */
  trusted?: boolean;
  /**
   * Keys: "Meta+v" or "Enter". A character typed without Cmd or Ctrl is recorded as "char" (or
   * "Alt+char"), so the trace never holds what was typed.
   */
  key?: string;
  /** Keys: an input method (such as Pinyin) was composing text when the key arrived. */
  composing?: boolean;
  /** The element the event was aimed at, such as "textarea.composer" or "div#composer-input-card". */
  target?: string;
  /** The focused element when the event started. */
  active?: string;
  /** Length of the target's text when the event started (after it, for input events). */
  length?: number;
  /** The target's selection, as [start, end] character offsets. */
  selection?: [number, number];
  /** beforeinput and input: the kind of edit, such as "insertFromPaste". */
  inputType?: string;
  /** paste: what the clipboard offered, without its contents. */
  clipboard?: { types: string[]; textLength: number; files: number };
  /**
   * What happened to the event's default action: "default" (left alone), "prevented" (a handler
   * cancelled it) or "stopped" (a handler stopped it before it finished, outcome unknown).
   */
  outcome?: "default" | "prevented" | "stopped";
  /** Draft replacement or composer paste: text lengths before and after. */
  before?: number;
  after?: number;
  /** Which composer or draft a Takode change concerns. */
  detail?: string;
}

export interface InputTraceReport {
  /** When the user reported the glitch, in epoch milliseconds. */
  reportedAt: number;
  /** When the trace started recording in this page, in epoch milliseconds. */
  recordingSince: number;
  userAgent: string;
  platform: string;
  events: InputTraceEvent[];
}

/** A page's numbered events: retries and overlapping pagehide uploads are idempotent. */
export interface SavedInputTraceEvent extends InputTraceEvent {
  seq: number;
}

/** Only newly recorded events are uploaded; each page/recording has its own identity. */
export interface InputTraceBatch {
  traceId: string;
  recordingSince: number;
  userAgent: string;
  platform: string;
  events: SavedInputTraceEvent[];
}

export interface SavedInputTrace extends InputTraceBatch {
  updatedAt: number;
}
