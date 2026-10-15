import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import type { ChatMessage, HistoryWindowState, StarredMessageRecord, ThreadWindowState } from "../types.js";
import type { Turn } from "../hooks/use-feed-model.js";
import { escapeSelectorValue } from "./message-feed-utils.js";
import { getHistoryBoundaryWindowRequest, getThreadBoundaryWindowRequest } from "./message-feed-window-paging.js";
import {
  collectUserNavigationTargets,
  findAdjacentUserNavigationTarget,
  mergeUserNavigationTargets,
  searchResultsToUserNavigationTargets,
  type ServerUserNavigationSearchResult,
  type UserNavigationDirection,
  type UserNavigationTarget,
} from "./message-feed-user-navigation.js";

type ElementRef<T> = { current: T | null };
const USER_NAVIGATION_SEARCH_LIMIT = 200;
const USER_NAVIGATION_SEARCH_MAX_RESULTS = 1000;

// The index read in flight. A refetch for the same session and thread, including
// one from a remounted feed, lets it finish instead of aborting it: an aborted
// read can drop the browser's cached copy, so the next read re-downloads the
// whole index instead of getting a 304. A read for another session or thread
// aborts it, so a switch does not wait behind the index it left.
let inFlightNavigationRead: { key: string; controller: AbortController } | null = null;

export function useMessageFeedUserNavigationTargets({
  allMessages,
  herdingLeaderSessionId,
  isLeaderSession,
  normalizedThreadKey,
  sessionId,
  starredMessages,
  threadWindowRefreshRevision,
  turns,
  userNavigationSourceSessionId,
}: {
  allMessages: readonly ChatMessage[];
  herdingLeaderSessionId?: string | null;
  isLeaderSession: boolean;
  normalizedThreadKey: string;
  sessionId: string;
  starredMessages?: Record<string, StarredMessageRecord>;
  threadWindowRefreshRevision: number;
  turns: readonly Turn[];
  userNavigationSourceSessionId: string;
}): UserNavigationTarget[] {
  const localUserNavigationTargets = useMemo(
    () => collectUserNavigationTargets(turns, userNavigationSourceSessionId, starredMessages),
    [starredMessages, turns, userNavigationSourceSessionId],
  );
  const [serverUserNavigationTargets, setServerUserNavigationTargets] = useState<UserNavigationTarget[] | null>(null);
  // The server index changes only when a navigable user message arrives (assistant replies and
  // worker events are never targets; starring is tracked separately), so refetch on that, not on
  // every message: the whole index is re-downloaded each time.
  const latestNavigableUserMessageId = useMemo(
    () => findLatestNavigableUserMessageId(allMessages, sessionId),
    [allMessages, sessionId],
  );
  const useServerUserNavigationTargets = !herdingLeaderSessionId;

  useEffect(() => {
    if (!useServerUserNavigationTargets || typeof api.searchSessionMessages !== "function") {
      setServerUserNavigationTargets(null);
      return;
    }

    const requestKey = `${sessionId}\u0000${normalizedThreadKey}`;
    if (inFlightNavigationRead && inFlightNavigationRead.key !== requestKey) inFlightNavigationRead.controller.abort();
    const controller = new AbortController();
    inFlightNavigationRead = { key: requestKey, controller };
    let cancelled = false;

    async function loadTargets() {
      try {
        const results: ServerUserNavigationSearchResult[] = [];
        let offset = 0;
        while (results.length < USER_NAVIGATION_SEARCH_MAX_RESULTS) {
          const response = await api.searchSessionMessages(sessionId, {
            query: "",
            scope: isLeaderSession ? "current_thread" : "session",
            threadKey: isLeaderSession ? normalizedThreadKey : undefined,
            filters: { user: true, assistant: true, event: false },
            limit: USER_NAVIGATION_SEARCH_LIMIT,
            offset,
            signal: controller.signal,
          });
          results.push(...response.results);
          if (!response.hasMore || response.nextOffset == null) break;
          offset = response.nextOffset;
        }
        if (!cancelled && !controller.signal.aborted) {
          setServerUserNavigationTargets(searchResultsToUserNavigationTargets(results));
        }
        if (inFlightNavigationRead?.controller === controller) inFlightNavigationRead = null;
      } catch (err) {
        if (cancelled || controller.signal.aborted) return;
        console.warn("[message-feed] user-message navigation metadata failed:", err);
        setServerUserNavigationTargets(null);
      }
    }

    void loadTargets();
    return () => {
      cancelled = true;
    };
  }, [
    isLeaderSession,
    latestNavigableUserMessageId,
    normalizedThreadKey,
    sessionId,
    starredMessages,
    threadWindowRefreshRevision,
    useServerUserNavigationTargets,
  ]);

  return useMemo(
    () =>
      serverUserNavigationTargets
        ? mergeUserNavigationTargets(serverUserNavigationTargets, localUserNavigationTargets)
        : localUserNavigationTargets,
    [localUserNavigationTargets, serverUserNavigationTargets],
  );
}

