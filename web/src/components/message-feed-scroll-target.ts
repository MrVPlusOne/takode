import { useCallback, useEffect, useRef, useState } from "react";
import type { HistoryWindowState, ThreadWindowState } from "../types.js";
import { useStore } from "../store.js";
import { DEFAULT_VISIBLE_SECTION_COUNT } from "./message-feed-sections.js";
import type { Turn } from "../hooks/use-feed-model.js";

export interface PendingTargetWindowRequest {
  key: string;
  /** The window shown when the lookup was sent; its reply is a later window. */
  window: TargetWindow | null;
  /** The jump's retry tick and connection epoch when the lookup was sent. */
  retryTick: number;
  connectionEpoch: number;
  /** The lookup was already sent again once; next time the jump gives up. */
  retried: boolean;
  /**
   * The lookup could not go out on its own: with no window held it waits for the conversation's
   * first window, whose request may not name the target.
   */
  folded: boolean;
}

type TargetWindow = { target_message_id?: string };

export type MissingScrollTargetWindowAction =
  | { kind: "request"; pending: PendingTargetWindowRequest }
  | { kind: "wait" }
  | { kind: "fallback" };

/**
 * What a jump does while the feed lacks its target: look it up, wait for the lookup's reply, or
 * give up once the reply arrived without it. Only a window built for the target, which names it,
 * answers the lookup: another delivery (the reply to an earlier request, a refresh) says nothing
 * about the target, and giving up on one would abandon the jump just before its window arrives.
 * A lookup whose reply may be lost is sent once more, and the jump then gives up rather than wait
 * for good.
 */
export function getMissingScrollTargetWindowAction({
  pending,
  requestKey,
  targetMessageId,
  window,
  retryTick,
  connectionEpoch,
}: {
  pending: PendingTargetWindowRequest | null;
  requestKey: string;
  targetMessageId: string;
  window: TargetWindow | null;
  /** Advances each time a lookup has waited too long (see `useJumpTargetLookup`). */
  retryTick: number;
  /** Advances each time the connection comes back. */
  connectionEpoch: number;
}): MissingScrollTargetWindowAction {
  const ask = (retried: boolean): MissingScrollTargetWindowAction => ({
    kind: "request",
    pending: { key: requestKey, window, retryTick, connectionEpoch, retried, folded: false },
  });
  if (!pending || pending.key !== requestKey) return ask(false);
  if (isLookupReply(pending.window, window, targetMessageId)) return { kind: "fallback" };
  // No reply in time: ask once more, then give up.
  if (retryTick !== pending.retryTick) return pending.retried ? { kind: "fallback" } : ask(true);
  if (window === pending.window) return { kind: "wait" };
  // A window not built for the target. A folded lookup goes out now that a window is held; one
  // sent before the connection dropped lost its reply with the old connection, so it goes again.
  if (pending.folded) return ask(pending.retried);
  if (connectionEpoch !== pending.connectionEpoch && !pending.retried) return ask(true);
  return { kind: "wait" };
}

/** The loaded turn that shows the message a jump targets, if the feed holds it. */
export function findTurnShowingMessage(turns: readonly Turn[], messageId: string): Turn | undefined {
  return turns.find(
    (turn) =>
      turn.allEntries.some(
        (entry) =>
          (entry.kind === "message" && entry.msg.id === messageId) ||
          (entry.kind === "tool_msg_group" && entry.firstId === messageId),
      ) ||
      (turn.userEntry?.kind === "message" && turn.userEntry.msg.id === messageId),
  );
}

/** How long a jump's lookup waits for its reply before it asks again, and then gives up. */
export const JUMP_LOOKUP_RETRY_MS = 9_000;

/**
 * Looks up the message a jump targets when the loaded window lacks it, and says whether the jump
 * still waits for the window around it. Until that window, built for the target and naming it,
 * arrives, the feed would show unrelated messages, or a question card without the context above
 * it. A lookup that gets no reply within `JUMP_LOOKUP_RETRY_MS`, or whose reply was lost with a
 * dropped connection, is sent once more; then the jump gives up and lands on the latest turn.
 */
