import { useRef } from "react";

/**
 * A brief cue when something new needs the user (Jiayi, Nov 3): a question arrives, or the count of
 * unread answers goes up. Seeing a count is not enough to tell which one just changed. The bell rings
 * (`cc-cue-bell`) and an unread count pops (`cc-cue-pill`), in `index.css`; she picked this over a
 * glow and a sweep across the row.
 *
 * The cue plays only when the count rises because something new arrived: the newest item is recent.
 * Items loaded with the page, on a reconnect or when a row first shows are old, so they don't cue;
 * neither do re-renders, a count that falls, or one that stays.
 */

/** How recent the newest item must be for a rise to cue. Older ones are being loaded, not arriving. */
export const FRESH_CUE_MS = 60_000;

/**
 * A number that goes up each time `count` rises with a fresh newest item (`newestAt`, ms); 0 until
 * the first cue. Key the cued element with it so its animation plays once per rise.
 */
export function useAttentionCue(count: number, newestAt: number, now: () => number = Date.now): number {
  const state = useRef({ count, cue: 0 });
  const previous = state.current;
  if (count !== previous.count) {
    const rose = count > previous.count && now() - newestAt < FRESH_CUE_MS;
    state.current = { count, cue: previous.cue + (rose ? 1 : 0) };
  }
  return state.current.cue;
}
