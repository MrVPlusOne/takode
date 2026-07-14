import { useEffect, useRef, type MutableRefObject } from "react";
import { canServerCandidateOpenThread, type LeaderOpenThreadTabsState } from "../../shared/leader-open-thread-tabs.js";
import type { ChatMessage } from "../types.js";
import { navigateToSessionThread } from "../utils/routing.js";
import {
  MAIN_THREAD_KEY,
  isThreadAttachmentMarkerMessage,
  isThreadTransitionMarkerMessage,
  normalizeThreadKey,
} from "../utils/thread-projection.js";
import { persistLeaderSelectedThreadKey, requestThreadViewportSnapshot } from "../utils/thread-viewport.js";
import { shouldPersistOpenThreadTab } from "../utils/leader-open-thread-tabs.js";
import { isCompletedJourneyPresentationStatus } from "./QuestJourneyTimeline.js";

type OpenThreadTab = (
  threadKey: string,
  options?: {
    intent?: "manual_select" | "external_route" | "server_candidate";
    eventAt?: number;
    placement?: "first" | "last";
    repositionExisting?: boolean;
  },
) => void;

type LeaderThreadAutoSwitchRow = {
  threadKey: string;
  status?: string;
  boardStatus?: string;
  boardRow?: { completedAt?: number };
  section?: string;
};

