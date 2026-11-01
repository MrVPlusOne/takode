import {
  HISTORY_WINDOW_SECTION_TURN_COUNT,
  HISTORY_WINDOW_VISIBLE_SECTION_COUNT,
} from "../../shared/history-window.js";
import { getThreadWindowItemCount } from "../../shared/thread-window.js";
import { useStore } from "../store.js";
import type { BrowserOutgoingMessage } from "../types.js";

/**
 * A request for a leader's newest window of a thread. When the browser holds a window of it, the
 * request has that window's size and names its hash, so the server answers with only what changed
 * and the window on screen stays until the answer replaces it. `activateView` makes it the view
 * the server keeps live (the main view); a window for the side column or fetched ahead does not.
 */
export function latestThreadWindowRequest(
  sessionId: string,
  threadKey: string,
  activateView: boolean,
): BrowserOutgoingMessage {
  const held = useStore.getState().threadWindows.get(sessionId)?.get(threadKey.toLowerCase());
  const sectionItemCount = held?.section_item_count ?? HISTORY_WINDOW_SECTION_TURN_COUNT;
  const visibleItemCount = held?.visible_item_count ?? HISTORY_WINDOW_VISIBLE_SECTION_COUNT;
  return {
    type: "thread_window_request",
    thread_key: threadKey,
    from_item: -1,
    item_count: held?.item_count || getThreadWindowItemCount(visibleItemCount, sectionItemCount),
    section_item_count: sectionItemCount,
    visible_item_count: visibleItemCount,
    activate_view: activateView,
    ...(held?.window_hash ? { cached_window_hash: held.window_hash } : {}),
  };
}