interface UseUserMessageNavigationInput {
  containerRef: ElementRef<HTMLDivElement>;
  contentRootRef: ElementRef<HTMLDivElement>;
  userNavigationTargets: readonly UserNavigationTarget[];
  activeHistoryWindow: HistoryWindowState | null;
  activeThreadWindow: ThreadWindowState | null;
  normalizedThreadKey: string;
  visibleWindowSignature: string;
  setAutoFollowEnabled: (enabled: boolean) => void;
  markSectionLoadPending: (direction: "older" | "newer", key: string) => boolean;
  requestThreadWindow: (fromItem: number, requestedItemCount?: number, targetMessageId?: string) => void;
  requestHistoryWindow: (
    fromTurn: number,
    turnCount: number,
    sectionTurnCount: number,
    visibleSectionCount: number,
  ) => void;
  ensureSectionForTurnVisible: (turnId: string) => boolean;
  scrollToFeedBlock: (blockId: string, turnId: string) => void;
  scrollToBottom: () => void;
  onUserNavigationIntent: () => void;
}

export function useUserMessageNavigation(input: UseUserMessageNavigationInput): {
  handleScrollToPreviousUserMessageClick: () => void;
  handleScrollToNextUserMessageClick: () => void;
  handleSelectUserNavigationTarget: (target: UserNavigationTarget) => void;
} {
  const {
    containerRef,
    contentRootRef,
    userNavigationTargets,
    activeHistoryWindow,
    activeThreadWindow,
    normalizedThreadKey,
    visibleWindowSignature,
    setAutoFollowEnabled,
    markSectionLoadPending,
    requestThreadWindow,
    requestHistoryWindow,
    ensureSectionForTurnVisible,
    scrollToFeedBlock,
    scrollToBottom,
    onUserNavigationIntent,
  } = input;
  const pendingUserNavigationRef = useRef<{
    direction: UserNavigationDirection;
    anchorTargetKey: string | null;
  } | null>(null);
  const pendingLocalTargetRef = useRef<UserNavigationTarget | null>(null);
  const pendingSpecificTargetRef = useRef<UserNavigationTarget | null>(null);

  const getMountedUserNavigationTargets = useCallback(() => {
    const contentRoot = contentRootRef.current;
    if (!contentRoot) return [];
    return userNavigationTargets.flatMap((target) => {
      const element = contentRoot.querySelector<HTMLElement>(
        `[data-feed-block-id="${escapeSelectorValue(target.blockId)}"]`,
      );
      return element ? [{ target, element }] : [];
    });
  }, [contentRootRef, userNavigationTargets]);

  const isUserNavigationTargetMounted = useCallback(
    (target: UserNavigationTarget) => {
      const contentRoot = contentRootRef.current;
      if (!contentRoot) return false;
      return Boolean(
        contentRoot.querySelector<HTMLElement>(`[data-feed-block-id="${escapeSelectorValue(target.blockId)}"]`),
      );
    },
    [contentRootRef],
  );

  const requestWindowForUserNavigationTarget = useCallback(
    (target: UserNavigationTarget) => {
      if (activeThreadWindow) {
        const targetIndex =
          typeof target.navigationIndex === "number" && Number.isFinite(target.navigationIndex)
            ? target.navigationIndex
            : activeThreadWindow.from_item;
        const itemCount = Math.max(
          1,
          activeThreadWindow.item_count,
          activeThreadWindow.section_item_count * activeThreadWindow.visible_item_count,
        );
        const maxFrom = Math.max(0, activeThreadWindow.total_items - itemCount);
        const fromItem = Math.min(Math.max(0, targetIndex - Math.floor(itemCount / 2)), maxFrom);
        const direction = targetIndex < activeThreadWindow.from_item ? "older" : "newer";
        const requestKey = `thread:${normalizedThreadKey}:${fromItem}:${itemCount}:target:${target.messageId}`;
        if (!markSectionLoadPending(direction, requestKey)) return true;
        setAutoFollowEnabled(false);
        pendingSpecificTargetRef.current = target;
        requestThreadWindow(fromItem, itemCount, target.messageId);
        return true;
      }

      const targetIndex = target.navigationIndex;
      if (typeof targetIndex !== "number" || !Number.isFinite(targetIndex)) return false;

      if (activeHistoryWindow) {
        const turnCount = Math.max(
          1,
          activeHistoryWindow.turn_count,
          activeHistoryWindow.section_turn_count * activeHistoryWindow.visible_section_count,
        );
        const maxFrom = Math.max(0, activeHistoryWindow.total_turns - turnCount);
        const fromTurn = Math.min(Math.max(0, targetIndex - Math.floor(turnCount / 2)), maxFrom);
        const direction = targetIndex < activeHistoryWindow.from_turn ? "older" : "newer";
        const requestKey = `history:${fromTurn}:${turnCount}:${activeHistoryWindow.section_turn_count}:${activeHistoryWindow.visible_section_count}:target:${target.messageId}`;
        if (!markSectionLoadPending(direction, requestKey)) return true;
        setAutoFollowEnabled(false);
        pendingSpecificTargetRef.current = target;
        requestHistoryWindow(
          fromTurn,
          turnCount,
          activeHistoryWindow.section_turn_count,
          activeHistoryWindow.visible_section_count,
        );
        return true;
      }

      return false;
    },
    [
      activeHistoryWindow,
      activeThreadWindow,
      setAutoFollowEnabled,
      markSectionLoadPending,
      normalizedThreadKey,
      requestHistoryWindow,
      requestThreadWindow,
    ],
  );

  const scrollToUserNavigationTarget = useCallback(
    (target: UserNavigationTarget) => {
      onUserNavigationIntent();
      if (!isUserNavigationTargetMounted(target) && requestWindowForUserNavigationTarget(target)) {
        pendingSpecificTargetRef.current = target;
        return;
      }
      if (ensureSectionForTurnVisible(target.turnId)) {
        pendingLocalTargetRef.current = target;
        return;
      }
      scrollToFeedBlock(target.blockId, target.turnId);
    },
    [
      ensureSectionForTurnVisible,
      isUserNavigationTargetMounted,
      onUserNavigationIntent,
      requestWindowForUserNavigationTarget,
      scrollToFeedBlock,
    ],
  );

  const scrollToLoadedAdjacentUserNavigationTarget = useCallback(
    (
      direction: UserNavigationDirection,
      mountedTargets: Array<{ target: UserNavigationTarget; element: HTMLElement }>,
    ) => {
      const anchorTarget =
        direction === "previous" ? mountedTargets[0]?.target : mountedTargets[mountedTargets.length - 1]?.target;
      const target = findAdjacentUserNavigationTarget(userNavigationTargets, anchorTarget?.key ?? null, direction);
      if (!target) return false;
      scrollToUserNavigationTarget(target);
      return true;
    },
    [scrollToUserNavigationTarget, userNavigationTargets],
  );

  const requestAdjacentUserNavigationWindow = useCallback(
    (
      direction: UserNavigationDirection,
      mountedTargets: Array<{ target: UserNavigationTarget; element: HTMLElement }>,
    ) => {
      const loadDirection = direction === "previous" ? "older" : "newer";
      const anchorTarget =
        direction === "previous" ? mountedTargets[0]?.target : mountedTargets[mountedTargets.length - 1]?.target;
      const rememberPendingTarget = () => {
        pendingUserNavigationRef.current = { direction, anchorTargetKey: anchorTarget?.key ?? null };
      };
      if (activeThreadWindow) {
        const request = getThreadBoundaryWindowRequest(activeThreadWindow, loadDirection);
        if (!request) return false;
        const requestKey = `thread:${normalizedThreadKey}:${request.fromItem}:${request.itemCount}`;
        if (!markSectionLoadPending(loadDirection, requestKey)) return true;
        setAutoFollowEnabled(false);
        rememberPendingTarget();
        requestThreadWindow(request.fromItem, request.itemCount);
        return true;
      }
      if (activeHistoryWindow) {
        const request = getHistoryBoundaryWindowRequest(activeHistoryWindow, loadDirection);
        if (!request) return false;
        const requestKey = `history:${request.fromTurn}:${request.turnCount}:${activeHistoryWindow.section_turn_count}:${activeHistoryWindow.visible_section_count}`;
        if (!markSectionLoadPending(loadDirection, requestKey)) return true;
        setAutoFollowEnabled(false);
        rememberPendingTarget();
        requestHistoryWindow(
          request.fromTurn,
          request.turnCount,
          activeHistoryWindow.section_turn_count,
          activeHistoryWindow.visible_section_count,
        );
        return true;
      }
      return false;
    },
    [
      activeHistoryWindow,
      activeThreadWindow,
      setAutoFollowEnabled,
      markSectionLoadPending,
      normalizedThreadKey,
      requestHistoryWindow,
      requestThreadWindow,
    ],
  );

  useEffect(() => {
    const pending = pendingUserNavigationRef.current;
    if (!pending) return;
    const target = findAdjacentUserNavigationTarget(userNavigationTargets, pending.anchorTargetKey, pending.direction);
    pendingUserNavigationRef.current = null;
    if (target) scrollToUserNavigationTarget(target);
  }, [scrollToUserNavigationTarget, userNavigationTargets, visibleWindowSignature]);

  useEffect(() => {
    const pending = pendingSpecificTargetRef.current;
    if (!pending) return;
    const target = userNavigationTargets.find((candidate) => candidate.messageId === pending.messageId) ?? pending;
    if (!isUserNavigationTargetMounted(target)) return;
    pendingSpecificTargetRef.current = null;
    scrollToFeedBlock(target.blockId, target.turnId);
  }, [isUserNavigationTargetMounted, scrollToFeedBlock, userNavigationTargets, visibleWindowSignature]);

  useEffect(() => {
    const target = pendingLocalTargetRef.current;
    if (!target) return;
    pendingLocalTargetRef.current = null;
    scrollToFeedBlock(target.blockId, target.turnId);
  }, [scrollToFeedBlock, visibleWindowSignature]);

  const handleUserMessageNavigationClick = useCallback(
    (direction: UserNavigationDirection) => {
      onUserNavigationIntent();
      const el = containerRef.current;
      if (!el) return;
      const containerRect = el.getBoundingClientRect();
      const mountedTargets = getMountedUserNavigationTargets();
      const orderedTargets = direction === "previous" ? [...mountedTargets].reverse() : mountedTargets;
      for (const { target, element } of orderedTargets) {
        const targetTop = element.getBoundingClientRect().top - containerRect.top;
        const shouldScroll = direction === "previous" ? targetTop < -5 : targetTop > el.clientHeight * 0.3;
        if (!shouldScroll) continue;
        scrollToUserNavigationTarget(target);
        return;
      }
      if (scrollToLoadedAdjacentUserNavigationTarget(direction, mountedTargets)) return;
      if (requestAdjacentUserNavigationWindow(direction, mountedTargets)) return;
      if (direction === "next") scrollToBottom();
    },
    [
      containerRef,
      getMountedUserNavigationTargets,
      onUserNavigationIntent,
      requestAdjacentUserNavigationWindow,
      scrollToBottom,
      scrollToLoadedAdjacentUserNavigationTarget,
      scrollToUserNavigationTarget,
    ],
  );

  return {
    handleScrollToPreviousUserMessageClick: useCallback(
      () => handleUserMessageNavigationClick("previous"),
      [handleUserMessageNavigationClick],
    ),
    handleScrollToNextUserMessageClick: useCallback(
      () => handleUserMessageNavigationClick("next"),
      [handleUserMessageNavigationClick],
    ),
    handleSelectUserNavigationTarget: scrollToUserNavigationTarget,
  };
}

/** The newest user message the server index lists as a navigation target: typed in this session, not injected. */
function findLatestNavigableUserMessageId(messages: readonly ChatMessage[], sessionId: string): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role !== "user") continue;
    if (message.agentSource && message.agentSource.sessionId !== sessionId) continue;
    return message.id;
  }
  return "";
}
