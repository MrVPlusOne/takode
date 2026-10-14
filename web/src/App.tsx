import { browserLoadDiagnostics } from "./utils/browser-load-diagnostics.js";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStore } from "./store.js";
import {
  connectSession,
  disconnectSession,
  refreshSyncedProjectionSubscriptions,
  sendVsCodeSelectionUpdate,
} from "./ws.js";
import { api, checkHealthStatus } from "./api.js";

import {
  parseHash,
  openQuestOverlayRouteAware,
  questOverlayTargetFromHash,
  withQuestFeedbackInHash,
  withQuestIdInHash,
  withoutQuestIdInHash,
  navigateToSession,
  navigateToSessionMessageId,
  messageIdFromHash,
  navigateToMostRecentSession,
  messageIndexFromHash,
  threadRouteFromHash,
  resolveSessionIdFromRoute,
  scrollToMessageIndex,
  isSecondaryPage,
  primarySessionHash,
  secondaryPageFromHash,
  secondaryPageOverSession,
  sessionHash,
  setSecondaryViewDocked,
  type SecondaryPage,
} from "./utils/routing.js";
import {
  closeSecondaryPage,
  closeSecondaryViewers,
  setSecondaryViewTarget,
  useSecondaryViewMode,
  useSecondaryViewOccupied,
} from "./utils/secondary-view.js";
import { SecondaryViewArea } from "./components/SecondaryViewArea.js";
import { UserContentNotice } from "./components/UserContentNotice.js";
import { navigateTo } from "./utils/navigation.js";
import type { QuestLinkTarget } from "./utils/quest-link-target.js";
import { getHashLocationSnapshot, useHashLocation } from "./utils/hash-location.js";
import { Sidebar } from "./components/Sidebar.js";
import { ChatView } from "./components/ChatView.js";
import { CodexSubagentInspector } from "./components/CodexSubagentInspector.js";
import { TopBar } from "./components/TopBar.js";
import { preloadTodoProposalStatuses } from "./components/TodoInlineLink.js";
import { ATTENTION_NEXT_EVENT } from "./components/GlobalAttentionMenu.js";
import { EmptyState } from "./components/EmptyState.js";
import {
  beginActiveSessionListRequest,
  hydrateSessionList,
  installActiveSessionMetadataRefreshListeners,
} from "./session-list-hydration.js";
import { TaskPanel } from "./components/TaskPanel.js";
import { DiffTabView } from "./components/DiffTabView.js";
import { ActiveBuildMismatchNotice } from "./components/BuildMismatchNotice.js";
import { lazyComponent } from "./components/lazy-component.js";
import { EnvManager } from "./components/EnvManager.js";
import { SessionCreationView } from "./components/SessionCreationView.js";
import { NewSessionModal } from "./components/NewSessionModal.js";
import { QuestDetailPanel } from "./components/QuestDetailPanel.js";
import { UniversalSearchOverlay } from "./components/UniversalSearchOverlay.js";
import { isPendingId } from "./utils/pending-creation.js";
import {
  canShowSecondaryViewBeside,
  getEffectiveViewportWidth,
  secondaryViewWidth,
  isDesktopShellLayout,
  isDesktopTaskPanelLayout,
} from "./utils/layout.js";
import { installAppViewportSizing } from "./utils/app-viewport.js";
import { getLastSessionCreationContext } from "./utils/new-session-defaults.js";
import { buildSidebarVisibleSessions } from "./utils/sidebar-visible-sessions.js";
import { requestThreadViewportSnapshot } from "./utils/thread-viewport.js";
import { ViewportHandoffSessionEntryGate } from "./components/ViewportHandoffEntryGate.js";
import { ServerRestartOverlay } from "./components/ServerRestartOverlay.js";
import { MarkdownFileViewerHost } from "./components/MarkdownFileViewer.js";
import { createViewportHandoffEntryId } from "./utils/viewport-handoff-client.js";
import { resolveDiffTarget } from "./utils/diff-target.js";
import { requestAutoSessionGitStatusRefresh } from "./utils/session-git-status-auto-refresh.js";
import {
  BACKEND_CONNECTION_OPEN_EVENT,
  beginBuildIdentityObservation,
  observeServerBuildIdentity,
} from "./build-compatibility.js";
import {
  announceVsCodeReady,
  type VsCodeSelectionContextPayload,
  maybeReadVsCodeSelectionContext,
} from "./utils/vscode-context.js";
import { ensureVsCodeEditorPreference } from "./utils/vscode-bridge.js";
import {
  SHORTCUT_DOUBLE_TAP_WINDOW_MS,
  getMatchingShortcutAction,
  getMatchingShortcutTapAction,
  isAppGlobalShortcutAction,
  isModifierOnlyKey,
  isShortcutEventTargetEditable,
  performShortcutAction,
  shouldBlurVimEscape,
  type ShortcutActionId,
} from "./shortcuts.js";

// Pages most sessions never open load on first use, keeping them out of the startup bundle.
const Playground = lazyComponent(() => import("./components/Playground.js").then((module) => module.Playground));
const SettingsPage = lazyComponent(() => import("./components/SettingsPage.js").then((module) => module.SettingsPage));
const ChangelogPage = lazyComponent(() =>
  import("./components/ChangelogPage.js").then((module) => module.ChangelogPage),
);
const LogsPage = lazyComponent(() => import("./components/LogsPage.js").then((module) => module.LogsPage));
const TodosAndTimersPage = lazyComponent(() =>
  import("./components/TodosAndTimersPage.js").then((module) => module.TodosAndTimersPage),
);
const MemoryPage = lazyComponent(() => import("./components/MemoryPage.js").then((module) => module.MemoryPage));
const TerminalPage = lazyComponent(() => import("./components/TerminalPage.js").then((module) => module.TerminalPage));
const QuestmasterPage = lazyComponent(() =>
  import("./components/QuestmasterPage.js").then((module) => module.QuestmasterPage),
);

