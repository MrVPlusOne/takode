import type { FeedViewportPosition } from "../utils/thread-viewport.js";
import { persistLeaderViewportPosition } from "../utils/thread-viewport.js";
import { useStore } from "../store.js";
import { annotationPassageRects, resolveAnnotationRange } from "./annotation-passages.js";
import { flashMessageFeedTarget } from "./message-feed-target-highlight.js";
import { takeZoomPlacement } from "./topic-zoom.js";
import type { TurnCollapseState } from "../hooks/use-collapse-policy.js";
import type { Turn } from "../hooks/use-feed-model.js";
import type { MessageJumpLanding } from "../store-types.js";
import { getQuestCompletionFeedBlockId } from "./message-feed-utils.js";

function escapeSelectorValue(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** The element of `messageId` in the feed. */
function findMessageFeedScrollTarget(container: HTMLDivElement, messageId: string): HTMLElement | null {
  return (
    container.querySelector<HTMLElement>(`[data-message-id="${escapeSelectorValue(messageId)}"]`) ??
    container.querySelector<HTMLElement>(`[data-feed-block-id="tool-group:${escapeSelectorValue(messageId)}"]`)
  );
}

function findLandingTarget(container: HTMLDivElement, landing: MessageJumpLanding): HTMLElement | null {
  if (landing !== "quest-completion") return null;
  // A thread shows at most one Quest complete card; its slot stays empty while the card renders nothing.
  const slot = container.querySelector<HTMLElement>(`[data-feed-block-id^="${getQuestCompletionFeedBlockId("")}"]`);
  return slot?.childElementCount ? slot : null;
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
  // A zoom between a quest and its topic keeps the message where the reader had it, unflashed.
  const zoomOffset = passage ? null : takeZoomPlacement(targetMessageId);
  const targetOffsetTop =
    zoomOffset ?? (passage ? 24 : Math.max(0, Math.round((container.clientHeight - visibleTargetHeight) / 2)));
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
    savedAt: Date.now(),
  };
  setFeedScrollPosition(viewportKey, position);
  if (isLeaderSession) persistLeaderViewportPosition(sessionId, threadKey, position);
  if (!passage && zoomOffset === null) flashMessageFeedTarget(target);
  return position;
}

/**
 * How a jump to `messageId` in `turn` lands. `keepCollapsed`: the turn may stay as it is,
 * because the view already shows where the jump lands; other jumps open the turn. `find` gives
 * the element to scroll to once rendered: what `landingRequest` names when it is for this
 * message and shown, else the message, else the end of a collapsed turn that hides it.
 *
 * A finished quest's result names the leader's last message before the quest completed, often
 * commentary ("Final Memory is done..."). Where its Quest complete card isn't drawn (a topic
 * conversation, or a window that doesn't reach the completion), the jump lands on the answer or
 * report the leader posted after that message in the same turn, when there is one.
 */
export function planMessageFeedJump(
  container: HTMLDivElement | null,
  state: Pick<TurnCollapseState, "readyCollapsed" | "isActivityExpanded" | "readyAnchorMessageId"> | undefined,
  messageId: string,
  landingRequest: { messageId: string; landing: MessageJumpLanding } | undefined,
  turn: Pick<Turn, "id" | "allEntries">,
): { keepCollapsed: boolean; find: (container: HTMLDivElement) => HTMLElement | null } {
  const landing = landingRequest?.messageId === messageId ? landingRequest.landing : undefined;
  const cardShown = !!landing && !!container && findLandingTarget(container, landing) !== null;
  const resultId = landing === "quest-completion" && !cardShown ? resultAfter(turn, messageId) : undefined;
  const targetId = resultId ?? messageId;
  const keepCollapsed = cardShown || keepsCollapseForTarget(container, state, targetId);
  return {
    keepCollapsed,
    find: (root) =>
      (landing ? findLandingTarget(root, landing) : null) ??
      findMessageFeedScrollTarget(root, targetId) ??
      (resultId ? findMessageFeedScrollTarget(root, messageId) : null) ??
      (keepCollapsed ? findCollapsedTurnScrollTarget(root, turn.id) : null),
  };
}

/** The first answer or report after `messageId` in the turn. */
function resultAfter(turn: Pick<Turn, "allEntries">, messageId: string): string | undefined {
  const start = turn.allEntries.findIndex((entry) => entry.kind === "message" && entry.msg.id === messageId);
  if (start < 0) return undefined;
  for (const entry of turn.allEntries.slice(start + 1)) {
    if (entry.kind !== "message") continue;
    const metadata = entry.msg.metadata;
    if (metadata?.leaderThreadRole === "answer" || metadata?.threadAnswer || metadata?.markdownReport) {
      return entry.msg.id;
    }
  }
  return undefined;
}

/**
 * Whether a jump may leave its turn as it is: in a Ready-collapsed turn, the Ready message
 * itself (opening the thread's result) or a message the collapsed view already shows. Other
 * targets expand the turn.
 */
function keepsCollapseForTarget(
  container: HTMLDivElement | null,
  state: Pick<TurnCollapseState, "readyCollapsed" | "isActivityExpanded" | "readyAnchorMessageId"> | undefined,
  messageId: string,
): boolean {
  if (!state?.readyCollapsed || state.isActivityExpanded) return false;
  if (state.readyAnchorMessageId === messageId) return true;
  return !!container && findMessageFeedScrollTarget(container, messageId) !== null;
}

/** Where to land in a collapsed turn that does not show the target: its last shown message. */
function findCollapsedTurnScrollTarget(container: HTMLDivElement, turnId: string): HTMLElement | null {
  const turn = container.querySelector<HTMLElement>(`[data-turn-id="${escapeSelectorValue(turnId)}"]`);
  if (!turn) return null;
  const messages = turn.querySelectorAll<HTMLElement>("[data-message-id]");
  return messages[messages.length - 1] ?? turn;
}
