import { normalizeThreadKey } from "./thread-projection.js";

/** The feed of the side pane a plain click is being made in: its session, thread and feed key. */
export interface ClickedPaneFeed {
  sessionId: string;
  threadKey: string;
  feedKey: string;
}

let clicked: ClickedPaneFeed | null = null;

/**
 * Records the side pane feed a plain click is being made in (`side-column.ts`, in the capture
 * phase), for the click's own handlers; forgotten once the click is handled.
 */
export function noteClickedPaneFeed(feed: ClickedPaneFeed | null): void {
  clicked = feed;
  setTimeout(() => {
    if (clicked === feed) clicked = null;
  }, 0);
}

/**
 * The feed key of the side pane being clicked when a jump to `messageId` belongs there: the pane
 * shows the message's thread, or (with no thread named) already shows the message. Else null, and
 * the jump goes to the main view.
 */
export function clickedPaneFeedFor(sessionId: string, messageId: string, threadKey: string | undefined): string | null {
  if (!clicked || clicked.sessionId !== sessionId) return null;
  if (threadKey)
    return normalizeThreadKey(threadKey) === normalizeThreadKey(clicked.threadKey) ? clicked.feedKey : null;
  const feedKey = clicked.feedKey;
  const shown = Array.from(document.querySelectorAll<HTMLElement>("[data-feed-key]")).some(
    (feed) =>
      feed.dataset.feedKey === feedKey &&
      Array.from(feed.querySelectorAll<HTMLElement>("[data-message-id]")).some(
        (node) => node.dataset.messageId === messageId,
      ),
  );
  return shown ? feedKey : null;
}