type TakodeDebugWindow = Window &
  typeof globalThis & {
    __TAKODE_VSCODE_CONTEXT__?: VsCodeSelectionContextPayload | null;
    __TAKODE_SET_VSCODE_CONTEXT__?: (payload: VsCodeSelectionContextPayload | null) => void;
    __TAKODE_CLEAR_VSCODE_CONTEXT__?: () => void;
  };

function feedbackIndexOf(target: QuestLinkTarget | null): number | null {
  return target?.feedbackIndex ?? null;
}

function questOverlayMatchesTarget(
  questOverlayId: string | null,
  feedbackIndex: number | null,
  target: QuestLinkTarget,
): boolean {
  return questOverlayId === target.questId && feedbackIndex === feedbackIndexOf(target);
}

function useQuestOverlayRouteSync(
  hash: string,
  questOverlayId: string | null,
  questOverlayFeedbackIndex: number | null,
) {
  const observedHashRef = useRef<string | null>(null);
  const routedTargetRef = useRef<QuestLinkTarget | null>(null);
  const routedTargetAppliedRef = useRef(false);

  useEffect(() => {
    const target = questOverlayTargetFromHash(hash);
    const hashChanged = observedHashRef.current !== hash;
    const store = useStore.getState();
    if (hashChanged) {
      const previous = routedTargetRef.current;
      observedHashRef.current = hash;
      routedTargetRef.current = target;

      if (target) {
        const liveFeedbackIndex = store.questOverlayFeedbackTarget?.index ?? null;
        if (!questOverlayMatchesTarget(store.questOverlayId, liveFeedbackIndex, target)) {
          if (target.feedbackIndex === undefined) store.openQuestOverlay(target.questId);
          else store.openQuestOverlay(target.questId, undefined, target.feedbackIndex);
        }
        const appliedStore = useStore.getState();
        routedTargetAppliedRef.current = questOverlayMatchesTarget(
          appliedStore.questOverlayId,
          appliedStore.questOverlayFeedbackTarget?.index ?? null,
          target,
        );
        return;
      }

      routedTargetAppliedRef.current = false;
      if (previous) store.closeQuestOverlay();
      return;
    }

    if (!target) return;
    // A link assignment changes window.location.hash before the shared hash
    // store publishes its next snapshot. Wait for that authoritative hash
    // event instead of replacing a just-pushed browser-history entry.
    if (getHashLocationSnapshot() !== hash) return;

    const liveStore = useStore.getState();
    const liveQuestOverlayId = liveStore.questOverlayId;
    const liveFeedbackIndex = liveStore.questOverlayFeedbackTarget?.index ?? null;
    if (questOverlayMatchesTarget(liveQuestOverlayId, liveFeedbackIndex, target)) {
      routedTargetAppliedRef.current = true;
      return;
    }
    // StrictMode and unrelated startup renders can replay effects before the
    // Zustand subscription publishes the route-open state. Keep the hash
    // authoritative until this route has been observed in the store once.
    if (!routedTargetAppliedRef.current) {
      if (target.feedbackIndex === undefined) liveStore.openQuestOverlay(target.questId);
      else liveStore.openQuestOverlay(target.questId, undefined, target.feedbackIndex);
      const appliedStore = useStore.getState();
      routedTargetAppliedRef.current = questOverlayMatchesTarget(
        appliedStore.questOverlayId,
        appliedStore.questOverlayFeedbackTarget?.index ?? null,
        target,
      );
      return;
    }

    if (!liveQuestOverlayId) {
      navigateTo(withoutQuestIdInHash(hash), true);
      return;
    }

    const nextHash =
      liveFeedbackIndex === null
        ? withQuestIdInHash(hash, liveQuestOverlayId)
        : withQuestFeedbackInHash(hash, liveQuestOverlayId, liveFeedbackIndex);
    navigateTo(nextHash, true);
  }, [hash, questOverlayFeedbackIndex, questOverlayId]);
}

function buildSidebarOrderedShortcutSessions(state: ReturnType<typeof useStore.getState>) {
  const { orderedVisibleSessionIds } = buildSidebarVisibleSessions({
    sdkSessions: state.sdkSessions,
    syncedProjectionValues: state.syncedProjectionValues,
    syncedProjectionKeys: state.syncedProjectionKeys,
    treeGroups: state.treeGroups,
    treeAssignments: state.treeAssignments,
    treeNodeOrder: state.treeNodeOrder,
    collapsedTreeGroups: state.collapsedTreeGroups,
    expandedHerdNodes: state.expandedHerdNodes,
    sessionAttention: state.sessionAttention,
    sessionSortMode: state.sessionSortMode,
    sidebarViewMode: state.sidebarViewMode,
  });
  const sdkById = new Map(state.sdkSessions.map((session) => [session.sessionId, session] as const));
  return orderedVisibleSessionIds
    .map((sessionId, index) => {
      const session = sdkById.get(sessionId);
      if (!session) return null;
      return {
        sessionId: session.sessionId,
        createdAt: session.createdAt,
        archived: session.archived,
        cronJobId: session.cronJobId ?? null,
        orderIndex: index,
      };
    })
    .filter((session): session is NonNullable<typeof session> => session !== null);
}

function subscribeResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function useViewportWidth(zoomLevel: number): number {
  return useSyncExternalStore(subscribeResize, () => getEffectiveViewportWidth(zoomLevel));
}

const SECONDARY_PAGE_LABELS: Record<SecondaryPage, string> = {
  settings: "Settings",
  changelog: "Changelog",
  logs: "Logs",
  terminal: "Terminal",
  environments: "Environments",
  scheduled: "To-dos & Timers",
  questmaster: "Questmaster",
  memory: "Memory",
};

function secondaryPageLabel(page: SecondaryPage): string {
  return SECONDARY_PAGE_LABELS[page];
}

