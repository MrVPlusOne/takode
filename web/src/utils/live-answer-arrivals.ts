/**
 * Browser-local record of assistant messages that arrived over the live
 * socket, used to decide whether the feed's paw marker should play its
 * landing animation. History windows, recovery snapshots and reconnect replay
 * never record arrivals, so loading or re-rendering history cannot animate.
 */

// Arrivals are rarely claimed (only the newest answer's paw asks), so keep a
// small insertion-ordered window instead of every message of a long session.
const MAX_TRACKED_ARRIVALS = 200;

// A counter rather than a clock, so "arrived after the view opened" is exact.
let arrivalCount = 0;
const arrivals = new Map<string, number>();

/** Note that an assistant message arrived live. */
export function recordLiveAnswerArrival(messageId: string): void {
  arrivals.delete(messageId);
  arrivals.set(messageId, ++arrivalCount);
  if (arrivals.size > MAX_TRACKED_ARRIVALS) {
    const oldest = arrivals.keys().next().value;
    if (oldest !== undefined) arrivals.delete(oldest);
  }
}

/** A mark for "now"; answers recorded later count as arriving after it. */
export function liveAnswerArrivalMark(): number {
  return arrivalCount;
}

/**
 * Whether the paw for `messageId` should land now: true at most once per
 * arrival, and only when the message arrived after `viewOpenedMark` (from
 * `liveAnswerArrivalMark`). Claiming consumes the arrival either way, so
 * remounts, window slides and thread switches never replay the animation.
 */
export function claimPawLanding(messageId: string, viewOpenedMark: number): boolean {
  const arrival = arrivals.get(messageId);
  if (arrival === undefined) return false;
  arrivals.delete(messageId);
  return arrival > viewOpenedMark;
}

export function _resetLiveAnswerArrivalsForTest(): void {
  arrivals.clear();
}
