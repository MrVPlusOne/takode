import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { HistoryWindowState, ThreadWindowState } from "../types.js";
import { getHistoryBoundaryWindowRequest, getThreadBoundaryWindowRequest } from "./message-feed-window-paging.js";
import { admitSectionWindowRequest } from "./message-feed-window-request-admission.js";

export function useMessageFeedSectionWindowLoaders(input: {
  activeHistoryWindow: HistoryWindowState | null;
  activeThreadWindow: ThreadWindowState | null;
  normalizedThreadKey: string;
  pendingRequestKeyRef: { current: string | null };
  autoFollowEnabledRef: { current: boolean };
  previousSectionStartIndex: number | null;
  nextSectionStartIndex: number | null;
  latestVisibleSectionStartIndex: number;
  markPending: (direction: "older" | "newer", requestKey: string) => boolean;
  moveSectionWindow: (nextStart: number | null) => void;
  requestHistoryWindow: (
    fromTurn: number,
    turnCount: number,
    sectionTurnCount: number,
    visibleSectionCount: number,
  ) => boolean;
  requestThreadWindow: (fromItem: number, itemCount?: number, targetMessageId?: string) => boolean;
  setShowScrollButton: Dispatch<SetStateAction<boolean>>;
}) {
  const handleLoadOlderSection = useCallback(() => {
    if (input.activeThreadWindow) {
      const request = getThreadBoundaryWindowRequest(input.activeThreadWindow, "older");
      if (!request) return;
      const requestKey = `thread:${input.normalizedThreadKey}:${request.fromItem}:${request.itemCount}`;
      if (
        !admitSectionWindowRequest({
          direction: "older",
          requestKey,
          pendingRequestKey: input.pendingRequestKeyRef.current,
          send: () => input.requestThreadWindow(request.fromItem, request.itemCount),
          markPending: input.markPending,
        })
      )
        return;
      input.autoFollowEnabledRef.current = false;
      input.setShowScrollButton(true);
      return;
    }
    if (input.activeHistoryWindow) {
      const request = getHistoryBoundaryWindowRequest(input.activeHistoryWindow, "older");
      if (!request) return;
      const requestKey = `history:${request.fromTurn}:${request.turnCount}:${input.activeHistoryWindow.section_turn_count}:${input.activeHistoryWindow.visible_section_count}`;
      if (
        !admitSectionWindowRequest({
          direction: "older",
          requestKey,
          pendingRequestKey: input.pendingRequestKeyRef.current,
          send: () =>
            input.requestHistoryWindow(
              request.fromTurn,
              request.turnCount,
              input.activeHistoryWindow!.section_turn_count,
              input.activeHistoryWindow!.visible_section_count,
            ),
          markPending: input.markPending,
        })
      )
        return;
      input.autoFollowEnabledRef.current = false;
      input.setShowScrollButton(true);
      return;
    }
    if (input.previousSectionStartIndex == null) return;
    input.autoFollowEnabledRef.current = false;
    input.setShowScrollButton(true);
    input.moveSectionWindow(input.previousSectionStartIndex);
  }, [
    input.activeHistoryWindow,
    input.activeThreadWindow,
    input.autoFollowEnabledRef,
    input.markPending,
    input.moveSectionWindow,
    input.normalizedThreadKey,
    input.pendingRequestKeyRef,
    input.previousSectionStartIndex,
    input.requestHistoryWindow,
    input.requestThreadWindow,
    input.setShowScrollButton,
  ]);

  const handleLoadNewerSection = useCallback(() => {
    if (input.activeThreadWindow) {
      const request = getThreadBoundaryWindowRequest(input.activeThreadWindow, "newer");
      if (!request) return;
      const requestKey = `thread:${input.normalizedThreadKey}:${request.fromItem}:${request.itemCount}`;
      if (
        !admitSectionWindowRequest({
          direction: "newer",
          requestKey,
          pendingRequestKey: input.pendingRequestKeyRef.current,
          send: () => input.requestThreadWindow(request.fromItem, request.itemCount),
          markPending: input.markPending,
        })
      )
        return;
      input.autoFollowEnabledRef.current = false;
      return;
    }
    if (input.activeHistoryWindow) {
      const request = getHistoryBoundaryWindowRequest(input.activeHistoryWindow, "newer");
      if (!request) return;
      const requestKey = `history:${request.fromTurn}:${request.turnCount}:${input.activeHistoryWindow.section_turn_count}:${input.activeHistoryWindow.visible_section_count}`;
      if (
        !admitSectionWindowRequest({
          direction: "newer",
          requestKey,
          pendingRequestKey: input.pendingRequestKeyRef.current,
          send: () =>
            input.requestHistoryWindow(
              request.fromTurn,
              request.turnCount,
              input.activeHistoryWindow!.section_turn_count,
              input.activeHistoryWindow!.visible_section_count,
            ),
          markPending: input.markPending,
        })
      )
        return;
      input.autoFollowEnabledRef.current = false;
      return;
    }
    if (input.nextSectionStartIndex == null) return;
    input.autoFollowEnabledRef.current = false;
    input.moveSectionWindow(
      input.nextSectionStartIndex === input.latestVisibleSectionStartIndex ? null : input.nextSectionStartIndex,
    );
  }, [
    input.activeHistoryWindow,
    input.activeThreadWindow,
    input.autoFollowEnabledRef,
    input.latestVisibleSectionStartIndex,
    input.markPending,
    input.moveSectionWindow,
    input.nextSectionStartIndex,
    input.normalizedThreadKey,
    input.pendingRequestKeyRef,
    input.requestHistoryWindow,
    input.requestThreadWindow,
  ]);

  return { handleLoadNewerSection, handleLoadOlderSection };
}