/** The page shown as the secondary view. Settings stays mounted under the Changelog it links to. */
function renderSecondaryPage(page: SecondaryPage) {
  switch (page) {
    case "settings":
    case "changelog":
      return (
        <>
          <div className={`absolute inset-0 ${page === "settings" ? "" : "hidden"}`}>
            <SettingsPage embedded isActive={page === "settings"} />
          </div>
          {page === "changelog" && (
            <div className="absolute inset-0">
              <ChangelogPage />
            </div>
          )}
        </>
      );
    case "logs":
      return (
        <div className="absolute inset-0">
          <LogsPage />
        </div>
      );
    case "terminal":
      return (
        <div className="absolute inset-0">
          <TerminalPage />
        </div>
      );
    case "environments":
      return (
        <div className="absolute inset-0">
          <EnvManager embedded />
        </div>
      );
    case "scheduled":
      return (
        <div className="absolute inset-0">
          <TodosAndTimersPage />
        </div>
      );
    case "questmaster":
      return (
        <div className="absolute inset-0">
          <QuestmasterPage isActive={true} />
        </div>
      );
    case "memory":
      return (
        <div className="absolute inset-0">
          <MemoryPage embedded />
        </div>
      );
  }
}

export default function App() {
  useLayoutEffect(() => browserLoadDiagnostics.markAppCommitted(), []);
  const {
    colorTheme,
    darkMode,
    zoomLevel,
    currentSessionId,
    searchPreviewSessionId,
    shortcutSettings,
    sidebarOpen,
    taskPanelOpen,
    activeTab,
    newSessionModalState,
    serverRestartPhase,
    serverReachable,
    sdkSessions,
    codexSubagentInspector,
    questOverlayId,
    questOverlayFeedbackIndex,
  } = useStore(
    useShallow((s) => ({
      colorTheme: s.colorTheme,
      darkMode: s.darkMode,
      zoomLevel: s.zoomLevel,
      currentSessionId: s.currentSessionId,
      searchPreviewSessionId: s.searchPreviewSessionId,
      shortcutSettings: s.shortcutSettings,
      sidebarOpen: s.sidebarOpen,
      taskPanelOpen: s.taskPanelOpen,
      activeTab: s.activeTab,
      newSessionModalState: s.newSessionModalState,
      serverRestartPhase: s.serverRestartPhase,
      serverReachable: s.serverReachable,
      sdkSessions: s.sdkSessions,
      codexSubagentInspector: s.codexSubagentInspector,
      questOverlayId: s.questOverlayId,
      questOverlayFeedbackIndex: s.questOverlayFeedbackTarget?.index ?? null,
    })),
  );
  const rawHash = useHashLocation();
  useQuestOverlayRouteSync(rawHash, questOverlayId, questOverlayFeedbackIndex);
  // A page link such as `#/questmaster` opens over the last session, which stays the
  // primary view; the effect below rewrites the URL to say so.
  const lastPrimaryHashRef = useRef<string | null>(null);
  const rawPage = parseHash(rawHash).page;
  if (rawPage === "session") lastPrimaryHashRef.current = primarySessionHash(rawHash);
  const primaryHashForPage = isSecondaryPage(rawPage)
    ? (lastPrimaryHashRef.current ?? (currentSessionId ? sessionHash(currentSessionId) : null))
    : null;
  const hash = primaryHashForPage ? secondaryPageOverSession(rawHash, primaryHashForPage) : rawHash;
  useEffect(() => {
    if (hash !== rawHash) navigateTo(hash, true);
  }, [hash, rawHash]);
  const route = useMemo(() => parseHash(hash), [hash]);
  const threadRoute = useMemo(
    () => (route.page === "session" ? threadRouteFromHash(hash) : { hasThreadParam: false, threadKey: null }),
    [hash, route.page],
  );
  const secondaryPage = secondaryPageFromHash(hash);
  // Logs and Environments keep the session top bar; other pages name themselves in it.
  const fullPageRouteLabel =
    secondaryPage && secondaryPage !== "logs" && secondaryPage !== "environments"
      ? secondaryPageLabel(secondaryPage)
      : undefined;
  const isSessionView = route.page === "session" || route.page === "home";
  const routeSessionId = useMemo(
    () => (route.page === "session" ? resolveSessionIdFromRoute(route.sessionId, sdkSessions) : null),
    [route, sdkSessions],
  );
  const primarySessionId = route.page === "session" ? routeSessionId : currentSessionId;
  const displayedSessionId = searchPreviewSessionId ?? primarySessionId;
  const viewportSessionEntryIdentity =
    isSessionView && primarySessionId && !isPendingId(primarySessionId) ? primarySessionId : null;
  const viewportSessionEntryId = useMemo(createViewportHandoffEntryId, [viewportSessionEntryIdentity]);
  const viewportThreadEntryScopeId = useMemo(createViewportHandoffEntryId, [
    viewportSessionEntryIdentity,
    threadRoute.hasThreadParam ? (threadRoute.threadKey ?? "main") : "bare",
  ]);
  // The chip that opened the diff view names its session and thread; a different session falls back to its route.
  const diffTarget = useStore(
    useShallow((s) => {
      const source = s.diffViewSource;
      return source && source.sessionId === currentSessionId
        ? resolveDiffTarget(s, source.sessionId, source.threadKey)
        : resolveDiffTarget(s, currentSessionId, threadRoute.threadKey);
    }),
  );
  const isDesktopShell = isDesktopShellLayout(zoomLevel);
  const isDesktopTaskPanel = isDesktopTaskPanelLayout(zoomLevel);
  const inlineTaskPanelOpen =
    isDesktopTaskPanel && taskPanelOpen && isSessionView && !!currentSessionId && !isPendingId(currentSessionId);
  const viewportWidth = useViewportWidth(zoomLevel);
  // Wide screens show the secondary view (a page and viewers opened from the conversation) in a
  // right-hand area, beside the conversation or floating over it; phones cover the conversation
  // with it. Either way the conversation, the primary view, stays mounted.
  const preferredSecondaryViewMode = useSecondaryViewMode();
  const secondaryViewersOpen = useSecondaryViewOccupied();
  const secondaryAvailableWidth = viewportWidth - (sidebarOpen ? 260 : 0) - (inlineTaskPanelOpen ? 280 : 0);
  const secondaryAreaWidth = isDesktopShell && isSessionView ? secondaryViewWidth(secondaryAvailableWidth) : null;
  const canShowSecondaryBeside =
    secondaryAreaWidth !== null && canShowSecondaryViewBeside(secondaryAvailableWidth, secondaryAreaWidth);
  const secondaryViewMode = canShowSecondaryBeside ? preferredSecondaryViewMode : "overlay";
  const diffInSecondaryArea =
    secondaryAreaWidth !== null && activeTab === "diff" && !!currentSessionId && !isPendingId(currentSessionId);
  const secondaryAreaOpen =
    secondaryAreaWidth !== null && (secondaryPage !== null || secondaryViewersOpen || diffInSecondaryArea);
  const primaryHidden =
    (activeTab !== "chat" && !diffInSecondaryArea && !!displayedSessionId) ||
    (secondaryPage !== null && secondaryAreaWidth === null);
  const [secondaryAreaElement, setSecondaryAreaElement] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setSecondaryViewTarget(secondaryAreaWidth !== null ? secondaryAreaElement : null);
  }, [secondaryAreaElement, secondaryAreaWidth]);
  useEffect(
    () => setSecondaryViewDocked(secondaryAreaOpen && secondaryViewMode === "side"),
    [secondaryAreaOpen, secondaryViewMode],
  );
  const dismissSecondaryArea = useCallback(() => {
    closeSecondaryViewers();
    if (useStore.getState().activeTab === "diff") useStore.getState().setActiveTab("chat");
    if (secondaryPageFromHash(window.location.hash)) closeSecondaryPage();
  }, []);
  const chatSessionVisible =
    isSessionView &&
    (activeTab === "chat" || diffInSecondaryArea) &&
    !!displayedSessionId &&
    !isPendingId(displayedSessionId);
  const showServerUnreachableBanner = !serverReachable && !chatSessionVisible;
  const [universalSearchOpen, setUniversalSearchOpen] = useState(false);
  const sidebarShellRef = useRef<HTMLDivElement | null>(null);
  const shortcutTapCandidateRef = useRef<string | null>(null);
  const shortcutLastTapRef = useRef<{ key: string; time: number; target: EventTarget | null } | null>(null);
  const shortcutTapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openUniversalSearch = useCallback(() => {
    useStore.getState().closeCodexSubagentInspector();
    setUniversalSearchOpen(true);
  }, []);
  const closeUniversalSearch = useCallback(() => setUniversalSearchOpen(false), []);
  const universalSearchThreadKey = route.page === "session" ? (threadRoute.threadKey ?? "main") : null;

  const handleOpenUniversalQuest = useCallback((questId: string, query: string) => {
    openQuestOverlayRouteAware(questId, query || undefined);
  }, []);
  const handleOpenUniversalMessage = useCallback((sessionId: string, messageId: string, threadKey?: string | null) => {
    navigateToSessionMessageId(sessionId, messageId, {
      threadKey: threadKey ?? undefined,
      preserveMainThreadRoute: threadKey != null,
    });
  }, []);
  const shouldKeepMobileSidebarMounted = !isDesktopShell;
  const shouldRenderSidebar = sidebarOpen || shouldKeepMobileSidebarMounted;
  const isMobileSidebarHidden = shouldKeepMobileSidebarMounted && !sidebarOpen;

  useEffect(() => {
    const shell = sidebarShellRef.current;
    if (!shell) return;
    shell.inert = isMobileSidebarHidden;
    return () => {
      shell.inert = false;
    };
  }, [isMobileSidebarHidden]);

  useEffect(() => preloadTodoProposalStatuses(), []);

  useEffect(() => {
    const el = document.documentElement;
    el.classList.toggle("dark", darkMode);
    // Theme-specific class (e.g. "theme-codex-dark") — remove all, then add current
    el.className = el.className.replace(/\btheme-\S+/g, "").trim();
    if (colorTheme !== "light" && colorTheme !== "dark") {
      el.classList.add(`theme-${colorTheme}`);
    }
  }, [colorTheme, darkMode]);

  useEffect(() => {
    const debugWindow = window as TakodeDebugWindow;
    const selectionSourceId =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? `browser:${crypto.randomUUID()}`
        : `browser:${Date.now()}`;
    const applyVsCodeContext = (context: VsCodeSelectionContextPayload | null) => {
      debugWindow.__TAKODE_VSCODE_CONTEXT__ = context;
      const updatedAt = Date.now();
      sendVsCodeSelectionUpdate({
        type: "vscode_selection_update",
        selection: context
          ? {
              absolutePath: context.absolutePath,
              startLine: context.startLine,
              endLine: context.endLine,
              lineCount: context.lineCount,
            }
          : null,
        updatedAt,
        sourceId: selectionSourceId,
        sourceType: "browser-panel",
        sourceLabel: "embedded-browser",
      });
    };

    debugWindow.__TAKODE_SET_VSCODE_CONTEXT__ = (payload) => {
      console.debug("[takode:vscode] debug set context", payload);
      applyVsCodeContext(payload);
    };
    debugWindow.__TAKODE_CLEAR_VSCODE_CONTEXT__ = () => {
      console.debug("[takode:vscode] debug clear context");
      applyVsCodeContext(null);
    };

    function handleParentMessage(event: MessageEvent) {
      const context = maybeReadVsCodeSelectionContext(event.data);
      if (typeof context === "undefined") {
        return;
      }
      console.debug("[takode:vscode] received context", context);
      if (context === null) {
        applyVsCodeContext(null);
        return;
      }
      applyVsCodeContext(context);
    }

    window.addEventListener("message", handleParentMessage);
    announceVsCodeReady();
    return () => {
      delete debugWindow.__TAKODE_SET_VSCODE_CONTEXT__;
      delete debugWindow.__TAKODE_CLEAR_VSCODE_CONTEXT__;
      window.removeEventListener("message", handleParentMessage);
    };
  }, []);

  useEffect(() => {
    return installActiveSessionMetadataRefreshListeners();
  }, []);

  useEffect(() => {
    if (route.page !== "session") return;
    if (!/^\d+$/.test(route.sessionId)) return;
    if (routeSessionId) return;

    let cancelled = false;
    const requestSequence = beginActiveSessionListRequest();
    api
      .listSessions({ includeArchived: false })
      .then(async (sessions) => {
        if (cancelled) return;
        hydrateSessionList(sessions, {
          preserveMissingArchived: true,
          activeSnapshotRequestSequence: requestSequence,
        });
        if (sessions.some((session) => session.sessionNum === Number(route.sessionId))) return;
        const archivedMatches = await api.searchSessions(`#${route.sessionId}`, {
          includeArchived: true,
          includeReviewers: true,
          limit: 10,
        });
        const archivedSession = archivedMatches.results
          .map((result) => result.session)
          .find((session) => session?.sessionNum === Number(route.sessionId));
        if (!cancelled && archivedSession) hydrateSessionList([archivedSession], { preserveMissingSessions: true });
      })
      .catch((err) => {
        console.warn("[app] failed to hydrate sessions for numeric route:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [route, routeSessionId]);

  useEffect(() => {
    void (async () => {
      try {
        await ensureVsCodeEditorPreference();
      } catch {
        // Ignore editor preference sync failures so the embedded app stays usable.
      }
    })();
  }, []);

  // Poll backend liveness every 10s and compare its server-authored build identity
  // with this loaded frontend. WebSocket opens trigger the same comparison so a
  // reconnect after a restart does not wait for the next interval.
  useEffect(() => {
    let failures = 0;
    const poll = async () => {
      const observationSequence = beginBuildIdentityObservation();
      const status = await checkHealthStatus();
      const store = useStore.getState();
      if (status.ok) {
        observeServerBuildIdentity(status.buildId, status.servedFrontendBuildId, observationSequence);
        failures = 0;
        if (!store.serverReachable) {
          store.setServerReachable(true);
        }
      } else {
        failures++;
        if (failures >= 2 && store.serverReachable) {
          store.setServerReachable(false);
        }
      }
    };
    const compareAfterBackendConnection = () => {
      void poll();
    };

    void poll();
    const interval = setInterval(() => void poll(), 10_000);
    window.addEventListener(BACKEND_CONNECTION_OPEN_EVENT, compareAfterBackendConnection);
    return () => {
      clearInterval(interval);
      window.removeEventListener(BACKEND_CONNECTION_OPEN_EVENT, compareAfterBackendConnection);
    };
  }, []);

  useEffect(() => {
    function shortcutCandidateIsAvailable(candidate: ShortcutActionId) {
      return candidate !== "voice_start" && candidate !== "voice_stop";
    }

    function isStandaloneModifierEvent(event: KeyboardEvent) {
      if (!isModifierOnlyKey(event.key)) return false;
      if (event.key === "Shift") return event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey;
      if (event.key === "Control") return event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey;
      if (event.key === "Alt") return event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
      if (event.key === "Meta") return event.metaKey && !event.altKey && !event.ctrlKey && !event.shiftKey;
      return false;
    }

    function clearShortcutTap() {
      if (shortcutTapTimerRef.current) {
        clearTimeout(shortcutTapTimerRef.current);
        shortcutTapTimerRef.current = null;
      }
      shortcutTapCandidateRef.current = null;
      shortcutLastTapRef.current = null;
    }

    function runShortcutAction(actionId: ShortcutActionId, event: KeyboardEvent, target: EventTarget | null) {
      const state = useStore.getState();
      const editableTarget = isShortcutEventTargetEditable(target);
      const searchShortcut = actionId === "search_session";
      if (editableTarget && !isAppGlobalShortcutAction(actionId) && !searchShortcut) return false;
      if (searchShortcut) {
        event.preventDefault();
        event.stopPropagation();
      }

      const currentSessionId = state.currentSessionId;
      const currentSession =
        (currentSessionId ? state.sessions.get(currentSessionId) : null) ??
        (currentSessionId ? state.sdkSessions.find((session) => session.sessionId === currentSessionId) : null) ??
        null;
      const handled = performShortcutAction(actionId, {
        secondaryPage,
        currentSessionId,
        currentSessionCwd: currentSession?.cwd ?? null,
        currentSessionHostId:
          (currentSessionId ? state.sessions.get(currentSessionId)?.host_id : undefined) ??
          (currentSessionId
            ? state.sdkSessions.find((session) => session.sessionId === currentSessionId)?.hostId
            : null) ??
          null,
        terminalCwd: state.terminalCwd,
        activeTab: state.activeTab,
        isSearchOpen: universalSearchOpen,
        sessions: buildSidebarOrderedShortcutSessions(state),
        openSearch: openUniversalSearch,
        closeSearch: closeUniversalSearch,
        lastNewSessionContext: getLastSessionCreationContext(),
        openNewSessionModal: (context) => state.openNewSessionModal(context),
        openTerminal: state.openTerminal,
        captureConversationViewport: () => requestThreadViewportSnapshot(currentSessionId),
        setActiveTab: state.setActiveTab,
        toggleSidebar: () => state.setSidebarOpen(!state.sidebarOpen),
        navigateTo,
        navigateToSession,
        navigateToMostRecentSession: () => navigateToMostRecentSession(),
        closeSecondaryPage,
        goToNextAttention: () => window.dispatchEvent(new Event(ATTENTION_NEXT_EVENT)),
      });
      if (!handled) return false;
      if (actionId !== "search_session") {
        event.preventDefault();
        event.stopPropagation();
      }
      return true;
    }

    function handleKeyDown(event: KeyboardEvent) {
      const state = useStore.getState();
      if (shouldBlurVimEscape(state.shortcutSettings, event, event.target)) {
        (event.target as HTMLElement | null)?.blur?.();
        event.preventDefault();
        event.stopPropagation();
        clearShortcutTap();
        return;
      }
      const actionId = getMatchingShortcutAction(state.shortcutSettings, event, {
        isActionAvailable: shortcutCandidateIsAvailable,
      });
      if (actionId) {
        runShortcutAction(actionId, event, event.target);
        clearShortcutTap();
        return;
      }

      if (event.repeat) return;
      if (!isStandaloneModifierEvent(event)) {
        if (shortcutTapCandidateRef.current) clearShortcutTap();
        return;
      }
      shortcutTapCandidateRef.current = event.key;
    }

    function handleKeyUp(event: KeyboardEvent) {
      if (shortcutTapCandidateRef.current !== event.key) return;
      shortcutTapCandidateRef.current = null;
      const state = useStore.getState();
      const doubleTapAction = getMatchingShortcutTapAction(state.shortcutSettings, event.key, 2, {
        isActionAvailable: shortcutCandidateIsAvailable,
      });
      const singleTapAction = getMatchingShortcutTapAction(state.shortcutSettings, event.key, 1, {
        isActionAvailable: shortcutCandidateIsAvailable,
      });
      const now = Date.now();
      const previousTap = shortcutLastTapRef.current;

      if (previousTap?.key === event.key && now - previousTap.time < SHORTCUT_DOUBLE_TAP_WINDOW_MS) {
        clearShortcutTap();
        if (doubleTapAction) runShortcutAction(doubleTapAction, event, previousTap.target);
        return;
      }

      if (singleTapAction && !doubleTapAction) {
        runShortcutAction(singleTapAction, event, event.target);
        return;
      }

      shortcutLastTapRef.current = { key: event.key, time: now, target: event.target };
      if (shortcutTapTimerRef.current) clearTimeout(shortcutTapTimerRef.current);
      shortcutTapTimerRef.current = setTimeout(() => {
        shortcutTapTimerRef.current = null;
        const latestState = useStore.getState();
        const action = getMatchingShortcutTapAction(latestState.shortcutSettings, event.key, 1, {
          isActionAvailable: shortcutCandidateIsAvailable,
        });
        const target = shortcutLastTapRef.current?.target ?? null;
        shortcutLastTapRef.current = null;
        if (action) runShortcutAction(action, event, target);
      }, SHORTCUT_DOUBLE_TAP_WINDOW_MS);
    }

    document.addEventListener("keydown", handleKeyDown, { capture: true });
    document.addEventListener("keyup", handleKeyUp, { capture: true });
    return () => {
      document.removeEventListener("keydown", handleKeyDown, { capture: true });
      document.removeEventListener("keyup", handleKeyUp, { capture: true });
      clearShortcutTap();
    };
  }, [closeUniversalSearch, openUniversalSearch, secondaryPage, shortcutSettings, universalSearchOpen]);

  useEffect(() => {
    return installAppViewportSizing(window);
  }, []);

  // Capture the localStorage-restored session ID during render (before any effects run)
  // so the mount logic can use it even if the hash-sync branch would clear it.
  const restoredIdRef = useRef(useStore.getState().currentSessionId);
  const connectedSessionIdRef = useRef<string | null>(null);
  const previewConnectedSessionIdRef = useRef<string | null>(null);
  const selectedGitRefreshSessionIdRef = useRef<string | null>(null);
  const consumedStableMessageRouteRef = useRef<string | null>(null);

  // Sync hash → store. On mount, restore a localStorage session into the URL first.
  useEffect(() => {
    // On first mount with no session hash, restore from localStorage
    if (restoredIdRef.current !== null && route.page === "home") {
      navigateToSession(restoredIdRef.current, true);
      restoredIdRef.current = null;
      return; // navigateToSession triggers hashchange → this effect re-runs with the session route
    }
    restoredIdRef.current = null;

    if (route.page === "session") {
      const store = useStore.getState();
      const resolvedSessionId = resolveSessionIdFromRoute(route.sessionId, store.sdkSessions);
      if (!resolvedSessionId) {
        if (store.currentSessionId !== null) {
          store.setCurrentSession(null);
        }
        if (connectedSessionIdRef.current) {
          disconnectSession(connectedSessionIdRef.current);
          connectedSessionIdRef.current = null;
        }
        return;
      }

      if (store.currentSessionId !== resolvedSessionId) {
        store.setCurrentSession(resolvedSessionId);
      }

      // Handle stable /msg/<id>, /msg/N, and legacy ?msg=N message-level deep links.
      const msgId = messageIdFromHash(hash);
      if (msgId) {
        const stableMessageRouteKey = `${resolvedSessionId}:${hash}`;
        if (consumedStableMessageRouteRef.current !== stableMessageRouteKey) {
          consumedStableMessageRouteRef.current = stableMessageRouteKey;
          store.setPendingScrollToMessageId(resolvedSessionId, msgId);
          store.requestScrollToMessage(resolvedSessionId, msgId);
          store.setExpandAllInTurn(resolvedSessionId, msgId);
        }
      } else {
        consumedStableMessageRouteRef.current = null;
      }
      const msgIdx = messageIndexFromHash(hash);
      if (msgIdx != null) {
        scrollToMessageIndex(resolvedSessionId, msgIdx);
      }
      // Don't connect WebSocket or fire REST calls for pending sessions
      // (they don't exist on the server yet)
      if (isPendingId(resolvedSessionId)) {
        if (connectedSessionIdRef.current) {
          disconnectSession(connectedSessionIdRef.current);
          connectedSessionIdRef.current = null;
        }
      } else {
        if (connectedSessionIdRef.current && connectedSessionIdRef.current !== resolvedSessionId) {
          disconnectSession(connectedSessionIdRef.current);
        }
        api.markSessionRead?.(resolvedSessionId, { mode: "session-view" }).catch(() => {});
        connectSession(resolvedSessionId);
        connectedSessionIdRef.current = resolvedSessionId;
        if (selectedGitRefreshSessionIdRef.current !== resolvedSessionId) {
          const sdkSession = store.sdkSessions.find((session) => session.sessionId === resolvedSessionId);
          const bridgeSession = store.sessions.get(resolvedSessionId);
          requestAutoSessionGitStatusRefresh({
            id: resolvedSessionId,
            archived: sdkSession?.archived,
            isWorktree: bridgeSession?.is_worktree ?? sdkSession?.isWorktree ?? true,
            gitStatusRefreshedAt: bridgeSession?.git_status_refreshed_at ?? sdkSession?.gitStatusRefreshedAt,
          });
          selectedGitRefreshSessionIdRef.current = resolvedSessionId;
        }
      }
    } else if (route.page === "home") {
      consumedStableMessageRouteRef.current = null;
      const store = useStore.getState();
      if (store.currentSessionId !== null) {
        store.setCurrentSession(null);
      }
      if (connectedSessionIdRef.current) {
        disconnectSession(connectedSessionIdRef.current);
        connectedSessionIdRef.current = null;
      }
      // Auto-navigate to the most recent session if available
      navigateToMostRecentSession({ replace: true });
    } else {
      // A page opened with no session to sit over.
      consumedStableMessageRouteRef.current = null;
      if (connectedSessionIdRef.current) {
        disconnectSession(connectedSessionIdRef.current);
        connectedSessionIdRef.current = null;
      }
    }
  }, [hash, route, sdkSessions]);

  useEffect(() => {
    if (!currentSessionId || isPendingId(currentSessionId)) return;
    refreshSyncedProjectionSubscriptions(currentSessionId);
  }, [currentSessionId, sdkSessions]);

  useEffect(() => {
    const previewSessionId =
      searchPreviewSessionId && !isPendingId(searchPreviewSessionId) && searchPreviewSessionId !== currentSessionId
        ? searchPreviewSessionId
        : null;

    const previousPreviewSessionId = previewConnectedSessionIdRef.current;
    if (previousPreviewSessionId && previousPreviewSessionId !== previewSessionId) {
      disconnectSession(previousPreviewSessionId);
      previewConnectedSessionIdRef.current = null;
    }

    if (!previewSessionId) return;

    connectSession(previewSessionId);
    previewConnectedSessionIdRef.current = previewSessionId;

    return () => {
      if (previewConnectedSessionIdRef.current === previewSessionId && previewSessionId !== currentSessionId) {
        disconnectSession(previewSessionId);
        previewConnectedSessionIdRef.current = null;
      }
    };
  }, [searchPreviewSessionId, currentSessionId]);

  useEffect(() => {
    return () => {
      if (connectedSessionIdRef.current) {
        disconnectSession(connectedSessionIdRef.current);
        connectedSessionIdRef.current = null;
      }
      if (previewConnectedSessionIdRef.current) {
        disconnectSession(previewConnectedSessionIdRef.current);
        previewConnectedSessionIdRef.current = null;
      }
    };
  }, []);

  // The app shell re-renders on every session-list update; reusing this element lets React skip the
  // whole conversation then, while ChatView still re-renders for its own props and store slices.
  const conversationView = useMemo(
    () =>
      displayedSessionId ? (
        <ViewportHandoffSessionEntryGate
          key={`${displayedSessionId}:${searchPreviewSessionId === displayedSessionId ? "preview" : "active"}`}
          sessionId={searchPreviewSessionId === displayedSessionId ? null : displayedSessionId}
          entryId={viewportSessionEntryId}
          fallback={
            <div className="flex h-full items-center justify-center text-sm text-cc-muted">Loading conversation...</div>
          }
        >
          <ChatView
            sessionId={displayedSessionId}
            preview={searchPreviewSessionId === displayedSessionId}
            routeThreadKey={threadRoute.threadKey}
            hasThreadRoute={threadRoute.hasThreadParam}
            viewportHandoffThreadEntryScopeId={viewportThreadEntryScopeId}
          />
        </ViewportHandoffSessionEntryGate>
      ) : null,
    [
      displayedSessionId,
      searchPreviewSessionId,
      threadRoute.hasThreadParam,
      threadRoute.threadKey,
      viewportSessionEntryId,
      viewportThreadEntryScopeId,
    ],
  );

  if (route.page === "playground") {
    return (
      <>
        <ActiveBuildMismatchNotice />
        <Playground />
        {/* The Playground's Quest Detail Modal section opens this global overlay. */}
        <QuestDetailPanel />
        <MarkdownFileViewerHost />
      </>
    );
  }

  return (
    <div
      className="relative flex font-sans-ui bg-cc-bg text-cc-fg antialiased"
      style={{
        transform: `scale(${zoomLevel})`,
        transformOrigin: "top left",
        width: `${100 / zoomLevel}%`,
        height: `${100 / zoomLevel}%`,
      }}
    >
      <ActiveBuildMismatchNotice />

      {/* Mobile overlay backdrop */}
      {sidebarOpen && !isDesktopShell && (
        <div className="fixed inset-0 bg-black/30 z-30" onClick={() => useStore.getState().setSidebarOpen(false)} />
      )}

      {/* Sidebar — overlay on mobile, inline on desktop */}
      {shouldRenderSidebar && (
        <div
          ref={sidebarShellRef}
          aria-hidden={isMobileSidebarHidden ? "true" : undefined}
          data-testid="app-sidebar-shell"
          data-mobile-sidebar-state={shouldKeepMobileSidebarMounted ? (sidebarOpen ? "open" : "hidden") : undefined}
          className={`
            ${
              isDesktopShell
                ? "relative z-auto w-[260px] translate-x-0"
                : `fixed inset-y-0 left-0 z-40 w-[80vw] transform-gpu ${
                    sidebarOpen ? "translate-x-0" : "-translate-x-full pointer-events-none"
                  }`
            }
            h-full shrink-0 overflow-hidden transition-transform duration-200 ease-out
          `}
          style={{
            touchAction: "pan-y",
            overscrollBehaviorX: "none",
          }}
        >
          <Sidebar onOpenUniversalSearch={openUniversalSearch} />
        </div>
      )}

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden" data-codex-subagent-workspace="true">
        {/* Keeps iOS from leaving a stale blur over the top bar; see .top-edge-anchor.
            Placed before the top bar so its badges still paint above the strip. */}
        {!isDesktopShell && <div aria-hidden="true" data-testid="top-edge-anchor" className="top-edge-anchor" />}
        <TopBar
          fullPageLabel={secondaryAreaWidth === null ? fullPageRouteLabel : undefined}
          universalSearchOpen={universalSearchOpen}
          onOpenUniversalSearch={openUniversalSearch}
          onCloseUniversalSearch={closeUniversalSearch}
        />
        <UserContentNotice />
        <div className="flex-1 overflow-hidden relative">
          {/* Server unreachable banner — overlays content to avoid layout shift */}
          {showServerUnreachableBanner && (
            <div className="absolute top-0 left-0 right-0 z-10 px-4 py-2 bg-red-500/10 border-b border-red-500/20 backdrop-blur-sm text-center flex items-center justify-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-400 animate-pulse shrink-0" />
              <span className="text-xs text-red-400 font-medium">Server unreachable</span>
            </div>
          )}
          {isSessionView && (
            <>
              {/* Chat tab: the primary view. It stays mounted, hidden, while the diff or a
                  secondary page covers it, so returning to it does not rebuild the feed. */}
              <div className={`absolute inset-0 ${primaryHidden ? "invisible" : ""}`} inert={primaryHidden}>
                {displayedSessionId && isPendingId(displayedSessionId) ? (
                  <SessionCreationView pendingId={displayedSessionId} />
                ) : displayedSessionId ? (
                  conversationView
                ) : (
                  <EmptyState />
                )}
              </div>

              {/* Diff tab, covering the conversation where there is no right-hand area */}
              {currentSessionId && !isPendingId(currentSessionId) && activeTab === "diff" && !diffInSecondaryArea && (
                <div className="absolute inset-0 flex min-h-0 flex-col">
                  {diffTarget && (
                    <DiffTabView target={diffTarget} onBack={() => useStore.getState().setActiveTab("chat")} />
                  )}
                </div>
              )}
            </>
          )}

          {secondaryPage && secondaryAreaWidth === null && (
            <div className="absolute inset-0 z-[1] bg-cc-bg" data-testid="secondary-view-overlay">
              {renderSecondaryPage(secondaryPage)}
            </div>
          )}
        </div>
      </div>

      {secondaryAreaWidth !== null && (
        <SecondaryViewArea
          width={secondaryAreaWidth}
          open={secondaryAreaOpen}
          mode={secondaryViewMode}
          canShowBeside={canShowSecondaryBeside}
          // Viewers bring their own header and cover the page's.
          title={
            secondaryPage && !secondaryViewersOpen && !diffInSecondaryArea
              ? secondaryPageLabel(secondaryPage)
              : undefined
          }
          onClose={closeSecondaryPage}
          onDismiss={dismissSecondaryArea}
          contentRef={setSecondaryAreaElement}
        >
          {secondaryPage && renderSecondaryPage(secondaryPage)}
          {diffInSecondaryArea && diffTarget && (
            <div className="absolute inset-0 z-10 flex min-h-0 flex-col bg-cc-bg">
              <DiffTabView target={diffTarget} onBack={() => useStore.getState().setActiveTab("chat")} />
            </div>
          )}
        </SecondaryViewArea>
      )}

      {/* New session modal */}
      <NewSessionModal
        open={newSessionModalState !== null}
        groupKey={newSessionModalState?.groupKey}
        groupCwd={newSessionModalState?.cwd}
        groupHostId={newSessionModalState?.hostId}
        treeGroupId={newSessionModalState?.treeGroupId}
        newSessionDefaultsKey={newSessionModalState?.newSessionDefaultsKey}
        onClose={() => useStore.getState().closeNewSessionModal()}
      />

      {/* Session-global native Codex inspector. It lives outside ChatView so it remains
          available over Diff, plan review, and search-preview surfaces. */}
      {isSessionView && codexSubagentInspector && (
        <CodexSubagentInspector sessionId={codexSubagentInspector.sessionId} />
      )}

      {/* Quest details and Markdown files: in the right-hand area on wide screens, else full-screen */}
      <QuestDetailPanel />
      <MarkdownFileViewerHost />

      <UniversalSearchOverlay
        open={universalSearchOpen}
        currentSessionId={currentSessionId}
        currentThreadKey={universalSearchThreadKey}
        sessions={sdkSessions}
        leaderSessionId={currentSessionId ?? undefined}
        onClose={closeUniversalSearch}
        onOpenQuest={handleOpenUniversalQuest}
        onOpenMessage={handleOpenUniversalMessage}
      />

      {/* Task panel — overlay on mobile, inline on desktop */}
      {currentSessionId && isSessionView && !isPendingId(currentSessionId) && taskPanelOpen && (
        <>
          {/* Mobile overlay backdrop */}
          {!isDesktopTaskPanel && (
            <div
              className="fixed inset-0 bg-black/30 z-30"
              onClick={() => useStore.getState().setTaskPanelOpen(false)}
            />
          )}

          <div
            className={`
              ${isDesktopTaskPanel ? "relative z-auto w-[280px] translate-x-0" : "fixed z-40 right-0 top-0 w-[280px] translate-x-0"}
              h-full shrink-0 transition-all duration-200 overflow-hidden
            `}
          >
            <TaskPanel sessionId={currentSessionId} />
          </div>
        </>
      )}

      {/* Server restart overlay */}
      {serverRestartPhase && <ServerRestartOverlay phase={serverRestartPhase} />}
    </div>
  );
}