export function useLeaderThreadAutoSwitch({
  allMessages,
  authoritativeLeaderOpenThreadTabs,
  hasThreadRoute,
  historyLoading,
  isLeaderSession,
  lastManualThreadSelectionAtRef,
  navigationThreadRows,
  openThreadTab,
  openThreadTabKeys,
  preview,
  questStatusByKey,
  routeThreadKey,
  selectedThreadKey,
  sessionId,
  setSelectedThreadKey,
}: {
  allMessages: ChatMessage[];
  authoritativeLeaderOpenThreadTabs: LeaderOpenThreadTabsState | undefined;
  hasThreadRoute?: boolean;
  historyLoading: boolean;
  isLeaderSession: boolean;
  lastManualThreadSelectionAtRef: MutableRefObject<number>;
  navigationThreadRows: ReadonlyArray<LeaderThreadAutoSwitchRow>;
  openThreadTab: OpenThreadTab;
  openThreadTabKeys: ReadonlyArray<string>;
  preview: boolean;
  questStatusByKey: ReadonlyMap<string, string | undefined>;
  routeThreadKey?: string | null;
  selectedThreadKey: string;
  sessionId: string;
  setSelectedThreadKey: (threadKey: string) => void;
}) {
  const initializedAttachmentMarkerKeysRef = useRef(false);
  const baselineAttachmentMarkersAfterHistoryLoadRef = useRef(false);
  const observedAttachmentMarkerKeysRef = useRef<Set<string>>(new Set());
  const initializedTransitionMarkerKeysRef = useRef(false);
  const baselineTransitionMarkersAfterHistoryLoadRef = useRef(false);
  const observedTransitionMarkerKeysRef = useRef<Set<string>>(new Set());
  const liveTransitionMarkerKeysDuringHistoryLoadRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    initializedAttachmentMarkerKeysRef.current = false;
    baselineAttachmentMarkersAfterHistoryLoadRef.current = false;
    observedAttachmentMarkerKeysRef.current = new Set();
    initializedTransitionMarkerKeysRef.current = false;
    baselineTransitionMarkersAfterHistoryLoadRef.current = false;
    observedTransitionMarkerKeysRef.current = new Set();
    liveTransitionMarkerKeysDuringHistoryLoadRef.current = new Set();
  }, [sessionId]);

  useEffect(() => {
    if (!isLeaderSession || preview) return;
    if (historyLoading) {
      for (const message of allMessages) {
        if (!isThreadTransitionMarkerMessage(message)) continue;
        if (typeof message.historyIndex === "number" && message.historyIndex >= 0) continue;
        const markerKey = threadTransitionMarkerKey(message);
        if (markerKey) liveTransitionMarkerKeysDuringHistoryLoadRef.current.add(markerKey);
      }
      baselineTransitionMarkersAfterHistoryLoadRef.current = true;
      return;
    }

    const currentMarkerKeys = new Set<string>();
    const markerMessages: ChatMessage[] = [];
    const unseenMarkers: ChatMessage[] = [];
    for (const message of allMessages) {
      if (!isThreadTransitionMarkerMessage(message)) continue;
      const markerKey = threadTransitionMarkerKey(message);
      if (!markerKey) continue;
      markerMessages.push(message);
      currentMarkerKeys.add(markerKey);
      if (initializedTransitionMarkerKeysRef.current && !observedTransitionMarkerKeysRef.current.has(markerKey)) {
        unseenMarkers.push(message);
      }
    }

    const liveMarkerKeysFromLoading = liveTransitionMarkerKeysDuringHistoryLoadRef.current;
    const carriedLiveMarkers = markerMessages.filter((message) => {
      const markerKey = threadTransitionMarkerKey(message);
      if (!markerKey) return false;
      if (liveMarkerKeysFromLoading.has(markerKey)) return true;
      return typeof message.historyIndex === "number" && message.historyIndex < 0;
    });
    if (
      (!initializedTransitionMarkerKeysRef.current || baselineTransitionMarkersAfterHistoryLoadRef.current) &&
      carriedLiveMarkers.length === 0
    ) {
      initializedTransitionMarkerKeysRef.current = true;
      baselineTransitionMarkersAfterHistoryLoadRef.current = false;
      observedTransitionMarkerKeysRef.current = currentMarkerKeys;
      liveTransitionMarkerKeysDuringHistoryLoadRef.current = new Set();
      return;
    }

    if (unseenMarkers.length === 0 && carriedLiveMarkers.length === 0) {
      observedTransitionMarkerKeysRef.current = currentMarkerKeys;
      liveTransitionMarkerKeysDuringHistoryLoadRef.current = new Set();
      return;
    }

    const transitionMarkersToProcess = carriedLiveMarkers.length > 0 ? carriedLiveMarkers : unseenMarkers;
    let nextSelectedThreadKey: string | null = null;
    const selectedThread = normalizeThreadKey(selectedThreadKey || MAIN_THREAD_KEY);
    const routeAllowsAutoSelect = routeAllowsAutoSelectFromSelectedSource({
      hasThreadRoute,
      routeThreadKey,
      selectedThread,
    });

    for (const message of transitionMarkersToProcess) {
      const marker = message.metadata?.threadTransitionMarker;
      if (!marker) continue;
      if (marker.targetThreadFreshness !== "new_quest_thread") continue;
      const sourceThreadKey = normalizeThreadKey(marker.sourceThreadKey || marker.sourceQuestId || "");
      if (sourceThreadKey !== MAIN_THREAD_KEY) continue;
      const targetThreadKey = normalizeThreadKey(marker.threadKey || marker.questId || "");
      if (!shouldPersistOpenThreadTab(targetThreadKey)) continue;
      const transitionedAt = marker.transitionedAt || marker.timestamp;
      const wasOpen = openThreadTabKeys.includes(targetThreadKey);
      const targetCompleted = leaderThreadTargetIsCompleted({
        threadKey: targetThreadKey,
        questStatusByKey,
        rows: navigationThreadRows,
      });
      const canOpenCandidate =
        !targetCompleted &&
        canServerCandidateOpenThread(authoritativeLeaderOpenThreadTabs, targetThreadKey, transitionedAt);
      if (!wasOpen && canOpenCandidate) {
        openThreadTab(targetThreadKey, { intent: "server_candidate", eventAt: transitionedAt, placement: "first" });
      }

      const manualNavigationAfterTransition = lastManualThreadSelectionAtRef.current > transitionedAt;
      if (
        !nextSelectedThreadKey &&
        selectedThread === MAIN_THREAD_KEY &&
        routeAllowsAutoSelect &&
        canOpenCandidate &&
        !manualNavigationAfterTransition
      ) {
        nextSelectedThreadKey = targetThreadKey;
      }
    }

    observedTransitionMarkerKeysRef.current = currentMarkerKeys;
    initializedTransitionMarkerKeysRef.current = true;
    baselineTransitionMarkersAfterHistoryLoadRef.current = false;
    liveTransitionMarkerKeysDuringHistoryLoadRef.current = new Set();

    if (nextSelectedThreadKey && nextSelectedThreadKey !== selectedThread) {
      selectThreadFromMarker({ sessionId, preview, setSelectedThreadKey, threadKey: nextSelectedThreadKey });
    }
  }, [
    allMessages,
    authoritativeLeaderOpenThreadTabs,
    hasThreadRoute,
    historyLoading,
    isLeaderSession,
    lastManualThreadSelectionAtRef,
    navigationThreadRows,
    openThreadTab,
    openThreadTabKeys,
    preview,
    questStatusByKey,
    routeThreadKey,
    selectedThreadKey,
    sessionId,
    setSelectedThreadKey,
  ]);

  useEffect(() => {
    if (!isLeaderSession || preview) return;
    if (historyLoading) {
      baselineAttachmentMarkersAfterHistoryLoadRef.current = true;
      return;
    }

    const currentMarkerKeys = new Set<string>();
    const unseenMarkers: ChatMessage[] = [];
    for (const message of allMessages) {
      if (!isThreadAttachmentMarkerMessage(message)) continue;
      const markerKey = threadAttachmentMarkerKey(message);
      if (!markerKey) continue;
      currentMarkerKeys.add(markerKey);
      if (initializedAttachmentMarkerKeysRef.current && !observedAttachmentMarkerKeysRef.current.has(markerKey)) {
        unseenMarkers.push(message);
      }
    }

    if (!initializedAttachmentMarkerKeysRef.current || baselineAttachmentMarkersAfterHistoryLoadRef.current) {
      initializedAttachmentMarkerKeysRef.current = true;
      baselineAttachmentMarkersAfterHistoryLoadRef.current = false;
      observedAttachmentMarkerKeysRef.current = currentMarkerKeys;
      return;
    }

    if (unseenMarkers.length === 0) {
      observedAttachmentMarkerKeysRef.current = currentMarkerKeys;
      return;
    }

    let nextSelectedThreadKey: string | null = null;
    const selectedThread = normalizeThreadKey(selectedThreadKey || MAIN_THREAD_KEY);
    const routeAllowsAutoSelect = routeAllowsAutoSelectFromSelectedSource({
      hasThreadRoute,
      routeThreadKey,
      selectedThread,
    });

    for (const message of unseenMarkers) {
      const marker = message.metadata?.threadAttachmentMarker;
      if (!marker) continue;
      const targetThreadKey = normalizeThreadKey(marker.threadKey || marker.questId || "");
      if (!shouldPersistOpenThreadTab(targetThreadKey)) continue;

      const wasOpen = openThreadTabKeys.includes(targetThreadKey);
      const targetCompleted = leaderThreadTargetIsCompleted({
        threadKey: targetThreadKey,
        questStatusByKey,
        rows: navigationThreadRows,
      });
      const canOpenCandidate =
        !targetCompleted &&
        canServerCandidateOpenThread(authoritativeLeaderOpenThreadTabs, targetThreadKey, marker.attachedAt);
      const repositionExisting =
        canOpenCandidate &&
        shouldRepositionExistingOpenThreadFromEvent(
          authoritativeLeaderOpenThreadTabs,
          targetThreadKey,
          marker.attachedAt,
        );
      if (!wasOpen && canOpenCandidate) {
        openThreadTab(targetThreadKey, { intent: "server_candidate", eventAt: marker.attachedAt });
      } else if (repositionExisting) {
        openThreadTab(targetThreadKey, {
          intent: "server_candidate",
          eventAt: marker.attachedAt,
          repositionExisting: true,
        });
      }

      const manualNavigationAfterAttachment = lastManualThreadSelectionAtRef.current > marker.attachedAt;
      const sourceStillSelected = markerSourceMatchesSelectedThread(marker, selectedThread);
      const targetAvailableForAutoSelect = wasOpen || canOpenCandidate;
      if (
        !nextSelectedThreadKey &&
        sourceStillSelected &&
        routeAllowsAutoSelect &&
        targetAvailableForAutoSelect &&
        !manualNavigationAfterAttachment &&
        markerMovesNewestUserMessage(marker, allMessages)
      ) {
        nextSelectedThreadKey = targetThreadKey;
      }
    }

    observedAttachmentMarkerKeysRef.current = currentMarkerKeys;

    if (nextSelectedThreadKey && nextSelectedThreadKey !== selectedThread) {
      selectThreadFromMarker({ sessionId, preview, setSelectedThreadKey, threadKey: nextSelectedThreadKey });
    }
  }, [
    allMessages,
    authoritativeLeaderOpenThreadTabs,
    hasThreadRoute,
    historyLoading,
    isLeaderSession,
    lastManualThreadSelectionAtRef,
    navigationThreadRows,
    openThreadTab,
    openThreadTabKeys,
    preview,
    questStatusByKey,
    routeThreadKey,
    selectedThreadKey,
    sessionId,
    setSelectedThreadKey,
  ]);
}

