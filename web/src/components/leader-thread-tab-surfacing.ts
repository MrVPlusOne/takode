import { useEffect, useRef } from "react";
import { canServerCandidateOpenThread, type LeaderOpenThreadTabsState } from "../../shared/leader-open-thread-tabs.js";
import type { ChatMessage } from "../types.js";
import {
  ALL_THREADS_KEY,
  MAIN_THREAD_KEY,
  isThreadAttachmentMarkerMessage,
  isThreadTransitionMarkerMessage,
  normalizeThreadKey,
} from "../utils/thread-projection.js";
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

type LeaderThreadTabSurfacingRow = {
  threadKey: string;
  status?: string;
  boardStatus?: string;
  boardRow?: { completedAt?: number };
  section?: string;
};

export function useLeaderThreadTabSurfacing({
  allMessages,
  transitionMessages = allMessages,
  authoritativeLeaderOpenThreadTabs,
  historyLoading,
  isLeaderSession,
  navigationThreadRows,
  openThreadTab,
  openThreadTabKeys,
  preview,
  questStatusByKey,
  selectedThreadKey,
  sessionId,
}: {
  allMessages: ChatMessage[];
  transitionMessages?: ChatMessage[];
  authoritativeLeaderOpenThreadTabs: LeaderOpenThreadTabsState | undefined;
  historyLoading: boolean;
  isLeaderSession: boolean;
  navigationThreadRows: ReadonlyArray<LeaderThreadTabSurfacingRow>;
  openThreadTab: OpenThreadTab;
  openThreadTabKeys: ReadonlyArray<string>;
  preview: boolean;
  questStatusByKey: ReadonlyMap<string, string | undefined>;
  selectedThreadKey: string;
  sessionId: string;
}) {
  const initializedAttachmentMarkerKeysRef = useRef(false);
  const baselineAttachmentMarkersAfterHistoryLoadRef = useRef(false);
  const observedAttachmentMarkerKeysRef = useRef<Set<string>>(new Set());
  const initializedTransitionMarkerKeysRef = useRef(false);
  const baselineTransitionMarkersAfterHistoryLoadRef = useRef(false);
  const observedTransitionMarkerKeysRef = useRef<Set<string>>(new Set());
  const observedTransitionTargetKeysRef = useRef<Set<string>>(new Set());
  const liveTransitionMarkerKeysDuringHistoryLoadRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    initializedAttachmentMarkerKeysRef.current = false;
    baselineAttachmentMarkersAfterHistoryLoadRef.current = false;
    observedAttachmentMarkerKeysRef.current = new Set();
    initializedTransitionMarkerKeysRef.current = false;
    baselineTransitionMarkersAfterHistoryLoadRef.current = false;
    observedTransitionMarkerKeysRef.current = new Set();
    observedTransitionTargetKeysRef.current = new Set();
    liveTransitionMarkerKeysDuringHistoryLoadRef.current = new Set();
  }, [sessionId]);

  useEffect(() => {
    if (!isLeaderSession || preview) return;
    if (historyLoading) {
      for (const message of transitionMessages) {
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
    for (const message of transitionMessages) {
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
      observedTransitionTargetKeysRef.current = unionTransitionTargetKeys(
        observedTransitionTargetKeysRef.current,
        markerMessages,
      );
      liveTransitionMarkerKeysDuringHistoryLoadRef.current = new Set();
      return;
    }

    if (unseenMarkers.length === 0 && carriedLiveMarkers.length === 0) {
      observedTransitionMarkerKeysRef.current = currentMarkerKeys;
      observedTransitionTargetKeysRef.current = unionTransitionTargetKeys(
        observedTransitionTargetKeysRef.current,
        markerMessages,
      );
      liveTransitionMarkerKeysDuringHistoryLoadRef.current = new Set();
      return;
    }

    const transitionMarkersToProcess = carriedLiveMarkers.length > 0 ? carriedLiveMarkers : unseenMarkers;
    const seenTransitionTargetKeys = new Set(observedTransitionTargetKeysRef.current);
    const selectedThread = normalizeThreadKey(selectedThreadKey || MAIN_THREAD_KEY);

    for (const message of transitionMarkersToProcess) {
      const marker = message.metadata?.threadTransitionMarker;
      if (!marker) continue;
      const targetThreadKey = normalizeThreadKey(marker.threadKey || marker.questId || "");
      if (!shouldPersistOpenThreadTab(targetThreadKey)) continue;
      if (seenTransitionTargetKeys.has(targetThreadKey)) continue;
      seenTransitionTargetKeys.add(targetThreadKey);
      if (marker.targetThreadFreshness !== "new_quest_thread") continue;
      const sourceThreadKey = normalizeThreadKey(marker.sourceThreadKey || marker.sourceQuestId || "");
      if (!transitionSourceCanSurfaceTab(sourceThreadKey)) continue;
      const sourceStillSelected = sourceThreadKey === selectedThread;
      if (!sourceStillSelected) continue;
      const transitionedAt = marker.transitionedAt || marker.timestamp;
      const wasOpen = openThreadTabKeys.includes(targetThreadKey);
      const targetCompleted = leaderThreadTargetHasExplicitCompletion({
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
    }

    observedTransitionMarkerKeysRef.current = currentMarkerKeys;
    observedTransitionTargetKeysRef.current = seenTransitionTargetKeys;
    initializedTransitionMarkerKeysRef.current = true;
    baselineTransitionMarkersAfterHistoryLoadRef.current = false;
    liveTransitionMarkerKeysDuringHistoryLoadRef.current = new Set();
  }, [
    allMessages,
    authoritativeLeaderOpenThreadTabs,
    historyLoading,
    isLeaderSession,
    navigationThreadRows,
    openThreadTab,
    openThreadTabKeys,
    preview,
    questStatusByKey,
    selectedThreadKey,
    sessionId,
    transitionMessages,
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
    }

    observedAttachmentMarkerKeysRef.current = currentMarkerKeys;
  }, [
    allMessages,
    authoritativeLeaderOpenThreadTabs,
    historyLoading,
    isLeaderSession,
    navigationThreadRows,
    openThreadTab,
    openThreadTabKeys,
    preview,
    questStatusByKey,
    sessionId,
  ]);
}

function transitionSourceCanSurfaceTab(sourceThreadKey: string): boolean {
  const normalized = normalizeThreadKey(sourceThreadKey);
  if (!normalized || normalized === ALL_THREADS_KEY) return false;
  return normalized === MAIN_THREAD_KEY || shouldPersistOpenThreadTab(normalized);
}

function threadTransitionMarkerKey(message: ChatMessage): string | null {
  const marker = message.metadata?.threadTransitionMarker;
  if (!marker) return null;
  return marker.markerKey || marker.id || message.id;
}

function threadTransitionTargetKey(message: ChatMessage): string | null {
  const marker = message.metadata?.threadTransitionMarker;
  if (!marker) return null;
  const targetThreadKey = normalizeThreadKey(marker.threadKey || marker.questId || "");
  return shouldPersistOpenThreadTab(targetThreadKey) ? targetThreadKey : null;
}

function unionTransitionTargetKeys(
  previousTargetKeys: ReadonlySet<string>,
  messages: ReadonlyArray<ChatMessage>,
): Set<string> {
  const nextTargetKeys = new Set(previousTargetKeys);
  for (const message of messages) {
    const targetThreadKey = threadTransitionTargetKey(message);
    if (targetThreadKey) nextTargetKeys.add(targetThreadKey);
  }
  return nextTargetKeys;
}

function threadAttachmentMarkerKey(message: ChatMessage): string | null {
  const marker = message.metadata?.threadAttachmentMarker;
  if (!marker) return null;
  return marker.markerKey || marker.id || message.id;
}

function leaderThreadTargetIsCompleted({
  threadKey,
  questStatusByKey,
  rows,
}: {
  threadKey: string;
  questStatusByKey: ReadonlyMap<string, string | undefined>;
  rows: ReadonlyArray<LeaderThreadTabSurfacingRow>;
}): boolean {
  const normalized = normalizeThreadKey(threadKey);
  if (isCompletedJourneyPresentationStatus(questStatusByKey.get(normalized))) return true;
  return leaderThreadRowIsCompleted(rows.find((row) => row.threadKey === normalized));
}

function leaderThreadTargetHasExplicitCompletion({
  threadKey,
  questStatusByKey,
  rows,
}: {
  threadKey: string;
  questStatusByKey: ReadonlyMap<string, string | undefined>;
  rows: ReadonlyArray<LeaderThreadTabSurfacingRow>;
}): boolean {
  const normalized = normalizeThreadKey(threadKey);
  if (isCompletedJourneyPresentationStatus(questStatusByKey.get(normalized))) return true;
  const row = rows.find((candidate) => candidate.threadKey === normalized);
  return !!row && questOrBoardRowIsCompleted(row.status, row.boardStatus, row.boardRow?.completedAt);
}

function leaderThreadRowIsCompleted(row?: LeaderThreadTabSurfacingRow): boolean {
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
