import type { FeedViewportPosition } from "../utils/thread-viewport.js";
import { persistLeaderViewportPosition } from "../utils/thread-viewport.js";
import { useStore } from "../store.js";
import { annotationPassageRects, resolveAnnotationRange } from "./annotation-passages.js";
import { flashMessageFeedTarget } from "./message-feed-target-highlight.js";

function escapeSelectorValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function findMessageFeedScrollTarget(container: HTMLDivElement, messageId: string): HTMLElement | null {
  return (
    container.querySelector<HTMLElement>(`[data-message-id="${escapeSelectorValue(messageId)}"]`) ??
    container.querySelector<HTMLElement>(`[data-feed-block-id="tool-group:${escapeSelectorValue(messageId)}"]`)
  );
}

export function scrollMessageFeedTargetIntoView({
  container,
  target,
  targetMessageId,
  targetTurnId,
  sessionId,
  threadKey,
  viewportKey,
  isLeaderSession,
  lastSeenContentBottom,
  getRealContentBottom,
  markProgrammaticScroll,
  setShowScrollButton,
  setAutoFollowEnabled,
  setFeedScrollPosition,
  reserveTargetScrollSpace,
  refs,
}: {
  container: HTMLDivElement;
  target: HTMLElement;
  targetMessageId: string;
  targetTurnId: string;
  sessionId: string;
  threadKey: string;
  viewportKey: string;
  isLeaderSession: boolean;
  lastSeenContentBottom: number | null;
  getRealContentBottom: () => number | null;
  markProgrammaticScroll: (top: number) => void;
  setShowScrollButton: (show: boolean) => void;
  setAutoFollowEnabled: (enabled: boolean) => void;
  setFeedScrollPosition: (viewportKey: string, position: FeedViewportPosition) => void;
  reserveTargetScrollSpace?: (additional: number, viewportHeight: number) => void;
  refs: {
    lastScrollTop: { current: number };
    isNearBottom: { current: boolean };
  };
}): FeedViewportPosition {
  const containerRect = container.getBoundingClientRect();
  const editor = useStore.getState().annotationEditor;
  const range =
    editor?.navigateToSource &&
    editor.sessionId === sessionId &&
    editor.threadKey === threadKey &&
    editor.annotation.sourceMessageId === targetMessageId
      ? resolveAnnotationRange(target, editor.annotation)
      : null;
  const passage = range ? annotationPassageRects(range)[0] : undefined;
  const targetRect = passage ?? target.getBoundingClientRect();
  const scale = container.offsetHeight ? containerRect.height / container.offsetHeight || 1 : 1;
  const visibleTargetHeight = Math.min(targetRect.height / scale, container.clientHeight);
  const targetOffsetTop = passage ? 24 : Math.max(0, Math.round((container.clientHeight - visibleTargetHeight) / 2));
  const nextTop = container.scrollTop + (targetRect.top - containerRect.top) / scale - targetOffsetTop;
  if (passage) {
    const end = container.querySelector<HTMLElement>("[data-feed-end-slack]");
    // scrollHeight is at least clientHeight, hiding any unused space below a
    // short answer. Measure the actual end before reserving room for the jump.
    const contentEnd = end
      ? container.scrollTop +
        (end.getBoundingClientRect().bottom - containerRect.top) / scale +
        (Number.parseFloat(getComputedStyle(container).paddingBottom) || 0)
      : container.scrollHeight;
    reserveTargetScrollSpace?.(Math.max(0, nextTop + container.clientHeight - contentEnd), container.clientHeight);
  }
  markProgrammaticScroll(nextTop);
  container.scrollTop = nextTop;
  refs.lastScrollTop.current = container.scrollTop;
  setAutoFollowEnabled(false);
  refs.isNearBottom.current = false;
  setShowScrollButton(true);

  const settledTargetRect = target.getBoundingClientRect();
  const position: FeedViewportPosition = {
    scrollTop: container.scrollTop,
    scrollHeight: container.scrollHeight,
    isAtBottom: false,
    anchorMessageId: targetMessageId,
    anchorTurnId: targetTurnId,
    anchorOffsetTop: settledTargetRect.top - containerRect.top,
    lastSeenContentBottom: lastSeenContentBottom ?? getRealContentBottom(),
  };
  setFeedScrollPosition(viewportKey, position);
  if (isLeaderSession) persistLeaderViewportPosition(sessionId, threadKey, position);
  if (!passage) flashMessageFeedTarget(target);
  return position;
}
