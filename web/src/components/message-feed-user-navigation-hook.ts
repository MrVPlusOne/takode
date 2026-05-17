import { useCallback, useEffect, useRef } from "react";
import type { HistoryWindowState, ThreadWindowState } from "../types.js";
import { escapeSelectorValue } from "./message-feed-utils.js";
import { getHistoryBoundaryWindowRequest, getThreadBoundaryWindowRequest } from "./message-feed-window-paging.js";
import {
  findAdjacentUserNavigationTarget,
  type UserNavigationDirection,
  type UserNavigationTarget,
} from "./message-feed-user-navigation.js";

type ElementRef<T> = { current: T | null };

interface UseUserMessageNavigationInput {
  containerRef: ElementRef<HTMLDivElement>;
  contentRootRef: ElementRef<HTMLDivElement>;
  userNavigationTargets: readonly UserNavigationTarget[];
  activeHistoryWindow: HistoryWindowState | null;
  activeThreadWindow: ThreadWindowState | null;
  normalizedThreadKey: string;
  visibleWindowSignature: string;
  autoFollowEnabledRef: ElementRef<boolean>;
  markSectionLoadPending: (direction: "older" | "newer", key: string) => boolean;
  requestThreadWindow: (fromItem: number, requestedItemCount?: number) => void;
  requestHistoryWindow: (
    fromTurn: number,
    turnCount: number,
    sectionTurnCount: number,
    visibleSectionCount: number,
  ) => void;
  ensureSectionForTurnVisible: (turnId: string) => boolean;
  scrollToFeedBlock: (blockId: string, turnId: string) => void;
  scrollToBottom: () => void;
}

export function useUserMessageNavigation(input: UseUserMessageNavigationInput): {
  handleScrollToPreviousUserMessageClick: () => void;
  handleScrollToNextUserMessageClick: () => void;
} {
  const {
    containerRef,
    contentRootRef,
    userNavigationTargets,
    activeHistoryWindow,
    activeThreadWindow,
    normalizedThreadKey,
    visibleWindowSignature,
    autoFollowEnabledRef,
    markSectionLoadPending,
    requestThreadWindow,
    requestHistoryWindow,
    ensureSectionForTurnVisible,
    scrollToFeedBlock,
    scrollToBottom,
  } = input;
  const pendingUserNavigationRef = useRef<{
    direction: UserNavigationDirection;
    anchorTargetKey: string | null;
  } | null>(null);
  const pendingLocalTargetRef = useRef<UserNavigationTarget | null>(null);

  const scrollToUserNavigationTarget = useCallback(
    (target: UserNavigationTarget) => {
      if (ensureSectionForTurnVisible(target.turnId)) {
        pendingLocalTargetRef.current = target;
        return;
      }
      scrollToFeedBlock(target.blockId, target.turnId);
    },
    [ensureSectionForTurnVisible, scrollToFeedBlock],
  );

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
        autoFollowEnabledRef.current = false;
        rememberPendingTarget();
        requestThreadWindow(request.fromItem, request.itemCount);
        return true;
      }
      if (activeHistoryWindow) {
        const request = getHistoryBoundaryWindowRequest(activeHistoryWindow, loadDirection);
        if (!request) return false;
        const requestKey = `history:${request.fromTurn}:${request.turnCount}:${activeHistoryWindow.section_turn_count}:${activeHistoryWindow.visible_section_count}`;
        if (!markSectionLoadPending(loadDirection, requestKey)) return true;
        autoFollowEnabledRef.current = false;
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
      autoFollowEnabledRef,
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
    const target = pendingLocalTargetRef.current;
    if (!target) return;
    pendingLocalTargetRef.current = null;
    scrollToFeedBlock(target.blockId, target.turnId);
  }, [scrollToFeedBlock, visibleWindowSignature]);

  const handleUserMessageNavigationClick = useCallback(
    (direction: UserNavigationDirection) => {
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
  };
}