export function useJumpTargetLookup(input: {
  targetMessageId: string | null | undefined;
  sessionId: string;
  threadKey: string;
  /** A feed beside the main one: its window requests are never folded into another. */
  secondary: boolean;
  /** The feed shows thread windows (a leader's threads) rather than history windows. */
  threadWindowed: boolean;
  threadWindow: ThreadWindowState | null;
  historyWindow: HistoryWindowState | null;
  historyLoading: boolean;
  /** The jump is for another feed, which the route opens. */
  leavesFeed: boolean;
  targetLoaded: boolean;
  connected: boolean;
  sectionTurnCount: number;
  requestThreadWindow: (fromItem: number, requestedItemCount?: number, targetMessageId?: string) => boolean;
  requestHistoryWindow: (
    fromTurn: number,
    turnCount: number,
    sectionTurnCount: number,
    visibleSectionCount: number,
    targetMessageId?: string,
  ) => boolean;
}): {
  waiting: boolean;
  /** For a jump whose target the feed lacks: `missing` once the target can't be found. */
  lookUp: (targetMessageId: string) => "waiting" | "missing";
  clear: () => void;
} {
  const { targetMessageId, threadWindowed, threadWindow, historyWindow, historyLoading, connected } = input;
  const window = threadWindowed ? threadWindow : historyWindow;
  const jumpRef = useRef<{ target: string; window: TargetWindow | null; answered: boolean } | null>(null);
  if (!targetMessageId) jumpRef.current = null;
  else if (jumpRef.current?.target !== targetMessageId)
    jumpRef.current = { target: targetMessageId, window, answered: false };
  const jump = jumpRef.current;
  if (jump && !jump.answered) jump.answered = isLookupReply(jump.window, window, jump.target);
  const waiting = !!jump && !input.leavesFeed && !input.targetLoaded && !jump.answered;

  const [connectionEpoch, setConnectionEpoch] = useState(0);
  const wasConnectedRef = useRef(connected);
  useEffect(() => {
    if (connected && !wasConnectedRef.current) setConnectionEpoch((epoch) => epoch + 1);
    wasConnectedRef.current = connected;
  }, [connected]);

  const [retryTick, setRetryTick] = useState(0);
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setRetryTick((tick) => tick + 1), JUMP_LOOKUP_RETRY_MS);
    return () => clearTimeout(timer);
  }, [waiting, targetMessageId, retryTick, connectionEpoch]);

  const pendingRef = useRef<PendingTargetWindowRequest | null>(null);
  const { sessionId, threadKey, secondary, sectionTurnCount, requestThreadWindow, requestHistoryWindow } = input;
  const lookUp = useCallback(
    (target: string): "waiting" | "missing" => {
      // A conversation shown whole has no window to look the target up in. Read from the store
      // too: the request for a view's first window may have marked it loading this very commit.
      if (!threadWindowed && !historyWindow && !historyLoading && !useStore.getState().historyLoading?.get(sessionId))
        return "missing";
      const action = getMissingScrollTargetWindowAction({
        pending: pendingRef.current,
        requestKey: `${threadKey}:${target}`,
        targetMessageId: target,
        window: threadWindowed ? threadWindow : historyWindow,
        retryTick,
        connectionEpoch,
      });
      if (action.kind === "wait") return "waiting";
      if (action.kind === "fallback") {
        pendingRef.current = null;
        return "missing";
      }
      // With no window held, a thread's lookup joins its first window's request when that is in
      // flight (see `useThreadWindowRequester`), and a history lookup waits for the first window.
      const folded = threadWindowed
        ? !threadWindow && !secondary && useStore.getState().pendingThreadWindowRequests?.get(sessionId) === threadKey
        : !historyWindow;
      pendingRef.current = { ...action.pending, folded };
      if (folded) return "waiting";
      if (threadWindowed) requestThreadWindow(-1, undefined, target);
      else if (historyWindow)
        requestHistoryWindow(
          -1,
          historyWindow.turn_count || sectionTurnCount * DEFAULT_VISIBLE_SECTION_COUNT,
          historyWindow.section_turn_count,
          historyWindow.visible_section_count,
          target,
        );
      return "waiting";
    },
    [
      connectionEpoch,
      historyLoading,
      historyWindow,
      requestHistoryWindow,
      requestThreadWindow,
      retryTick,
      secondary,
      sectionTurnCount,
      sessionId,
      threadKey,
      threadWindow,
      threadWindowed,
    ],
  );
  const clear = useCallback(() => {
    pendingRef.current = null;
  }, []);
  return { waiting, lookUp, clear };
}

/** A window delivered after `sentWith` and built for `targetMessageId`: the reply to its lookup. */
function isLookupReply(sentWith: TargetWindow | null, window: TargetWindow | null, targetMessageId: string): boolean {
  return window !== sentWith && window?.target_message_id === targetMessageId;
}
