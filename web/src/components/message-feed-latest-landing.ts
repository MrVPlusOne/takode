import { useCallback, useLayoutEffect, useState, type RefObject } from "react";
import { getFeedElementScrollOffset } from "./message-feed-viewport-anchor.js";

/**
 * Lands a feed opened at its latest messages just above the thread status rows under the last
 * message (Thread Waiting or Ready, the waiting worker's live preview), so the last message ends
 * at the bottom of the view instead of scrolling past it to the worker's activity.
 *
 * `request` is called when the feed opens at the latest. The landing waits until the newest
 * window is shown (`contentReady`) and is dropped as soon as the reader moves
 * (`cancelLatestLanding`). Without status rows under the last message the feed stays at its real
 * bottom, following new content.
 */
export function useLatestLandingAboveStatus({
  landingRef,
  containerRef,
  contentReady,
  layoutKey,
  getRealContentBottom,
  setScrollTop,
  setAutoFollowEnabled,
  isNearBottomRef,
  setShowScrollButton,
  onLanded,
  pin,
}: {
  /** Whether a landing is pending. */
  landingRef: { current: boolean };
  containerRef: RefObject<HTMLDivElement | null>;
  contentReady: boolean;
  /** Changes when the feed's rows or its thread status rows change. */
  layoutKey: string;
  getRealContentBottom: () => number | null;
  setScrollTop: (top: number) => void;
  setAutoFollowEnabled: (enabled: boolean) => void;
  isNearBottomRef: { current: boolean };
  setShowScrollButton: (show: boolean) => void;
  /** The latest content counts as seen: the status rows left below are not news. */
  onLanded: () => void;
  /** Keeps the last message where it landed while late content renders (`useJumpTargetPin`). */
  pin: (target: HTMLElement) => void;
}) {
  const [requested, setRequested] = useState(0);
  const request = useCallback(() => {
    landingRef.current = true;
    setRequested((count) => count + 1);
  }, [landingRef]);

  useLayoutEffect(() => {
    if (!landingRef.current || !contentReady) return;
    // Once, on the first layout that shows the newest messages: status rows appearing later are
    // live news, which a reader at the bottom follows.
    landingRef.current = false;
    const container = containerRef.current;
    const footer = container ? lastStatusRowsUnderLastMessage(container) : null;
    const contentBottom = getRealContentBottom();
    if (!container || !footer || contentBottom === null) return;
    const bottomTop = Math.max(0, Math.ceil(contentBottom - container.clientHeight));
    // The status rows' top goes where the content's end sits at the feed's physical bottom: above
    // the trailing space kept clear of the floating status and navigation controls.
    const clearance = Math.max(0, container.scrollHeight - contentBottom);
    const footerTop = getFeedElementScrollOffset(container, footer, "top");
    const top = Math.max(0, Math.round(footerTop + clearance - container.clientHeight));
    if (top >= bottomTop) return;
    // Above the real bottom is a reading position: new content no longer pulls the view down.
    setAutoFollowEnabled(false);
    isNearBottomRef.current = false;
    setShowScrollButton(true);
    setScrollTop(top);
    onLanded();
    const lastMessage = lastMessageBefore(container, footer);
    if (lastMessage) pin(lastMessage);
  }, [
    containerRef,
    contentReady,
    getRealContentBottom,
    isNearBottomRef,
    landingRef,
    layoutKey,
    onLanded,
    pin,
    requested,
    setAutoFollowEnabled,
    setScrollTop,
    setShowScrollButton,
  ]);

  return request;
}

/** Drop a pending landing: the reader moved or navigated. */
export function cancelLatestLanding(landingRef: { current: boolean }): void {
  landingRef.current = false;
}

/** The thread status rows ending the feed, unless a message follows them. */
function lastStatusRowsUnderLastMessage(container: HTMLElement): HTMLElement | null {
  const footers = container.querySelectorAll<HTMLElement>("[data-feed-thread-status-footer]");
  const footer = footers[footers.length - 1];
  if (!footer) return null;
  const messages = container.querySelectorAll<HTMLElement>("[data-message-id]");
  const lastMessage = messages[messages.length - 1];
  if (
    lastMessage &&
    !footer.contains(lastMessage) &&
    footer.compareDocumentPosition(lastMessage) & Node.DOCUMENT_POSITION_FOLLOWING
  ) {
    return null;
  }
  return footer;
}

function lastMessageBefore(container: HTMLElement, footer: HTMLElement): HTMLElement | null {
  const messages = [...container.querySelectorAll<HTMLElement>("[data-message-id]")];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]!;
    if (footer.compareDocumentPosition(message) & Node.DOCUMENT_POSITION_PRECEDING) return message;
  }
  return null;
}