function selectThreadFromMarker({
  preview,
  sessionId,
  setSelectedThreadKey,
  threadKey,
}: {
  preview: boolean;
  sessionId: string;
  setSelectedThreadKey: (threadKey: string) => void;
  threadKey: string;
}) {
  requestThreadViewportSnapshot(sessionId);
  if (!preview) {
    persistLeaderSelectedThreadKey(sessionId, threadKey);
  }
  setSelectedThreadKey(threadKey);
  if (!preview) {
    navigateToSessionThread(sessionId, threadKey);
  }
}

function routeAllowsAutoSelectFromSelectedSource({
  hasThreadRoute,
  routeThreadKey,
  selectedThread,
}: {
  hasThreadRoute?: boolean;
  routeThreadKey?: string | null;
  selectedThread: string;
}): boolean {
  const hasSpecificRouteThread =
    hasThreadRoute === true && routeThreadKey !== null && routeThreadKey !== undefined && routeThreadKey !== "";
  return !hasSpecificRouteThread || normalizeThreadKey(routeThreadKey ?? "") === selectedThread;
}

function threadTransitionMarkerKey(message: ChatMessage): string | null {
  const marker = message.metadata?.threadTransitionMarker;
  if (!marker) return null;
  return marker.markerKey || marker.id || message.id;
}

