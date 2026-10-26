import { useMemo, useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { LeaderTopicPanel } from "./library/TopicSidePanel.js";
import { useTopicSheetOpen } from "../utils/topic-panel.js";
import {
  TopicConversationHeader,
  TopicEntryContext,
  TopicEntryLine,
  useTopicConversation,
} from "./library/TopicConversation.js";
import { TopicFeedContext, type TopicFeed } from "./topic-feed.js";
import { closeTopicConversation, openTopicConversation, useTopicConversationTab } from "../utils/topic-conversation.js";
import { landZoom, prepareZoom } from "./topic-zoom.js";
import { topicThreadKey } from "../../shared/topic-thread-key.js";
import { useDesktopShellLayout } from "../hooks/useDesktopShellLayout.js";
import { usePendingAction } from "../hooks/usePendingAction.js";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "../store.js";
import { api } from "../api.js";
import { connectSession, sendToSession } from "../ws.js";
import { MessageFeed } from "./MessageFeed.js";
import { StartedQuestsProvider } from "./QuestForkLinks.js";
import { useSideQuestOf } from "./SideQuestCue.js";
import { Composer } from "./Composer.js";
import { ComposerFeedLayout } from "./ComposerFeedLayout.js";
import { SideChatPanel } from "./SideChatPanel.js";
import {
  PermissionBanner,
  PlanReviewOverlay,
  PlanCollapsedChip,
  PermissionsCollapsedChip,
} from "./PermissionBanner.js";
import { TaskOutlineBar } from "./TaskOutlineBar.js";
import { TodoStatusLine } from "./TodoStatusLine.js";
import { WorkBoardBar, type WorkBoardThreadNavigationRow } from "./WorkBoardBar.js";
import { YarnBallDot } from "./CatIcons.js";
import { SearchBar } from "./SearchBar.js";
import { useSessionSearch } from "../hooks/useSessionSearch.js";
import {
  hasMessageDeepLinkFromHash,
  historyEntryShowsMainThread,
  markHistoryEntryShowsMainThread,
  navigateToSessionMessageId,
  navigateToSessionThread,
  parseHash,
  threadRouteFromHash,
} from "../utils/routing.js";
import { CLOSE_THREAD_TAB_EVENT } from "../utils/attention-item-menu.js";
import { firstUnreadResult, resultLanding } from "../utils/notification-navigation.js";
import type { BoardRowData } from "./BoardTable.js";
import { isCompletedJourneyPresentationStatus } from "./QuestJourneyTimeline.js";
import { ModelProvenanceMigrationBanner } from "./ModelProvenanceMigrationBanner.js";
import { HostOfflineBanner } from "./HostBadge.js";
import {
  buildLeaderThreadRowsFromSummaries,
  collectLeaderThreadSummaries,
  mergeLeaderThreadSummaries,
} from "../../shared/leader-projection.js";
import { ALL_THREADS_KEY, MAIN_THREAD_KEY, normalizeThreadKey } from "../utils/thread-projection.js";
import { resolveNotificationOwnerThreadKey } from "../utils/notification-thread.js";
import {
  markLeaderThreadDisplayed,
  persistLeaderSelectedThreadKey,
  readLeaderSelectedThreadKey,
  requestThreadViewportSnapshot,
} from "../utils/thread-viewport.js";
import { ViewportHandoffThreadEntryGate } from "./ViewportHandoffEntryGate.js";
import { useThreadReadOnScreen } from "../hooks/use-thread-read-on-screen.js";
import { createViewportHandoffEntryId, noteViewportSelectionActivity } from "../utils/viewport-handoff-client.js";
import { resolveInitialLeaderThreadKey } from "../utils/initial-leader-thread.js";
import { applyCanonicalQuestTitles, buildCanonicalQuestTitleIndex } from "../utils/quest-title-index.js";
import {
  buildAttentionRecords,
  isAttentionRecordActive,
  parseQuestIdsFromReviewSummary,
} from "../utils/attention-records.js";
import {
  beginThreadNavigationTiming,
  markColdReplayFlushCommitted,
  markThreadNavigationCommitted,
} from "../utils/frontend-perf-recorder.js";
import { readOpenThreadTabKeys } from "../utils/leader-open-thread-tabs.js";
import {
  placeLeaderOpenThreadTabKey,
  shouldPersistLeaderThreadTab,
  type LeaderOpenThreadTabsState,
  type LeaderThreadTabUpdate,
} from "../../shared/leader-open-thread-tabs.js";
import {
  getLiveSessionConnectionStatus,
  getRecoverableSessionConnectionPresentation,
} from "../utils/recoverable-session-connection.js";
import { QuestThreadBanner } from "./QuestThreadBanner.js";
import { SessionDiffBanner } from "./DiffChip.js";
import { buildSessionQuestBannerRow, type QuestThreadBannerRow } from "../utils/session-quest-banner-row.js";
import { resolveChatSessionNavigationSummary } from "../utils/chat-session-navigation-summary.js";
export { resolveChatSessionNavigationSummary } from "../utils/chat-session-navigation-summary.js";
import {
  projectedLeaderOpenThreadTabs,
  resolveLeaderThreadTabsProjection,
} from "../utils/leader-thread-tabs-resolver.js";
import { mergeProjectedLeaderThreadRows } from "../utils/leader-thread-tabs-navigation.js";
import { useLeaderOpenThreadTabStateSync } from "../hooks/use-leader-open-thread-tab-state-sync.js";
import { playStripClose } from "./quest-strip-close-animation.js";
import { recordViewedTab } from "../utils/view-history.js";
import type {
  ChatMessage,
  LeaderProjectionSnapshot,
  QuestTitlePreview,
  QuestmasterTask,
  SessionAttentionRecord,
  SessionNotification,
  SessionState,
  SideChatRecord,
} from "../types.js";

type LeaderThreadRow = QuestThreadBannerRow & {
  messageCount: number;
  createdAt: number;
  lastActiveAt?: number;
};

const EMPTY_BOARD_ROWS: BoardRowData[] = [];
const EMPTY_MESSAGES: ChatMessage[] = [];
const EMPTY_ATTENTION_RECORDS: SessionAttentionRecord[] = [];
const EMPTY_SIDE_CHATS: Record<string, SideChatRecord> = {};
const EMPTY_QUEST_DETAILS = new Map<string, QuestmasterTask>();
const EMPTY_QUEST_TITLE_PREVIEWS = new Map<string, QuestTitlePreview | null>();

export function reviewNotificationIdsForSelectedThread(
  notifications: ReadonlyArray<SessionNotification> | undefined,
  attentionRecords: ReadonlyArray<SessionAttentionRecord>,
  selectedThreadKey: string,
): string[] {
  const selected = normalizeThreadKey(selectedThreadKey || MAIN_THREAD_KEY);
  if (selected === ALL_THREADS_KEY) return [];

  const effectiveThreadsByNotificationId = new Map<string, Set<string>>();
  for (const record of attentionRecords) {
    if (record.priority !== "review" || record.source.kind !== "notification" || !record.source.id) continue;
    if (!isAttentionRecordActive(record)) continue;
    const threadKey = normalizeThreadKey(record.route.threadKey || record.threadKey);
    const threads = effectiveThreadsByNotificationId.get(record.source.id) ?? new Set<string>();
    threads.add(threadKey);
    effectiveThreadsByNotificationId.set(record.source.id, threads);
  }

  const ids: string[] = [];
  for (const notification of notifications ?? []) {
    if (notification.done || notification.category !== "review") continue;
    const parsedMultiQuestThreads = parseQuestIdsFromReviewSummary(notification.summary);
    const effectiveThreads =
      parsedMultiQuestThreads.length > 1
        ? new Set(parsedMultiQuestThreads.map((threadKey) => normalizeThreadKey(threadKey)))
        : effectiveThreadsByNotificationId.get(notification.id);
    if (
      effectiveThreads ? !effectiveThreads.has(selected) : resolveNotificationOwnerThreadKey(notification) !== selected
    ) {
      continue;
    }
    ids.push(notification.id);
  }
  return ids;
}

type LiveConnectionStatusBannerProps = {
  status:
    | "starting"
    | "broken"
    | "recovery-suppressed"
    | "cli-disconnected"
    | "websocket-disconnected"
    | "server-unreachable";
  backendState?: string;
  backendError?: string | null;
  reconnectProgress?: SessionState["backend_reconnect"];
  hasEverConnected?: boolean;
  idlePaused?: boolean;
  isResumeMissingRolloutError?: boolean;
  onRelaunch?: () => Promise<unknown>;
};

function LiveConnectionStatusBanner({
  status,
  backendState,
  backendError,
  reconnectProgress,
  hasEverConnected = false,
  idlePaused = false,
  isResumeMissingRolloutError = false,
  onRelaunch,
}: LiveConnectionStatusBannerProps) {
  const relaunch = usePendingAction("Relaunch failed.");
  const isWarning = status === "server-unreachable" || status === "broken" || status === "recovery-suppressed";
  const message =
    status === "server-unreachable"
      ? "Server unreachable"
      : status === "websocket-disconnected"
        ? "Reconnecting to session..."
        : status === "recovery-suppressed"
          ? (backendError ?? "Automatic recovery is paused. Reconnect to start a fresh cycle.")
          : status === "broken"
            ? (backendError ?? "CLI failed to recover. Relaunch to resume queued messages.")
            : status === "cli-disconnected"
              ? idlePaused
                ? "Session paused to stay within keep-alive limit"
                : "Keep working here. Takode reconnects when delivery needs the backend."
              : backendState === "recovering"
                ? reconnectProgress
                  ? `Reconnecting (${reconnectProgress.attempt}/${reconnectProgress.maxAttempts})...`
                  : "Recovering session..."
                : backendState === "resuming" || hasEverConnected
                  ? "Reconnecting session..."
                  : "Starting session...";

  return (
    <div
      data-testid="live-connection-status-banner"
      role="status"
      aria-live="polite"
      className={`shrink-0 border-t px-3 py-2 sm:px-4 ${
        isWarning ? "border-cc-warning/25 bg-cc-warning/10" : "border-cc-border bg-cc-border/30"
      }`}
    >
      <div className="mx-auto flex max-w-3xl items-center justify-center gap-2 text-center sm:gap-3">
        {status === "starting" ? (
          <svg
            className="h-3 w-3 shrink-0 animate-spin text-cc-text-secondary"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        ) : (
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${isWarning ? "bg-cc-warning animate-pulse" : "bg-cc-muted"}`}
            aria-hidden="true"
          />
        )}
        <span className={`min-w-0 text-xs font-medium ${isWarning ? "text-cc-warning" : "text-cc-text-secondary"}`}>
          {message}
        </span>
        {(status === "broken" || status === "recovery-suppressed" || status === "cli-disconnected") && onRelaunch && (
          <button
            type="button"
            onClick={() => void relaunch.run(onRelaunch)}
            aria-busy={relaunch.pending || undefined}
            className={`shrink-0 rounded-md px-3 py-1 text-xs font-medium transition-colors cursor-pointer ${
              isWarning
                ? "bg-cc-warning/20 text-cc-warning hover:bg-cc-warning/30"
                : "bg-cc-hover text-cc-fg hover:bg-cc-border"
            }`}
          >
            {status === "broken" && isResumeMissingRolloutError
              ? "Start Fresh"
              : status === "broken"
                ? "Relaunch"
                : status === "recovery-suppressed"
                  ? "Reconnect"
                  : "Resume"}
          </button>
        )}
      </div>
    </div>
  );
}

function CompactingIndicator({ sessionId }: { sessionId: string }) {
  const sessionStatus = useStore((s) => s.sessionStatus.get(sessionId));
  if (sessionStatus !== "compacting") return null;
  return (
    <div className="shrink-0 flex items-center gap-1.5 text-[11px] text-cc-muted font-mono-code px-4 py-1">
      <YarnBallDot className="text-cc-primary animate-pulse" />
      <span>Compacting conversation...</span>
    </div>
  );
}

function messageSummariesAfterProjection(messages: ChatMessage[], projection?: LeaderProjectionSnapshot) {
  if (!projection) return collectLeaderThreadSummaries(messages);
  return collectLeaderThreadSummaries(
    messages.filter((message) => {
      if (typeof message.historyIndex !== "number") return true;
      if (message.historyIndex < 0) return true;
      return message.historyIndex >= projection.sourceHistoryLength;
    }),
  );
}

function useLeaderThreadModel(sessionId: string, deferMessageDerivedRows = false) {
  const activeBoard = useStore((s) => s.sessionBoards.get(sessionId) ?? EMPTY_BOARD_ROWS);
  const completedBoard = useStore((s) => s.sessionCompletedBoards.get(sessionId) ?? EMPTY_BOARD_ROWS);
  const storedMessages = useStore((s) => s.messages.get(sessionId) ?? EMPTY_MESSAGES);
  const leaderProjection = useStore((s) => s.leaderProjections.get(sessionId));
  const messages = deferMessageDerivedRows ? EMPTY_MESSAGES : storedMessages;
  const quests = useStore((s) => s.quests);
  const rowSessionStatuses = useStore((s) => s.sessionBoardRowStatuses.get(sessionId));
  const threadSummaries = useMemo(() => {
    const projected = leaderProjection?.threadSummaries ?? [];
    if (deferMessageDerivedRows) return projected;
    return mergeLeaderThreadSummaries(projected, messageSummariesAfterProjection(messages, leaderProjection));
  }, [deferMessageDerivedRows, leaderProjection, messages]);
  const rows = useMemo(
    () =>
      buildLeaderThreadRowsFromSummaries({
        activeBoard,
        completedBoard,
        threadSummaries,
        quests,
        rowSessionStatuses,
      }).map((row) => ({ ...row, leaderSessionId: sessionId })) as LeaderThreadRow[],
    [activeBoard, completedBoard, quests, rowSessionStatuses, sessionId, threadSummaries],
  );
  const activeRows = useMemo(() => rows.filter((row) => row.section === "active"), [rows]);
  const doneRows = useMemo(() => rows.filter((row) => row.section === "done"), [rows]);
  return {
    activeBoard,
    completedBoard,
    leaderProjection,
    messages,
    rawMessages: storedMessages,
    rows,
    activeRows,
    doneRows,
  };
}

function threadTitleForTranscription(threadKey: string, rows: LeaderThreadRow[]): string | undefined {
  const normalized = threadKey.toLowerCase();
  if (normalized === MAIN_THREAD_KEY) return "Main Thread";
  if (normalized === ALL_THREADS_KEY) return "All Threads";
  const row = rows.find((candidate) => candidate.threadKey === normalized);
  if (!row) return undefined;
  if (row.questId && row.title) return `${row.questId}: ${row.title}`;
  return row.title || row.questId;
}

function toWorkBoardThreadRows(rows: LeaderThreadRow[]): WorkBoardThreadNavigationRow[] {
  return rows.map((row) => ({
    threadKey: row.threadKey,
    questId: row.questId,
    title: row.title,
    status: row.status,
    boardStatus: row.boardStatus,
    messageCount: row.messageCount,
    section: row.section,
    lastActiveAt: row.lastActiveAt,
  }));
}

function isQuestThreadKey(threadKey: string): boolean {
  return /^q-\d+$/i.test(threadKey.trim());
}

function composeThreadKeyForSelection(threadKey: string): string {
  const normalized = threadKey.trim().toLowerCase();
  if (normalized === ALL_THREADS_KEY) return MAIN_THREAD_KEY;
  return normalized;
}

function isAvailableLeaderThread(
  threadKey: string,
  rows: LeaderThreadRow[],
  openThreadKeys: ReadonlyArray<string> = [],
): boolean {
  const normalized = normalizeThreadKey(threadKey);
  if (normalized === MAIN_THREAD_KEY || normalized === ALL_THREADS_KEY) return true;
  return (
    rows.some((row) => row.threadKey === normalized) ||
    openThreadKeys.some((key) => normalizeThreadKey(key) === normalized)
  );
}

function questOrBoardRowIsCompleted(questStatus?: string, boardRowStatus?: string, completedAt?: number): boolean {
  return (
    completedAt !== undefined ||
    isCompletedJourneyPresentationStatus(questStatus) ||
    isCompletedJourneyPresentationStatus(boardRowStatus)
  );
}

function restorableSelectedThreadKey({
  threadKey,
  authoritativeLeaderOpenThreadTabs,
  openThreadTabKeys,
  rows,
}: {
  threadKey: string | null;
  authoritativeLeaderOpenThreadTabs: LeaderOpenThreadTabsState | null | undefined;
  openThreadTabKeys: ReadonlyArray<string>;
  rows: LeaderThreadRow[];
}): string | null {
  if (!threadKey) return null;
  const normalized = normalizeThreadKey(threadKey);
  if (normalized === MAIN_THREAD_KEY || normalized === ALL_THREADS_KEY) return normalized;
  if (!shouldPersistLeaderThreadTab(normalized)) return null;
  if (openThreadTabKeys.includes(normalized)) return normalized;
  if (authoritativeLeaderOpenThreadTabs) return null;
  return isAvailableLeaderThread(normalized, rows) ? normalized : null;
}

function stringArraysEqual(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

type OpenThreadTabOptions = {
  repositionExisting?: boolean;
};

function shouldRepairRouteThreadOrder({
  lastProcessedRouteThreadKey,
  localSelectionRoute,
  threadKey,
}: {
  lastProcessedRouteThreadKey: string | null;
  localSelectionRoute: boolean;
  threadKey: string;
}): boolean {
  return !localSelectionRoute && lastProcessedRouteThreadKey !== normalizeThreadKey(threadKey);
}

export function ChatView({
  sessionId,
  preview = false,
  routeThreadKey,
  hasThreadRoute,
  viewportHandoffThreadEntryScopeId,
}: {
  sessionId: string;
  preview?: boolean;
  routeThreadKey?: string | null;
  hasThreadRoute?: boolean;
  viewportHandoffThreadEntryScopeId?: string;
}) {
  const unarchive = usePendingAction("Unarchive failed.");
  const {
    sessionPerms,
    connStatus,
    backendState,
    backendReconnect,
    backendError,
    cliConnected,
    cliEverConnected,
    cliDisconnectReason,
    launcherState,
    isArchived,
    serverReachable,
    isLeaderSession,
    sessionMetadataKnown,
    historyLoading,
    hasKnownThreadSources,
    sessionNum,
    claimedQuestId,
    claimedQuestTitle,
    claimedQuestStatus,
    claimedQuestLeaderSessionId,
    herdedBy,
    modelProvenanceMigration,
    authoritativeLeaderOpenThreadTabs,
    leaderTabsProjection,
    slackThreads,
    cachedThreadWindows,
  } = useStore(
    useShallow((s) => {
      const sessionState = s.sessions.get(sessionId);
      const sdkSession = s.sdkSessions.find((sdk) => sdk.sessionId === sessionId);
      const navigationSummary = resolveChatSessionNavigationSummary(s, sessionId);
      const tabsProjection = resolveLeaderThreadTabsProjection(s, sessionId);
      return {
        sessionPerms: s.pendingPermissions.get(sessionId),
        connStatus: s.connectionStatus.get(sessionId) ?? "disconnected",
        backendState: sessionState?.backend_state ?? "disconnected",
        backendReconnect: sessionState?.backend_reconnect ?? null,
        backendError: sessionState?.backend_error ?? null,
        cliConnected: s.cliConnected.get(sessionId) ?? false,
        cliEverConnected: s.cliEverConnected.get(sessionId) ?? false,
        cliDisconnectReason: s.cliDisconnectReason.get(sessionId) ?? null,
        launcherState: sdkSession?.state,
        isArchived: sdkSession?.archived ?? false,
        serverReachable: s.serverReachable,
        isLeaderSession: tabsProjection.projectionState === "accepted" || navigationSummary.isLeaderSession,
        sessionMetadataKnown: Boolean(sessionState || sdkSession),
        historyLoading: s.historyLoading.get(sessionId) ?? false,
        hasKnownThreadSources:
          s.messages.has(sessionId) ||
          s.leaderProjections.has(sessionId) ||
          tabsProjection.projectionState === "accepted" ||
          s.sessionBoards.has(sessionId) ||
          s.sessionCompletedBoards.has(sessionId),
        claimedQuestId: navigationSummary.claimedQuestId,
        sessionNum: navigationSummary.sessionNum,
        claimedQuestTitle: navigationSummary.claimedQuestTitle,
        claimedQuestStatus: navigationSummary.claimedQuestStatus,
        claimedQuestLeaderSessionId: navigationSummary.claimedQuestLeaderSessionId,
        herdedBy: navigationSummary.herdedBy,
        modelProvenanceMigration: sessionState?.modelProvenanceMigration ?? sdkSession?.modelProvenanceMigration,
        authoritativeLeaderOpenThreadTabs: projectedLeaderOpenThreadTabs(tabsProjection),
        leaderTabsProjection: tabsProjection.projectionState === "accepted" ? tabsProjection.value : null,
        slackThreads: sessionState?.slackThreads ?? EMPTY_SIDE_CHATS,
        cachedThreadWindows: s.threadWindows?.get(sessionId),
      };
    }),
  );
  const [selectedThreadKey, setSelectedThreadKey] = useState(() =>
    resolveInitialLeaderThreadKey({
      sessionId,
      isLeaderSession,
      hasThreadRoute,
      routeThreadKey,
      leaderOpenThreadTabs: authoritativeLeaderOpenThreadTabs,
    }),
  );
  const selectedThreadKeyRef = useRef(selectedThreadKey);
  selectedThreadKeyRef.current = selectedThreadKey;
  const generatedViewportHandoffThreadEntryScopeId = useMemo(createViewportHandoffEntryId, [sessionId]);
  const viewportHandoffThreadEntryScope =
    viewportHandoffThreadEntryScopeId ?? generatedViewportHandoffThreadEntryScopeId;
  const normalizedViewportHandoffThreadKey = normalizeThreadKey(isLeaderSession ? selectedThreadKey : MAIN_THREAD_KEY);
  const viewportHandoffThreadEntryRef = useRef({
    scopeId: viewportHandoffThreadEntryScope,
    threadKey: normalizedViewportHandoffThreadKey,
    entryId: `${viewportHandoffThreadEntryScope}:${normalizedViewportHandoffThreadKey}`,
  });
  if (viewportHandoffThreadEntryRef.current.scopeId !== viewportHandoffThreadEntryScope) {
    viewportHandoffThreadEntryRef.current = {
      scopeId: viewportHandoffThreadEntryScope,
      threadKey: normalizedViewportHandoffThreadKey,
      entryId: `${viewportHandoffThreadEntryScope}:${normalizedViewportHandoffThreadKey}`,
    };
  } else if (viewportHandoffThreadEntryRef.current.threadKey !== normalizedViewportHandoffThreadKey) {
    viewportHandoffThreadEntryRef.current = {
      scopeId: viewportHandoffThreadEntryScope,
      threadKey: normalizedViewportHandoffThreadKey,
      entryId: `${viewportHandoffThreadEntryScope}:${normalizedViewportHandoffThreadKey}:${createViewportHandoffEntryId()}`,
    };
  }
  const passiveRestoreThreadKeyRef = useRef(hasThreadRoute ? null : readLeaderSelectedThreadKey(sessionId));
  const wasLeaderSessionRef = useRef(isLeaderSession);
  if (isLeaderSession) wasLeaderSessionRef.current = true;
  useLayoutEffect(
    () => () => {
      if (wasLeaderSessionRef.current && !preview) {
        persistLeaderSelectedThreadKey(sessionId, selectedThreadKeyRef.current);
      }
    },
    [preview, sessionId],
  );
  const [selectedSideChatId, setSelectedSideChatId] = useState<string | null>(null);
  const desktopShell = useDesktopShellLayout();
  // On a phone the open topic panel starts right under the tabs: the thread's strips step aside.
  const phoneTopicsOpen = useTopicSheetOpen(sessionId) && !desktopShell && !preview;
  const selectedSideChat = selectedSideChatId ? slackThreads[selectedSideChatId] : undefined;

  useLayoutEffect(() => {
    if (!isLeaderSession) return;
    markThreadNavigationCommitted(sessionId, normalizeThreadKey(selectedThreadKey));
  }, [isLeaderSession, selectedThreadKey, sessionId]);

  useLayoutEffect(() => {
    markColdReplayFlushCommitted(sessionId);
  });

  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { sessionId?: string; sideChatId?: string; threadId?: string; childSessionId?: string }
        | undefined;
      const sideChatId = detail?.sideChatId ?? detail?.threadId;
      if (detail?.sessionId !== sessionId || !sideChatId) return;
      useStore.getState().closeCodexSubagentInspector();
      setSelectedSideChatId(sideChatId);
      if (detail.childSessionId) connectSession(detail.childSessionId);
    };
    window.addEventListener("takode:open-side-chat", onOpen);
    window.addEventListener("takode:open-slack-thread", onOpen);
    return () => {
      window.removeEventListener("takode:open-side-chat", onOpen);
      window.removeEventListener("takode:open-slack-thread", onOpen);
    };
  }, [sessionId]);

  useEffect(() => {
    if (selectedSideChat?.childSessionId) connectSession(selectedSideChat.childSessionId);
  }, [selectedSideChat?.childSessionId]);

  const codexSubagentInspectorOpen = useStore((state) => state.codexSubagentInspector?.sessionId === sessionId);
  useEffect(() => {
    if (codexSubagentInspectorOpen) setSelectedSideChatId(null);
  }, [codexSubagentInspectorOpen]);
  const [openThreadTabKeys, setOpenThreadTabKeys] = useState(() => {
    if (!isLeaderSession) return [];
    if (leaderTabsProjection?.tabState === null) return readOpenThreadTabKeys(sessionId);
    return authoritativeLeaderOpenThreadTabs?.orderedOpenThreadKeys ?? [];
  });
  const openThreadTabKeysRef = useRef(openThreadTabKeys);
  const titleHydrationConnectionStatusRef = useRef<typeof connStatus | null>(null);
  const {
    activeBoard,
    completedBoard,
    leaderProjection,
    messages: allMessages,
    rawMessages: allRawMessages,
    rows: threadRows,
  } = useLeaderThreadModel(sessionId, historyLoading);
  const sessionNotifications = useStore((s) => s.sessionNotifications.get(sessionId));
  const persistedAttentionRecords = useStore((s) => s.sessionAttentionRecords.get(sessionId));
  const quests = useStore((s) => s.quests);
  const questDetails = useStore((s) => s.questDetails ?? EMPTY_QUEST_DETAILS);
  const questTitlePreviews = useStore((s) => s.questTitlePreviews ?? EMPTY_QUEST_TITLE_PREVIEWS);
  const hydrateQuestTitles = useStore((s) => s.hydrateQuestTitles);
  const canonicalQuestTitles = useMemo(
    () => buildCanonicalQuestTitleIndex({ quests, questDetails, questTitlePreviews }),
    [questDetails, questTitlePreviews, quests],
  );
  const allSessionBoards = useStore((s) => s.sessionBoards);
  const allSessionCompletedBoards = useStore((s) => s.sessionCompletedBoards);
  const allSessionBoardRowStatuses = useStore((s) => s.sessionBoardRowStatuses);
  const routeSyncEnabled = hasThreadRoute !== undefined || routeThreadKey !== undefined;

  // Feeds the navigation history list: the session on screen, and for leaders the tab it shows.
  useEffect(() => {
    if (preview || !routeSyncEnabled || !sessionMetadataKnown) return;
    recordViewedTab(sessionId, isLeaderSession ? normalizeThreadKey(selectedThreadKey) : null);
  }, [isLeaderSession, preview, routeSyncEnabled, selectedThreadKey, sessionId, sessionMetadataKnown]);
  const showQuestThreadBanner =
    isLeaderSession &&
    selectedThreadKey.toLowerCase() !== MAIN_THREAD_KEY &&
    selectedThreadKey.toLowerCase() !== ALL_THREADS_KEY &&
    isQuestThreadKey(selectedThreadKey);
  // A quest tab can show its whole topic as one conversation.
  const topicFeedFor = useTopicConversationTab(sessionId);
  const topicConversation = useTopicConversation(sessionId, showQuestThreadBanner && !preview ? selectedThreadKey : "");
  const topicFeedOn = !!topicConversation && topicFeedFor === selectedThreadKey.toLowerCase();
  const feedThreadKey = topicFeedOn ? topicThreadKey(topicConversation.questIds) : selectedThreadKey;
  // Zooming between the quest and its topic keeps the reader's place and plays the zoom, once the
  // new feed is on screen.
  const zoomColumnRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => landZoom(sessionId, feedThreadKey, zoomColumnRef.current), [sessionId, feedThreadKey]);
  const zoomOutToTopic = useCallback(() => {
    if (!topicConversation) return;
    prepareZoom(sessionId, topicThreadKey(topicConversation.questIds), "out", { feedKey: selectedThreadKey });
    openTopicConversation(sessionId, selectedThreadKey);
  }, [sessionId, selectedThreadKey, topicConversation]);

  // Reconnects and handoff refetches request the window of the feed on screen, which the saved
  // selection does not always match: a topic conversation shows its topic's window, not its tab's
  // quest alone, so coming back after messages arrived elsewhere in the topic refreshes it too.
  useLayoutEffect(() => {
    if (!isLeaderSession || preview) return;
    return markLeaderThreadDisplayed(sessionId, feedThreadKey);
  }, [isLeaderSession, preview, feedThreadKey, sessionId]);
  const feedTopicEntry = useMemo(
    () =>
      topicConversation && !topicFeedOn
        ? {
            name: topicConversation.name,
            count: topicConversation.questIds.length,
            onOpen: zoomOutToTopic,
          }
        : null,
    [topicConversation, topicFeedOn, zoomOutToTopic],
  );
  // Set once handleSelectThread exists, below.
  const openTopicQuestRef = useRef<(questId: string, part?: HTMLElement | null) => void>(() => {});
  const topicFeed = useMemo<TopicFeed | null>(
    () =>
      topicFeedOn
        ? {
            questIds: topicConversation.questIds,
            openQuest: (questId: string, part?: HTMLElement | null) => openTopicQuestRef.current(questId, part),
          }
        : null,
    [topicFeedOn, topicConversation],
  );
  const selectedSideQuestOf = useSideQuestOf(showQuestThreadBanner ? sessionId : undefined, selectedThreadKey);
  const sessionQuestBannerRow = useMemo(
    () =>
      !isLeaderSession
        ? buildSessionQuestBannerRow({
            sessionId,
            sessionNum,
            claimedQuestId,
            claimedQuestTitle,
            claimedQuestStatus,
            claimedQuestLeaderSessionId,
            herdedBy,
            quests,
            sessionBoards: allSessionBoards,
            sessionCompletedBoards: allSessionCompletedBoards,
            rowStatuses: allSessionBoardRowStatuses,
          })
        : null,
    [
      allSessionBoardRowStatuses,
      allSessionBoards,
      allSessionCompletedBoards,
      claimedQuestId,
      claimedQuestLeaderSessionId,
      claimedQuestStatus,
      claimedQuestTitle,
      herdedBy,
      isLeaderSession,
      quests,
      sessionId,
      sessionNum,
    ],
  );
  const composerThreadKey = isLeaderSession ? composeThreadKeyForSelection(selectedThreadKey) : MAIN_THREAD_KEY;
  const composerQuestId = isLeaderSession && isQuestThreadKey(composerThreadKey) ? composerThreadKey : undefined;
  const reviewAttentionRecords = useMemo(
    () =>
      isLeaderSession
        ? buildAttentionRecords({
            leaderSessionId: sessionId,
            records: [...(persistedAttentionRecords ?? []), ...(leaderProjection?.messageAttentionRecords ?? [])],
            notifications: sessionNotifications,
            boardRows: activeBoard,
            completedBoardRows: completedBoard,
            messages: leaderProjection || historyLoading ? EMPTY_MESSAGES : allMessages,
          })
        : EMPTY_ATTENTION_RECORDS,
    [
      activeBoard,
      allMessages,
      completedBoard,
      historyLoading,
      isLeaderSession,
      leaderProjection,
      persistedAttentionRecords,
      sessionId,
      sessionNotifications,
    ],
  );
  const navigationThreadRows = useMemo(() => {
    const detailRows = applyCanonicalQuestTitles(threadRows, canonicalQuestTitles);
    if (!leaderTabsProjection) return detailRows;
    return mergeProjectedLeaderThreadRows(detailRows, leaderTabsProjection, canonicalQuestTitles) as LeaderThreadRow[];
  }, [canonicalQuestTitles, leaderTabsProjection, threadRows]);
  // A result is read only once its thread has really been on screen: not while a
  // returning session briefly shows its saved tab, nor while the page is hidden.
  const selectedThreadReadOnScreen = useThreadReadOnScreen(
    `${sessionId}:${normalizeThreadKey(isLeaderSession ? selectedThreadKey : MAIN_THREAD_KEY)}`,
    !preview,
  );
  const reviewNotificationIdsToClear = useMemo(
    () =>
      selectedThreadReadOnScreen
        ? reviewNotificationIdsForSelectedThread(
            sessionNotifications,
            reviewAttentionRecords,
            isLeaderSession ? selectedThreadKey : MAIN_THREAD_KEY,
          )
        : [],
    [isLeaderSession, reviewAttentionRecords, selectedThreadKey, selectedThreadReadOnScreen, sessionNotifications],
  );
  useEffect(() => {
    for (const notificationId of reviewNotificationIdsToClear) {
      api.markNotificationDone(sessionId, notificationId, true).catch(console.error);
    }
  }, [reviewNotificationIdsToClear, sessionId]);
  const selectedThreadRow = useMemo(() => {
    const normalizedThreadKey = normalizeThreadKey(selectedThreadKey);
    const existing = navigationThreadRows.find((row) => row.threadKey === normalizedThreadKey);
    if (existing || !isQuestThreadKey(normalizedThreadKey)) return existing;
    const title = canonicalQuestTitles.get(normalizedThreadKey);
    if (!title) return undefined;
    return {
      threadKey: normalizedThreadKey,
      questId: normalizedThreadKey,
      title,
      messageCount: 0,
      createdAt: Number.MAX_SAFE_INTEGER,
    } satisfies LeaderThreadRow;
  }, [canonicalQuestTitles, navigationThreadRows, selectedThreadKey]);
  const composerThreadTitle = isLeaderSession
    ? selectedThreadRow?.questId && selectedThreadRow.title
      ? `${selectedThreadRow.questId}: ${selectedThreadRow.title}`
      : threadTitleForTranscription(selectedThreadKey, navigationThreadRows)
    : undefined;
  const workBoardThreadRows = useMemo(() => toWorkBoardThreadRows(navigationThreadRows), [navigationThreadRows]);
  useEffect(() => {
    openThreadTabKeysRef.current = openThreadTabKeys;
  }, [openThreadTabKeys]);
  useEffect(() => {
    if (!isLeaderSession || !hydrateQuestTitles) return;
    const previousConnectionStatus = titleHydrationConnectionStatusRef.current;
    titleHydrationConnectionStatusRef.current = connStatus;
    const questIds = [...new Set([...openThreadTabKeys, selectedThreadKey].map(normalizeThreadKey))].filter(
      isQuestThreadKey,
    );
    if (questIds.length === 0) return;
    const connectionBecameReady = connStatus === "connected" && previousConnectionStatus !== "connected";
    void hydrateQuestTitles(questIds, connectionBecameReady ? { force: true } : undefined);
  }, [connStatus, hydrateQuestTitles, isLeaderSession, openThreadTabKeys, selectedThreadKey]);
  const sendLeaderThreadTabUpdate = useCallback(
    (operation: LeaderThreadTabUpdate) => sendToSession(sessionId, { type: "leader_thread_tabs_update", operation }),
    [sessionId],
  );
  const openThreadTab = useCallback(
    (threadKey: string, options: OpenThreadTabOptions = {}) => {
      const normalized = normalizeThreadKey(threadKey);
      if (!shouldPersistLeaderThreadTab(normalized)) return;
      const existingOpenThreadKeys = openThreadTabKeysRef.current;
      const nextOpenThreadTabKeys = placeLeaderOpenThreadTabKey(existingOpenThreadKeys, normalized, "first");
      if (existingOpenThreadKeys.includes(normalized)) {
        if (!options.repositionExisting || stringArraysEqual(existingOpenThreadKeys, nextOpenThreadTabKeys)) return;
      }
      openThreadTabKeysRef.current = nextOpenThreadTabKeys;
      setOpenThreadTabKeys(nextOpenThreadTabKeys);
      sendLeaderThreadTabUpdate({
        type: "open",
        threadKey: normalized,
        placement: "first",
      });
    },
    [sendLeaderThreadTabUpdate],
  );
  const locallySelectedRouteThreadKeyRef = useRef<string | null>(null);
  const lastProcessedRouteThreadKeyRef = useRef<string | null>(null);
  const handleSelectThread = useCallback(
    (threadKey: string) => {
      const nextThreadKey = normalizeThreadKey(threadKey || MAIN_THREAD_KEY);
      const currentThreadKey = normalizeThreadKey(selectedThreadKey);
      if (nextThreadKey !== currentThreadKey) {
        beginThreadNavigationTiming({
          sessionId,
          fromThreadKey: currentThreadKey,
          toThreadKey: nextThreadKey,
          cachedWindow: cachedThreadWindows?.has(nextThreadKey) === true,
        });
      }
      openThreadTab(nextThreadKey);
      passiveRestoreThreadKeyRef.current = nextThreadKey;
      selectedThreadKeyRef.current = nextThreadKey;
      if (isLeaderSession && !preview) {
        persistLeaderSelectedThreadKey(sessionId, nextThreadKey);
      }
      if (nextThreadKey === currentThreadKey) return;
      if (!preview) noteViewportSelectionActivity(sessionId, nextThreadKey);
      void requestThreadViewportSnapshot(sessionId, {
        threadKey: currentThreadKey,
        selectedThreadKey: nextThreadKey,
        publishHandoff: true,
        keepalive: true,
        reason: "thread-departure",
      });
      setSelectedThreadKey(nextThreadKey);
      if (!preview) {
        locallySelectedRouteThreadKeyRef.current = nextThreadKey;
        // A thread with unread results opens at the first one, not where it was left.
        const unreadIds = new Set(
          reviewNotificationIdsForSelectedThread(sessionNotifications, reviewAttentionRecords, nextThreadKey),
        );
        const firstUnread = firstUnreadResult(sessionNotifications, (notification) => unreadIds.has(notification.id));
        if (firstUnread?.messageId) {
          navigateToSessionMessageId(sessionId, firstUnread.messageId, {
            threadKey: nextThreadKey,
            preserveMainThreadRoute: true,
            landing: resultLanding(firstUnread),
          });
        } else {
          navigateToSessionThread(sessionId, nextThreadKey);
        }
      }
    },
    [
      cachedThreadWindows,
      isLeaderSession,
      openThreadTab,
      preview,
      reviewAttentionRecords,
      selectedThreadKey,
      sessionId,
      sessionNotifications,
    ],
  );
  // Zooming into a quest from its strip in the topic: the tab's own quest drops the topic view,
  // another quest opens its own tab (which shows it alone), each one history step.
  openTopicQuestRef.current = (questId, part) => {
    prepareZoom(sessionId, questId, "in", { feedKey: feedThreadKey, part });
    if (normalizeThreadKey(questId) === normalizeThreadKey(selectedThreadKey)) closeTopicConversation(sessionId);
    else handleSelectThread(questId);
  };
  // Closing the tab on screen plays its quest strip away (any close path, not only the strip's button).
  const questStripRef = useRef<HTMLDivElement | null>(null);
  const phoneTopicTopRef = useRef<HTMLDivElement | null>(null);
  const handleCloseThreadTab = useCallback(
    (threadKey: string, nextThreadKey = MAIN_THREAD_KEY) => {
      const normalized = normalizeThreadKey(threadKey);
      const nextOpenThreadTabKeys = openThreadTabKeysRef.current.filter((key) => key !== normalized);
      openThreadTabKeysRef.current = nextOpenThreadTabKeys;
      setOpenThreadTabKeys(nextOpenThreadTabKeys);
      sendLeaderThreadTabUpdate({ type: "close", threadKey: normalized, closedAt: Date.now() });
      if (normalizeThreadKey(selectedThreadKey) === normalized) {
        const strip = questStripRef.current;
        playStripClose(strip?.querySelector<HTMLElement>('[data-testid="quest-thread-banner"]'), strip?.parentElement);
        handleSelectThread(nextThreadKey);
      }
    },
    [handleSelectThread, selectedThreadKey, sendLeaderThreadTabUpdate],
  );
  // The quest strip closes the tab on screen the way its listed row's close button does:
  // only while the server lets it close, and through the tab bar, which picks the next tab
  // in the same status group.
  const selectedTabKey = normalizeThreadKey(selectedThreadKey);
  const selectedTabCanClose =
    isLeaderSession && !!leaderTabsProjection?.tabs.some((tab) => tab.threadKey === selectedTabKey && tab.canClose);
  const workBoardCloseTabRef = useRef<((threadKey: string) => void) | null>(null);
  const closeSelectedThreadTab = selectedTabCanClose
    ? () => (workBoardCloseTabRef.current ?? handleCloseThreadTab)(selectedTabKey)
    : undefined;
  // Attention lists close this session's tabs through the same path as the tab's own close button.
  useEffect(() => {
    if (!isLeaderSession || preview) return;
    const onClose = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: string; threadKey?: string; nextThreadKey?: string }>).detail;
      if (detail?.sessionId !== sessionId || !detail.threadKey) return;
      event.preventDefault();
      handleCloseThreadTab(detail.threadKey, detail.nextThreadKey);
    };
    window.addEventListener(CLOSE_THREAD_TAB_EVENT, onClose);
    return () => window.removeEventListener(CLOSE_THREAD_TAB_EVENT, onClose);
  }, [handleCloseThreadTab, isLeaderSession, preview, sessionId]);

  useEffect(() => {
    locallySelectedRouteThreadKeyRef.current = null;
    lastProcessedRouteThreadKeyRef.current = null;
  }, [sessionId]);

  useEffect(() => {
    if (routeSyncEnabled) return;
    setSelectedThreadKey(MAIN_THREAD_KEY);
  }, [routeSyncEnabled, sessionId]);

  useLeaderOpenThreadTabStateSync({
    sessionId,
    isLeaderSession,
    preview,
    connectionStatus: connStatus,
    projection: leaderTabsProjection,
    openThreadTabKeysRef,
    setOpenThreadTabKeys,
    sendUpdate: sendLeaderThreadTabUpdate,
  });

  const questStatusByKey = useMemo(
    () => new Map(quests.map((quest) => [normalizeThreadKey(quest.questId), quest.status])),
    [quests],
  );

  useEffect(() => {
    if (!routeSyncEnabled || preview) return;
    const liveHash = window.location.hash;
    // A page path such as `#/questmaster` is being rewritten to open over this session; the
    // thread route is not ours to correct until the URL names the session again.
    if (parseHash(liveHash).page !== "session") return;
    const liveThreadRoute = threadRouteFromHash(liveHash);
    if (liveThreadRoute.hasThreadParam !== hasThreadRoute || liveThreadRoute.threadKey !== (routeThreadKey ?? null)) {
      return;
    }
    const preserveMessageThreadRoute = hasMessageDeepLinkFromHash(liveHash) && routeThreadKey != null;

    if (!isLeaderSession) {
      if (!sessionMetadataKnown) return;
      lastProcessedRouteThreadKeyRef.current = null;
      passiveRestoreThreadKeyRef.current = MAIN_THREAD_KEY;
      selectedThreadKeyRef.current = MAIN_THREAD_KEY;
      if (selectedThreadKey !== MAIN_THREAD_KEY) {
        setSelectedThreadKey(MAIN_THREAD_KEY);
      }
      if (hasThreadRoute && !preserveMessageThreadRoute) {
        navigateToSessionThread(sessionId, MAIN_THREAD_KEY, true);
      }
      return;
    }

    if (!hasThreadRoute) {
      lastProcessedRouteThreadKeyRef.current = null;
      // Back or forward onto an entry that showed Main shows Main; restoring the saved tab
      // there would turn that history step into a dead one.
      const restoredThreadKey = historyEntryShowsMainThread()
        ? MAIN_THREAD_KEY
        : restorableSelectedThreadKey({
            threadKey: passiveRestoreThreadKeyRef.current,
            authoritativeLeaderOpenThreadTabs,
            openThreadTabKeys,
            rows: navigationThreadRows,
          });
      const nextThreadKey = restoredThreadKey ?? MAIN_THREAD_KEY;
      passiveRestoreThreadKeyRef.current = nextThreadKey;
      selectedThreadKeyRef.current = nextThreadKey;
      if (selectedThreadKey !== nextThreadKey) {
        setSelectedThreadKey(nextThreadKey);
      }
      if (nextThreadKey === MAIN_THREAD_KEY) {
        persistLeaderSelectedThreadKey(sessionId, MAIN_THREAD_KEY);
        markHistoryEntryShowsMainThread();
      } else {
        // This URL follows passive selection restore, not an external route
        // requesting first placement over the authoritative tab order.
        locallySelectedRouteThreadKeyRef.current = nextThreadKey;
        navigateToSessionThread(sessionId, nextThreadKey, true);
      }
      return;
    }

    if (!routeThreadKey) {
      lastProcessedRouteThreadKeyRef.current = null;
      passiveRestoreThreadKeyRef.current = MAIN_THREAD_KEY;
      selectedThreadKeyRef.current = MAIN_THREAD_KEY;
      if (selectedThreadKey !== MAIN_THREAD_KEY) {
        setSelectedThreadKey(MAIN_THREAD_KEY);
      }
      navigateToSessionThread(sessionId, MAIN_THREAD_KEY, true);
      return;
    }

    const nextThreadKey = normalizeThreadKey(routeThreadKey);
    const knownThread = isAvailableLeaderThread(nextThreadKey, navigationThreadRows, openThreadTabKeys);
    if (!knownThread) {
      // Wait for thread sources, so a cold start decides with them and over a connected socket.
      if (historyLoading || !hasKnownThreadSources) return;
      // A newly routed thread this browser has not seen is opened rather than replaced with
      // Main: a phone alert can name a tab the server opened while this page was asleep or
      // offline, and the browser learns of it only after reconnecting. Main takes over only
      // when the thread is gone after that open, as when the tab was closed elsewhere.
      if (lastProcessedRouteThreadKeyRef.current === nextThreadKey) {
        lastProcessedRouteThreadKeyRef.current = null;
        passiveRestoreThreadKeyRef.current = MAIN_THREAD_KEY;
        selectedThreadKeyRef.current = MAIN_THREAD_KEY;
        if (selectedThreadKey !== MAIN_THREAD_KEY) {
          setSelectedThreadKey(MAIN_THREAD_KEY);
        }
        persistLeaderSelectedThreadKey(sessionId, MAIN_THREAD_KEY);
        if (!preserveMessageThreadRoute) {
          navigateToSessionThread(sessionId, MAIN_THREAD_KEY, true);
        }
        return;
      }
    }
    const localSelectionRoute = locallySelectedRouteThreadKeyRef.current === nextThreadKey;
    if (localSelectionRoute) {
      locallySelectedRouteThreadKeyRef.current = null;
    }
    const repositionExisting = shouldRepairRouteThreadOrder({
      lastProcessedRouteThreadKey: lastProcessedRouteThreadKeyRef.current,
      localSelectionRoute,
      threadKey: nextThreadKey,
    });
    if (repositionExisting || !knownThread) {
      openThreadTab(nextThreadKey, { repositionExisting });
    }
    lastProcessedRouteThreadKeyRef.current = nextThreadKey;
    passiveRestoreThreadKeyRef.current = nextThreadKey;
    selectedThreadKeyRef.current = nextThreadKey;
    if (selectedThreadKey !== nextThreadKey) {
      setSelectedThreadKey(nextThreadKey);
    }
    persistLeaderSelectedThreadKey(sessionId, nextThreadKey);
    if (nextThreadKey === MAIN_THREAD_KEY && hasThreadRoute && !preserveMessageThreadRoute) {
      navigateToSessionThread(sessionId, MAIN_THREAD_KEY, true);
    }
  }, [
    authoritativeLeaderOpenThreadTabs,
    hasKnownThreadSources,
    hasThreadRoute,
    historyLoading,
    isLeaderSession,
    openThreadTabKeys,
    preview,
    routeSyncEnabled,
    routeThreadKey,
    selectedThreadKey,
    sessionMetadataKnown,
    sessionId,
    navigationThreadRows,
    openThreadTab,
  ]);

  // Within-session search
  const searchInputRef = useRef<HTMLInputElement>(null);
  useSessionSearch(sessionId, !preview);

  const perms = useMemo(() => (sessionPerms ? Array.from(sessionPerms.values()) : []), [sessionPerms]);

  // Separate plan permission from other permissions
  const planPerm = perms.find((p) => p.tool_name === "ExitPlanMode") || null;
  const otherPerms = perms.filter((p) => p.tool_name !== "ExitPlanMode");

  // Plan collapse state — auto-expand when a new plan arrives
  const [planCollapsed, setPlanCollapsed] = useState(false);
  const planPermId = planPerm?.request_id;
  useEffect(() => {
    if (planPermId) setPlanCollapsed(false);
  }, [planPermId]);

  const showPlanOverlay = planPerm && !planCollapsed;

  // Permissions collapse state — auto-expand only when new permissions arrive
  const [permsCollapsed, setPermsCollapsed] = useState(false);
  const prevOtherPermsCount = useRef(0);
  useEffect(() => {
    if (otherPerms.length > prevOtherPermsCount.current) {
      setPermsCollapsed(false);
    }
    prevOtherPermsCount.current = otherPerms.length;
  }, [otherPerms.length]);

  const recoverableConnectionPresentation = getRecoverableSessionConnectionPresentation({
    backendState,
    browserConnectionStatus: connStatus,
    cliConnected,
    cliEverConnected,
    idlePaused: cliDisconnectReason === "idle_limit",
    serverReachable,
  });
  const isResumeMissingRolloutError =
    backendError?.includes("could not be resumed because its local rollout is missing or unreadable") ?? false;
  const liveConnectionStatus = getLiveSessionConnectionStatus({
    backendState,
    browserConnectionStatus: connStatus,
    cliConnected,
    cliEverConnected,
    launcherState,
    recoverableConnectionPresentation,
    archived: isArchived,
    serverReachable,
  });
  return (
    <ComposerFeedLayout>
      {preview ? (
        <div className="shrink-0 px-4 py-2 border-b border-cc-border bg-cc-card/80 text-[11px] text-cc-muted font-medium">
          Previewing search result. Press Enter to select this conversation.
        </div>
      ) : (
        /* Within-session message search bar */
        <SearchBar sessionId={sessionId} inputRef={searchInputRef} />
      )}

      {/* Archived session banner */}
      {!preview && isArchived && (
        <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/25 flex items-center justify-center gap-3">
          <span className="text-xs text-amber-300 font-medium">This session is archived. History is read-only.</span>
          <button
            onClick={() => void unarchive.run(() => api.unarchiveSession(sessionId))}
            aria-busy={unarchive.pending || undefined}
            title={unarchive.error ?? undefined}
            className="text-xs font-medium px-3 py-1 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 transition-colors cursor-pointer"
          >
            Unarchive
          </button>
        </div>
      )}

      {!preview && modelProvenanceMigration && (
        <ModelProvenanceMigrationBanner
          migration={modelProvenanceMigration}
          onAcknowledge={(eventId) => api.acknowledgeModelProvenanceMigration(sessionId, eventId)}
        />
      )}

      {/* Session task outline — horizontal milestone chips */}
      {!preview && !isLeaderSession && !sessionQuestBannerRow && <TaskOutlineBar sessionId={sessionId} />}

      {/* Persistent work board for orchestrator sessions -- primary thread navigation above the feed */}
      {!preview && (
        <WorkBoardBar
          sessionId={sessionId}
          currentThreadKey={isLeaderSession ? selectedThreadKey : MAIN_THREAD_KEY}
          onSelectThread={isLeaderSession ? handleSelectThread : undefined}
          openThreadKeys={isLeaderSession ? openThreadTabKeys : undefined}
          onCloseThreadTab={isLeaderSession ? handleCloseThreadTab : undefined}
          threadRows={isLeaderSession ? workBoardThreadRows : undefined}
          closeTabRef={workBoardCloseTabRef}
          hideThreadStrip={phoneTopicsOpen}
        />
      )}

      {/* Plan overlay fills the chat area, OR show the normal message feed */}
      {!preview && showPlanOverlay ? (
        <PlanReviewOverlay permission={planPerm} sessionId={sessionId} onCollapse={() => setPlanCollapsed(true)} />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <div ref={zoomColumnRef} className="flex min-w-0 flex-1 flex-col">
              {!preview && !phoneTopicsOpen && topicFeedOn && (
                <div ref={questStripRef} className="contents">
                  <TopicConversationHeader leaderId={sessionId} topic={topicConversation} />
                </div>
              )}
              {!preview && !phoneTopicsOpen && showQuestThreadBanner && !topicFeedOn && (
                <div ref={questStripRef} className="contents">
                  {topicConversation && (
                    <TopicEntryLine
                      name={topicConversation.name}
                      count={topicConversation.questIds.length}
                      onOpen={zoomOutToTopic}
                    />
                  )}
                  <QuestThreadBanner
                    row={selectedThreadRow}
                    threadKey={selectedThreadKey}
                    sideQuestOf={selectedSideQuestOf}
                    monitorSessionId={sessionId}
                    diffSessionId={sessionId}
                    onCloseTab={closeSelectedThreadTab}
                  />
                </div>
              )}
              {!preview && !phoneTopicsOpen && !showQuestThreadBanner && sessionQuestBannerRow && (
                <QuestThreadBanner
                  row={sessionQuestBannerRow}
                  threadKey={sessionQuestBannerRow.threadKey}
                  variant="session"
                  currentSessionId={sessionId}
                  diffSessionId={sessionId}
                />
              )}
              {!preview && sessionMetadataKnown && !isLeaderSession && !sessionQuestBannerRow && (
                <SessionDiffBanner sessionId={sessionId} />
              )}
              {/* Where the phone topic panel starts: just under the thread strip. */}
              <div ref={phoneTopicTopRef} aria-hidden="true" />
              <TopicEntryContext.Provider value={feedTopicEntry}>
                <ViewportHandoffThreadEntryGate
                  key={`${sessionId}:${normalizeThreadKey(isLeaderSession ? feedThreadKey : MAIN_THREAD_KEY)}`}
                  sessionId={preview ? null : sessionId}
                  threadKey={isLeaderSession ? selectedThreadKey : MAIN_THREAD_KEY}
                  entryId={viewportHandoffThreadEntryRef.current.entryId}
                  fallback={
                    <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-cc-muted">
                      Loading conversation...
                    </div>
                  }
                >
                  {/* Reload fork links when the user changes threads or a new quest thread appears. */}
                  <StartedQuestsProvider
                    sessionId={sessionId}
                    enabled={isLeaderSession && !preview}
                    refreshKey={`${navigationThreadRows.length}:${selectedThreadKey}`}
                  >
                    <TopicFeedContext.Provider value={topicFeed}>
                      <MessageFeed
                        sessionId={sessionId}
                        threadKey={isLeaderSession ? feedThreadKey : MAIN_THREAD_KEY}
                        projectThreadRoutes={isLeaderSession}
                        onSelectThread={isLeaderSession ? handleSelectThread : undefined}
                        showCodexSubagentControl={!preview}
                        markSharedResultsRead={isLeaderSession && selectedThreadReadOnScreen}
                      />
                    </TopicFeedContext.Provider>
                  </StartedQuestsProvider>
                </ViewportHandoffThreadEntryGate>
              </TopicEntryContext.Provider>
            </div>
            {!preview && selectedSideChat && (
              <SideChatPanel
                rootSessionId={sessionId}
                sideChat={selectedSideChat}
                onClose={() => setSelectedSideChatId(null)}
              />
            )}
            {!preview && isLeaderSession && (
              <LeaderTopicPanel
                leaderId={sessionId}
                threadKey={selectedThreadKey}
                desktop={desktopShell}
                phoneTopRef={phoneTopicTopRef}
              />
            )}
          </div>
        </div>
      )}

      {/* Collapsed plan chip (when plan exists but is collapsed) */}
      {!preview && planPerm && planCollapsed && (
        <div className="shrink-0 border-t border-cc-border bg-cc-card px-2 sm:px-4 py-2">
          <PlanCollapsedChip permission={planPerm} sessionId={sessionId} onExpand={() => setPlanCollapsed(false)} />
        </div>
      )}

      {/* Non-plan permission banners — collapsible */}
      {!preview &&
        otherPerms.length > 0 &&
        (permsCollapsed ? (
          <PermissionsCollapsedChip permissions={otherPerms} onExpand={() => setPermsCollapsed(false)} />
        ) : (
          <div className="shrink-0 max-h-[60dvh] overflow-y-auto border-t border-cc-border bg-cc-card">
            <div
              onClick={() => setPermsCollapsed(true)}
              className="sticky top-0 z-10 flex items-center gap-2 px-3 py-1.5 bg-cc-card border-b border-cc-border/50 cursor-pointer hover:bg-cc-hover/50 transition-colors"
              role="button"
              title="Minimize approvals"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5 text-cc-warning">
                <path
                  fillRule="evenodd"
                  d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                  clipRule="evenodd"
                />
              </svg>
              <span className="text-[11px] font-medium text-cc-warning">
                {otherPerms.length} pending approval{otherPerms.length !== 1 ? "s" : ""}
              </span>
              <span className="ml-auto p-1.5 rounded-md text-cc-muted">
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" />
                  <path d="M4 8h4" />
                </svg>
              </span>
            </div>
            {otherPerms.map((p) => (
              <PermissionBanner key={p.request_id} permission={p} sessionId={sessionId} />
            ))}
          </div>
        ))}

      {!preview && <HostOfflineBanner sessionId={sessionId} />}

      {liveConnectionStatus && (!preview || liveConnectionStatus === "server-unreachable") && (
        <LiveConnectionStatusBanner
          status={liveConnectionStatus}
          backendState={backendState}
          backendError={backendError}
          reconnectProgress={backendReconnect}
          hasEverConnected={cliEverConnected}
          idlePaused={cliDisconnectReason === "idle_limit"}
          isResumeMissingRolloutError={isResumeMissingRolloutError}
          onRelaunch={
            liveConnectionStatus === "broken" ||
            liveConnectionStatus === "cli-disconnected" ||
            liveConnectionStatus === "recovery-suppressed"
              ? () => api.relaunchSession(sessionId)
              : undefined
          }
        />
      )}

      {/* Compacting indicator — fixed above composer, green like running state */}
      {!preview && <CompactingIndicator sessionId={sessionId} />}

      {/* Active todo status — shows current in-progress task */}
      {!preview && <TodoStatusLine sessionId={sessionId} />}

      {/* Composer */}
      {!preview && (
        <Composer
          sessionId={sessionId}
          threadKey={composerThreadKey}
          questId={composerQuestId}
          transcriptionThreadKey={isLeaderSession ? composerThreadKey : undefined}
          transcriptionThreadTitle={composerThreadTitle}
        />
      )}
    </ComposerFeedLayout>
  );
}