function threadAttachmentMarkerKey(message: ChatMessage): string | null {
  const marker = message.metadata?.threadAttachmentMarker;
  if (!marker) return null;
  return marker.markerKey || marker.id || message.id;
}

function markerIncludesMessage(
  marker: NonNullable<ChatMessage["metadata"]>["threadAttachmentMarker"],
  message: ChatMessage,
): boolean {
  if (!marker) return false;
  if (marker.messageIds.includes(message.id)) return true;
  return typeof message.historyIndex === "number" && marker.messageIndices.includes(message.historyIndex);
}

function newestUserAuthoredMessage(messages: ChatMessage[]): ChatMessage | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role === "user") return message;
  }
  return null;
}

function markerMovesNewestUserMessage(
  marker: NonNullable<ChatMessage["metadata"]>["threadAttachmentMarker"],
  messages: ChatMessage[],
): boolean {
  const newestUserMessage = newestUserAuthoredMessage(messages);
  return !!newestUserMessage && markerIncludesMessage(marker, newestUserMessage);
}

function markerSourceThreadKey(marker: NonNullable<ChatMessage["metadata"]>["threadAttachmentMarker"]): string | null {
  if (!marker) return null;
  const sourceThreadKey = normalizeThreadKey(marker.sourceThreadKey || marker.sourceQuestId || "");
  return sourceThreadKey || null;
}

function markerSourceMatchesSelectedThread(
  marker: NonNullable<ChatMessage["metadata"]>["threadAttachmentMarker"],
  selectedThreadKey: string,
): boolean {
  const selectedThread = normalizeThreadKey(selectedThreadKey || MAIN_THREAD_KEY);
  const sourceThreadKey = markerSourceThreadKey(marker);
  if (sourceThreadKey) return sourceThreadKey === selectedThread;
  return selectedThread === MAIN_THREAD_KEY;
}

function leaderThreadTargetIsCompleted({
  threadKey,
  questStatusByKey,
  rows,
}: {
  threadKey: string;
  questStatusByKey: ReadonlyMap<string, string | undefined>;
  rows: ReadonlyArray<LeaderThreadAutoSwitchRow>;
}): boolean {
  const normalized = normalizeThreadKey(threadKey);
  if (isCompletedJourneyPresentationStatus(questStatusByKey.get(normalized))) return true;
  return leaderThreadRowIsCompleted(rows.find((row) => row.threadKey === normalized));
}

function leaderThreadRowIsCompleted(row?: LeaderThreadAutoSwitchRow): boolean {
  if (!row) return false;
  if (questOrBoardRowIsCompleted(row.status, row.boardStatus, row.boardRow?.completedAt)) return true;
  const hasExplicitStatus =
    row.status !== undefined || row.boardStatus !== undefined || row.boardRow?.completedAt !== undefined;
  return row.section === "done" && !hasExplicitStatus;
}

function questOrBoardRowIsCompleted(questStatus?: string, boardRowStatus?: string, completedAt?: number): boolean {
  return (
    completedAt !== undefined ||
    isCompletedJourneyPresentationStatus(questStatus) ||
    isCompletedJourneyPresentationStatus(boardRowStatus)
  );
}

function shouldRepositionExistingOpenThreadFromEvent(
  state: LeaderOpenThreadTabsState | undefined,
  threadKey: string,
  eventAt: number | undefined,
): boolean {
  if (!state || typeof eventAt !== "number" || !Number.isFinite(eventAt)) return false;
  const normalized = normalizeThreadKey(threadKey);
  return state.orderedOpenThreadKeys.includes(normalized) && eventAt > state.updatedAt;
}
