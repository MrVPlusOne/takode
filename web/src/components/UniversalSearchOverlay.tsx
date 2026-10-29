import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  api,
  type GlobalStarredMessageSearchResponse,
  type GlobalStarredMessageSearchResult,
  type MessageSearchResponse,
  type MessageSearchResult,
  type MessageSearchScopeKind,
  type RecentAskBundle,
  type RecentAskBundlesResponse,
} from "../api.js";
import type { QuestListPreview, SdkSessionInfo } from "../types.js";
import {
  getQuestDisplayOwner,
  getQuestLeaderSessionId,
  getQuestOwnerSessionId,
  timeAgo,
} from "../utils/quest-helpers.js";
import { getQuestRecordStatusTheme } from "../utils/quest-status-theme.js";
import { getHighlightParts } from "../utils/highlight.js";
import { writeClipboardText } from "../utils/copy-utils.js";
import { navigateToSession, navigateToSessionThread } from "../utils/routing.js";
import { useArchivedSessionMatches } from "./universal-search-archived-sessions.js";
import { scopedGetItem, scopedSetItem } from "../utils/scoped-storage.js";
import { isAllThreadsKey } from "../utils/thread-projection.js";
import { compareSearchRanks, rankSearchFields, type SearchRank } from "../../shared/search-utils.js";
import { QuestInlineLink } from "./QuestInlineLink.js";
import { SessionInlineLink } from "./SessionInlineLink.js";
import { StarIcon } from "./StarredMessageIndicator.js";
import { RecentAskBundleResult } from "./RecentAskBundleResult.js";
import {
  HIDDEN_SCROLLBAR_CLASS,
  SEARCH_ROW_CLASS,
  SearchField,
  SearchMeta,
  SearchModeSwitch,
  SearchRowContent,
  SearchSheet,
} from "./SearchSheet.js";
import { CodexQuestOwnerChip } from "./CodexQuestOwnerChip.js";

export type UniversalSearchMode = "recent" | "quests" | "sessions" | "messages" | "starred";

type MessageFilter = "user" | "assistant" | "event";
type MessageFilters = Record<MessageFilter, boolean>;
type MessageSearchSettings = {
  scope: MessageSearchScopeKind;
  filters: MessageFilters;
};

type UniversalSearchResult =
  | { kind: "quest"; id: string; quest: QuestListPreview }
  | { kind: "session"; id: string; session: SdkSessionInfo; rank: SearchRank | null }
  | { kind: "message"; id: string; message: MessageSearchResult | GlobalStarredMessageSearchResult }
  | { kind: "recent_ask"; id: string; bundle: RecentAskBundle };

type QuestResultAction =
  | { id: "copy"; label: string }
  | { id: "leader" | "worker"; label: string; sessionId: string; sessionNum: number | null };

export interface UniversalSearchOverlayProps {
  open: boolean;
  currentSessionId: string | null;
  currentThreadKey?: string | null;
  sessions: SdkSessionInfo[];
  leaderSessionId?: string;
  recentAskPreviewResponse?: RecentAskBundlesResponse;
  messageSearchPreviewResponse?: MessageSearchResponse;
  starredSearchPreviewResponse?: GlobalStarredMessageSearchResponse;
  presentation?: "fixed" | "inline";
  initialMode?: UniversalSearchMode;
  initialQuery?: string;
  onClose: () => void;
  onOpenQuest: (questId: string, query: string) => void;
  onOpenMessage: (sessionId: string, messageId: string, threadKey?: string | null) => void;
}

const PAGE_SIZE = 20;
const DEBOUNCE_MS = 300;
const LAST_MODE_STORAGE_KEY = "cc-universal-search-mode";
const LAST_QUERY_STORAGE_KEY = "cc-universal-search-query";
const MESSAGE_SETTINGS_STORAGE_KEY = "cc-universal-search-message-settings";
const SESSION_FILTERS: Array<{ id: "includeArchived" | "leadersOnly"; label: string }> = [
  { id: "includeArchived", label: "Include archived" },
  { id: "leadersOnly", label: "Leaders only" },
];

const MODE_OPTIONS: Array<{ id: UniversalSearchMode; label: string; title: string }> = [
  { id: "recent", label: "Recent", title: "Browse recent conversations" },
  { id: "quests", label: "Quests", title: "Search quests" },
  { id: "sessions", label: "Sessions", title: "Search sessions" },
  { id: "messages", label: "Messages", title: "Search messages" },
  { id: "starred", label: "Starred", title: "Search starred messages" },
];

const MESSAGE_FILTERS: Array<{ id: MessageFilter; label: string }> = [
  { id: "user", label: "User" },
  { id: "assistant", label: "Assistant" },
  { id: "event", label: "Events" },
];

const DEFAULT_MESSAGE_SEARCH_SETTINGS: MessageSearchSettings = {
  scope: "current_thread",
  filters: {
    user: true,
    assistant: false,
    event: false,
  },
};

/** The row shown as selected for a stored index, given a non-empty result list. */
function clampSelection(index: number, resultCount: number): number {
  return Math.min(Math.max(index, 0), resultCount - 1);
}

function useDebouncedValue(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs, value]);

  return debounced;
}

function isUniversalSearchMode(value: string | null): value is UniversalSearchMode {
  return (
    value === "recent" || value === "quests" || value === "sessions" || value === "messages" || value === "starred"
  );
}

function readLastMode(): UniversalSearchMode | null {
  if (typeof window === "undefined") return null;
  const stored = scopedGetItem(LAST_MODE_STORAGE_KEY);
  return isUniversalSearchMode(stored) ? stored : null;
}

function writeLastMode(mode: UniversalSearchMode): void {
  if (typeof window === "undefined") return;
  scopedSetItem(LAST_MODE_STORAGE_KEY, mode);
}

function readLastQuery(): string {
  if (typeof window === "undefined") return "";
  return scopedGetItem(LAST_QUERY_STORAGE_KEY) ?? "";
}

function writeLastQuery(query: string): void {
  if (typeof window === "undefined") return;
  scopedSetItem(LAST_QUERY_STORAGE_KEY, query);
}

function readMessageSearchSettings(): MessageSearchSettings {
  if (typeof window === "undefined") return DEFAULT_MESSAGE_SEARCH_SETTINGS;
  const stored = scopedGetItem(MESSAGE_SETTINGS_STORAGE_KEY);
  if (!stored) return DEFAULT_MESSAGE_SEARCH_SETTINGS;
  try {
    const parsed = JSON.parse(stored) as Partial<MessageSearchSettings>;
    return normalizeStoredMessageSearchSettings(parsed);
  } catch {
    return DEFAULT_MESSAGE_SEARCH_SETTINGS;
  }
}

function writeMessageSearchSettings(settings: MessageSearchSettings): void {
  if (typeof window === "undefined") return;
  scopedSetItem(MESSAGE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function normalizeStoredMessageSearchSettings(settings: Partial<MessageSearchSettings>): MessageSearchSettings {
  const scope =
    settings.scope === "session" || settings.scope === "current_thread" || settings.scope === "leader_all_tabs"
      ? settings.scope
      : DEFAULT_MESSAGE_SEARCH_SETTINGS.scope;
  return {
    scope,
    filters: {
      user:
        typeof settings.filters?.user === "boolean"
          ? settings.filters.user
          : DEFAULT_MESSAGE_SEARCH_SETTINGS.filters.user,
      assistant:
        typeof settings.filters?.assistant === "boolean"
          ? settings.filters.assistant
          : DEFAULT_MESSAGE_SEARCH_SETTINGS.filters.assistant,
      event:
        typeof settings.filters?.event === "boolean"
          ? settings.filters.event
          : DEFAULT_MESSAGE_SEARCH_SETTINGS.filters.event,
    },
  };
}

interface InitialSearchState {
  mode: UniversalSearchMode;
  query: string;
  recentSearchOrigin: boolean;
}

function resolveInitialSearchState(
  initialMode: UniversalSearchMode | undefined,
  initialQuery: string | undefined,
): InitialSearchState {
  const query = initialQuery ?? readLastQuery();
  const requestedMode = initialMode ?? readLastMode() ?? "recent";
  const recentSearchOrigin = requestedMode === "recent" && query.trim().length > 0;
  return {
    mode: recentSearchOrigin ? "messages" : requestedMode,
    query,
    recentSearchOrigin,
  };
}

function normalizeMessageSearchScope(input: {
  preferredScope: MessageSearchScopeKind;
  isLeaderSession: boolean;
  currentThreadKey?: string | null;
}): MessageSearchScopeKind {
  if (!input.isLeaderSession) return "session";
  if (
    input.preferredScope === "leader_all_tabs" ||
    !input.currentThreadKey ||
    isAllThreadsKey(input.currentThreadKey)
  ) {
    return "leader_all_tabs";
  }
  return "current_thread";
}

function localMessageScopeLabel(
  sessionNum: number | null,
  scope: MessageSearchScopeKind,
  currentThreadKey?: string | null,
): string {
  const sessionLabel = typeof sessionNum === "number" ? `#${sessionNum}` : "current session";
  if (scope === "session") {
    return typeof sessionNum === "number" ? `Searching in session ${sessionLabel}` : "Searching in current session";
  }
  if (scope === "leader_all_tabs") return `Searching in ${sessionLabel} across tabs`;
  const threadLabel = currentThreadKey && currentThreadKey !== "main" ? `thread ${currentThreadKey}` : "Main";
  return `Searching in ${sessionLabel} ${threadLabel}`;
}

function questRecency(quest: QuestListPreview): number {
  return Math.max(quest.createdAt ?? 0, quest.updatedAt ?? 0, quest.statusChangedAt ?? 0);
}

function nextMode(current: UniversalSearchMode, direction: 1 | -1): UniversalSearchMode {
  const modes: UniversalSearchMode[] = ["recent", "quests", "sessions", "messages", "starred"];
  const currentIndex = Math.max(0, modes.indexOf(current));
  return modes[(currentIndex + direction + modes.length) % modes.length]!;
}

function isComposingEnter(event: KeyboardEvent<HTMLElement>): boolean {
  return event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229);
}

function sessionNumForId(sessions: SdkSessionInfo[], sessionId: string | null): number | null {
  if (!sessionId) return null;
  return sessions.find((session) => session.sessionId === sessionId)?.sessionNum ?? null;
}

function getQuestResultActions(quest: QuestListPreview, sessions: SdkSessionInfo[]): QuestResultAction[] {
  const leaderSessionId = getQuestLeaderSessionId(quest);
  const workerSessionId = getQuestOwnerSessionId(quest);
  const leaderSessionNum = sessionNumForId(sessions, leaderSessionId);
  const workerSessionNum = sessionNumForId(sessions, workerSessionId);
  const actions: QuestResultAction[] = [{ id: "copy", label: "Copy quest number" }];

  if (leaderSessionId) {
    actions.push({
      id: "leader",
      label: `Open its tab in leader${leaderSessionNum != null ? ` #${leaderSessionNum}` : ""}`,
      sessionId: leaderSessionId,
      sessionNum: leaderSessionNum,
    });
  }
  if (workerSessionId) {
    actions.push({
      id: "worker",
      label: `Go to worker session${workerSessionNum != null ? ` #${workerSessionNum}` : ""}`,
      sessionId: workerSessionId,
      sessionNum: workerSessionNum,
    });
  }
  return actions;
}

function sessionDisplayName(session: SdkSessionInfo): string {
  return (
    session.name?.trim() || (typeof session.sessionNum === "number" ? `#${session.sessionNum}` : session.sessionId)
  );
}

function sessionSearchFields(session: SdkSessionInfo) {
  return [
    { rank: 0, text: sessionDisplayName(session) },
    { rank: 1, text: typeof session.sessionNum === "number" ? `#${session.sessionNum}` : undefined },
    { rank: 2, text: session.gitBranch },
    { rank: 3, text: session.cwd },
    { rank: 4, text: session.repoRoot },
    { rank: 5, text: session.keywords?.join(" ") },
  ];
}

function sessionRecency(session: SdkSessionInfo): number {
  return session.lastActivityAt ?? session.lastUserMessageAt ?? session.createdAt;
}

function searchSessionsForOverlay(
  sessions: SdkSessionInfo[],
  query: string,
): Array<{ session: SdkSessionInfo; rank: SearchRank | null }> {
  const trimmed = query.trim();
  const candidates = sessions.filter((session) => !session.archived);
  if (!trimmed) {
    return candidates
      .map((session) => ({ session, rank: null }))
      .sort((a, b) => sessionRecency(b.session) - sessionRecency(a.session));
  }

  return candidates
    .map((session) => ({ session, rank: rankSearchFields(sessionSearchFields(session), trimmed) }))
    .filter((item): item is { session: SdkSessionInfo; rank: SearchRank } => item.rank !== null)
    .sort((a, b) => compareSearchRanks(a.rank, b.rank) || sessionRecency(b.session) - sessionRecency(a.session));
}

export function UniversalSearchOverlay({
  open,
  currentSessionId,
  currentThreadKey,
  sessions,
  presentation = "fixed",
  onClose,
  onOpenQuest,
  onOpenMessage,
  recentAskPreviewResponse,
  messageSearchPreviewResponse,
  starredSearchPreviewResponse,
  initialMode,
  initialQuery,
}: UniversalSearchOverlayProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const requestSeqRef = useRef(0);
  // Message results already loaded for one search, so scrolling fetches only the next page.
  const messagePagesRef = useRef<{ key: string; loaded: number; total: number } | null>(null);
  const sessionByIdRef = useRef<Map<string, SdkSessionInfo>>(new Map());
  const searchKeyRef = useRef("");
  const copiedResetTimerRef = useRef<number | null>(null);
  const initialSearchStateRef = useRef<InitialSearchState | null>(null);
  if (initialSearchStateRef.current == null) {
    initialSearchStateRef.current = resolveInitialSearchState(initialMode, initialQuery);
  }
  const currentSessionAvailable = Boolean(currentSessionId);

  const [mode, setMode] = useState<UniversalSearchMode>(initialSearchStateRef.current.mode);
  const [query, setQuery] = useState(initialSearchStateRef.current.query);
  const [recentSearchOrigin, setRecentSearchOrigin] = useState(initialSearchStateRef.current.recentSearchOrigin);
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentSessionSpaceId, setRecentSessionSpaceId] = useState<string | null>(null);
  const [messageSettings, setMessageSettings] = useState<MessageSearchSettings>(() => readMessageSearchSettings());
  const [sessionFilters, setSessionFilters] = useState({ includeArchived: false, leadersOnly: false });
  const [copiedQuestId, setCopiedQuestId] = useState<string | null>(null);
  const [questActionMenu, setQuestActionMenu] = useState<{ resultId: string; selectedActionIndex: number } | null>(
    null,
  );
  const [remoteState, setRemoteState] = useState<{
    mode: "recent" | "quests" | "messages" | "starred" | null;
    status: "idle" | "loading" | "error";
    results: UniversalSearchResult[];
    total: number;
    scopeLabel?: string;
    recentMeta?: Omit<RecentAskBundlesResponse, "groups">;
    query?: string;
  }>({ mode: null, status: "idle", results: [], total: 0 });

  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.sessionId, session] as const)),
    [sessions],
  );
  const currentSession = currentSessionId ? sessionById.get(currentSessionId) : undefined;
  const isLeaderSession = currentSession?.isOrchestrator === true;
  const effectiveMessageScope = normalizeMessageSearchScope({
    preferredScope: messageSettings.scope,
    isLeaderSession,
    currentThreadKey,
  });
  const messageScopeLabel =
    remoteState.mode === "messages" && remoteState.scopeLabel
      ? remoteState.scopeLabel
      : currentSessionId
        ? localMessageScopeLabel(currentSession?.sessionNum ?? null, effectiveMessageScope, currentThreadKey)
        : "Open a session to search messages";
  const recentMeta = remoteState.mode === "recent" ? remoteState.recentMeta : undefined;
  const archivedSessionMatches = useArchivedSessionMatches(
    debouncedQuery,
    mode === "sessions" && sessionFilters.includeArchived,
    sessionFilters.leadersOnly,
  );
  const allSessionMatches = useMemo(() => {
    const candidates = sessionFilters.leadersOnly
      ? sessions.filter((session) => session.isOrchestrator === true)
      : sessions;
    const active = searchSessionsForOverlay(candidates, debouncedQuery);
    const activeIds = new Set(active.map(({ session }) => session.sessionId));
    const archived = archivedSessionMatches
      .filter((session) => !activeIds.has(session.sessionId))
      .map((session) => ({ session, rank: null }));
    return [...active, ...archived];
  }, [archivedSessionMatches, debouncedQuery, sessionFilters.leadersOnly, sessions]);
  const sessionResults = useMemo(
    () =>
      allSessionMatches.slice(0, visibleLimit).map(({ session, rank }) => ({
        kind: "session" as const,
        id: session.sessionId,
        session,
        rank,
      })),
    [allSessionMatches, visibleLimit],
  );
  const totalSessionResults = allSessionMatches.length;

  useEffect(() => {
    sessionByIdRef.current = sessionById;
  }, [sessionById]);

  useEffect(
    () => () => {
      if (copiedResetTimerRef.current != null) window.clearTimeout(copiedResetTimerRef.current);
    },
    [],
  );

  const setUserMode = useCallback((next: UniversalSearchMode) => {
    setRecentSearchOrigin(false);
    setMode(next);
    writeLastMode(next);
    if (next === "recent") {
      setQuery("");
      writeLastQuery("");
    }
  }, []);

  const setUserQuery = useCallback(
    (next: string) => {
      const hasQuery = next.trim().length > 0;
      setQuery(next);
      writeLastQuery(next);
      if (mode === "recent" && hasQuery) {
        setRecentSearchOrigin(true);
        setMode("messages");
      } else if (mode === "messages" && recentSearchOrigin && !hasQuery) {
        setRecentSearchOrigin(false);
        setMode("recent");
      }
    },
    [mode, recentSearchOrigin],
  );

  useEffect(() => {
    if (!open || presentation !== "fixed") return;
    const activeElement = document.activeElement;
    returnFocusRef.current =
      activeElement instanceof HTMLElement && activeElement !== document.body ? activeElement : null;
    return () => {
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      window.requestAnimationFrame(() => {
        if (target?.isConnected) target.focus();
      });
    };
  }, [open, presentation]);

  useEffect(() => {
    if (!open) return;
    const initialState = resolveInitialSearchState(initialMode, initialQuery);
    // Opening searches afresh: no page of an earlier search is kept.
    messagePagesRef.current = null;
    setMode(initialState.mode);
    setRecentSearchOrigin(initialState.recentSearchOrigin);
    setMessageSettings(readMessageSearchSettings());
    setQuery(initialState.query);
    setVisibleLimit(PAGE_SIZE);
    setSelectedIndex(0);
    setRecentSessionSpaceId(null);
    setQuestActionMenu(null);
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [currentSessionId, initialMode, initialQuery, open]);

  useEffect(() => {
    writeMessageSearchSettings(messageSettings);
  }, [messageSettings]);

  useEffect(() => {
    setVisibleLimit(PAGE_SIZE);
    setSelectedIndex(0);
    setQuestActionMenu(null);
    listRef.current?.scrollTo({ top: 0 });
  }, [
    debouncedQuery,
    effectiveMessageScope,
    messageSettings.filters.assistant,
    messageSettings.filters.event,
    messageSettings.filters.user,
    mode,
    recentSessionSpaceId,
  ]);

  const liveMessageQuery = mode === "messages" ? query.trim() : "";
  const resultQuery = mode === "messages" ? liveMessageQuery : debouncedQuery.trim();
  const searchKey = `${mode}:${resultQuery}:scope=${effectiveMessageScope}:thread=${currentThreadKey ?? ""}:user=${messageSettings.filters.user}:assistant=${messageSettings.filters.assistant}:event=${messageSettings.filters.event}:space=${recentSessionSpaceId ?? ""}`;

  useEffect(() => {
    if (!open) return;
    const trimmedQuery = debouncedQuery.trim();
    const requestSeq = ++requestSeqRef.current;

    if (mode === "recent") {
      if (recentAskPreviewResponse) {
        const { groups, ...recentMeta } = recentAskPreviewResponse;
        setRemoteState({
          mode: "recent",
          status: "idle",
          total: recentAskPreviewResponse.totalMatches,
          results: groups.map((bundle) => ({ kind: "recent_ask" as const, id: bundle.id, bundle })),
          recentMeta,
        });
        return;
      }
      const controller = new AbortController();
      setRemoteState((current) => ({
        ...current,
        mode: "recent",
        status: "loading",
        results: current.mode === "recent" ? current.results : [],
      }));
      void api
        .fetchRecentAskBundles({
          sessionSpaceId: recentSessionSpaceId,
          signal: controller.signal,
        })
        .then((response: RecentAskBundlesResponse) => {
          if (controller.signal.aborted || requestSeq !== requestSeqRef.current) return;
          const { groups, ...recentMeta } = response;
          setRemoteState({
            mode: "recent",
            status: "idle",
            total: response.totalMatches,
            results: groups.map((bundle) => ({ kind: "recent_ask" as const, id: bundle.id, bundle })),
            recentMeta,
          });
        })
        .catch((err) => {
          if (controller.signal.aborted || requestSeq !== requestSeqRef.current) return;
          console.warn("[universal-search] recent asks failed:", err);
          setRemoteState({ mode: "recent", status: "error", total: 0, results: [] });
        });
      return () => controller.abort();
    }

    if (mode === "quests") {
      const controller = new AbortController();
      setRemoteState((current) => ({
        ...current,
        mode: "quests",
        status: "loading",
        results: current.mode === "quests" ? current.results : [],
      }));
      void api
        .listQuestPage(
          {
            limit: visibleLimit,
            text: trimmedQuery || undefined,
            sortColumn: trimmedQuery ? undefined : "updated",
            sortDirection: trimmedQuery ? undefined : "desc",
          },
          controller.signal,
        )
        .then((page) => {
          if (controller.signal.aborted || requestSeq !== requestSeqRef.current) return;
          setRemoteState({
            mode: "quests",
            status: "idle",
            total: page.total,
            results: page.quests.map((quest) => ({ kind: "quest", id: quest.questId, quest })),
          });
        })
        .catch((err) => {
          if (controller.signal.aborted || requestSeq !== requestSeqRef.current) return;
          console.warn("[universal-search] quest search failed:", err);
          setRemoteState({ mode: "quests", status: "error", total: 0, results: [] });
        });
      return () => controller.abort();
    }

    if (mode === "messages") {
      const nextScopeLabel = currentSessionId
        ? localMessageScopeLabel(currentSession?.sessionNum ?? null, effectiveMessageScope, currentThreadKey)
        : "Current session required";
      if (!currentSessionId) {
        setRemoteState({
          mode: "messages",
          status: "idle",
          total: 0,
          results: [],
          scopeLabel: nextScopeLabel,
          query: liveMessageQuery,
        });
        return;
      }
      if (trimmedQuery !== liveMessageQuery) {
        setRemoteState({
          mode: "messages",
          status: "loading",
          total: 0,
          results: [],
          scopeLabel: nextScopeLabel,
          query: liveMessageQuery,
        });
        return;
      }
      if (messageSearchPreviewResponse) {
        setRemoteState({
          mode: "messages",
          status: "idle",
          total: messageSearchPreviewResponse.totalMatches,
          scopeLabel: messageSearchPreviewResponse.scope.label,
          results: messageSearchPreviewResponse.results.map((message) => ({
            kind: "message",
            id: message.id,
            message,
          })),
          query: liveMessageQuery,
        });
        return;
      }
      // An empty query lists the messages newest first. Scrolling asks only for the next page of
      // the same search, so a long history is read a page at a time.
      const page = messagePagesRef.current?.key === searchKey ? messagePagesRef.current : null;
      if (page && (page.loaded >= visibleLimit || page.loaded >= page.total)) return;
      const offset = page?.loaded ?? 0;
      const controller = new AbortController();
      setRemoteState((current) =>
        page && current.mode === "messages"
          ? { ...current, status: "loading" }
          : {
              mode: "messages",
              status: "loading",
              total: 0,
              results: [],
              scopeLabel: nextScopeLabel,
              query: liveMessageQuery,
            },
      );
      void api
        .searchSessionMessages(currentSessionId, {
          query: liveMessageQuery,
          scope: effectiveMessageScope,
          threadKey: effectiveMessageScope === "current_thread" ? currentThreadKey || "main" : undefined,
          filters: messageSettings.filters,
          limit: visibleLimit - offset,
          ...(offset ? { offset } : {}),
          signal: controller.signal,
        })
        .then((response) => {
          if (controller.signal.aborted || requestSeq !== requestSeqRef.current) return;
          const added = response.results.map((message) => ({ kind: "message" as const, id: message.id, message }));
          messagePagesRef.current = { key: searchKey, loaded: offset + added.length, total: response.totalMatches };
          setRemoteState((current) => ({
            mode: "messages",
            status: "idle",
            total: response.totalMatches,
            scopeLabel: response.scope.label,
            results: offset && current.mode === "messages" ? [...current.results, ...added] : added,
            query: liveMessageQuery,
          }));
        })
        .catch((err) => {
          if (controller.signal.aborted || requestSeq !== requestSeqRef.current) return;
          console.warn("[universal-search] message search failed:", err);
          setRemoteState({
            mode: "messages",
            status: "error",
            total: 0,
            results: [],
            scopeLabel: nextScopeLabel,
            query: liveMessageQuery,
          });
        });
      return () => controller.abort();
    }

    if (mode === "starred") {
      if (starredSearchPreviewResponse) {
        setRemoteState({
          mode: "starred",
          status: "idle",
          total: starredSearchPreviewResponse.totalMatches,
          results: starredSearchPreviewResponse.results.map((message) => ({
            kind: "message",
            id: message.id,
            message,
          })),
        });
        return;
      }
      const controller = new AbortController();
      setRemoteState((current) => ({
        ...current,
        mode: "starred",
        status: "loading",
        results: current.mode === "starred" ? current.results : [],
      }));
      void api
        .searchGlobalStarredMessages({
          query: trimmedQuery,
          limit: visibleLimit,
          signal: controller.signal,
        })
        .then((response: GlobalStarredMessageSearchResponse) => {
          if (controller.signal.aborted || requestSeq !== requestSeqRef.current) return;
          setRemoteState({
            mode: "starred",
            status: "idle",
            total: response.totalMatches,
            results: response.results.map((message) => ({ kind: "message", id: message.id, message })),
          });
        })
        .catch((err) => {
          if (controller.signal.aborted || requestSeq !== requestSeqRef.current) return;
          console.warn("[universal-search] starred search failed:", err);
          setRemoteState({ mode: "starred", status: "error", total: 0, results: [] });
        });
      return () => controller.abort();
    }
  }, [
    currentSessionId,
    currentSession?.sessionNum,
    currentThreadKey,
    debouncedQuery,
    effectiveMessageScope,
    liveMessageQuery,
    messageSearchPreviewResponse,
    messageSettings.filters,
    mode,
    open,
    recentAskPreviewResponse,
    recentSessionSpaceId,
    searchKey,
    starredSearchPreviewResponse,
    visibleLimit,
  ]);

  const results = useMemo(() => {
    if (mode === "recent") return remoteState.mode === "recent" ? remoteState.results : [];
    if (mode === "quests") return remoteState.mode === "quests" ? remoteState.results : [];
    if (mode === "sessions") return sessionResults;
    if (mode === "starred") return remoteState.mode === "starred" ? remoteState.results : [];
    return remoteState.mode === "messages" && remoteState.query === liveMessageQuery ? remoteState.results : [];
  }, [liveMessageQuery, mode, remoteState, sessionResults]);

  const totalResults = useMemo(() => {
    if (mode === "recent" && remoteState.mode === "recent") return remoteState.total;
    if (mode === "quests" && remoteState.mode === "quests") return remoteState.total;
    if (mode === "sessions") return totalSessionResults;
    if (mode === "messages" && remoteState.mode === "messages" && remoteState.query === liveMessageQuery) {
      return remoteState.total;
    }
    if (mode === "starred" && remoteState.mode === "starred") return remoteState.total;
    return 0;
  }, [liveMessageQuery, mode, remoteState, totalSessionResults]);

  const messageQueryWaitingForDebounce =
    mode === "messages" &&
    currentSessionAvailable &&
    liveMessageQuery.length > 0 &&
    debouncedQuery.trim() !== liveMessageQuery;
  const loading =
    messageQueryWaitingForDebounce ||
    ((mode === "recent" || mode === "quests" || mode === "messages" || mode === "starred") &&
      remoteState.mode === mode &&
      remoteState.status === "loading" &&
      (mode !== "messages" || remoteState.query === liveMessageQuery));
  const error =
    (mode === "recent" || mode === "quests" || mode === "messages" || mode === "starred") &&
    remoteState.mode === mode &&
    remoteState.status === "error" &&
    (mode !== "messages" || remoteState.query === liveMessageQuery);
  const hasMore = mode !== "recent" && results.length < totalResults;
  const selectedResultIndex = results.length === 0 ? -1 : clampSelection(selectedIndex, results.length);

  useEffect(() => {
    setSelectedIndex((current) => {
      if (results.length === 0) return -1;
      if (searchKeyRef.current !== searchKey) return 0;
      if (current < 0) return 0;
      return Math.min(current, results.length - 1);
    });
    searchKeyRef.current = searchKey;
  }, [results.length, searchKey]);

  useEffect(() => {
    if (!questActionMenu) return;
    const result = results.find(
      (item): item is Extract<UniversalSearchResult, { kind: "quest" }> =>
        item.kind === "quest" && item.id === questActionMenu.resultId,
    );
    if (!result) {
      setQuestActionMenu(null);
      return;
    }
    const actionCount = getQuestResultActions(result.quest, sessions).length;
    if (questActionMenu.selectedActionIndex >= actionCount) {
      setQuestActionMenu({ resultId: questActionMenu.resultId, selectedActionIndex: Math.max(0, actionCount - 1) });
    }
  }, [questActionMenu, results, sessions]);

  const openResult = useCallback(
    (result: UniversalSearchResult | undefined) => {
      if (!result) return;
      if (result.kind === "quest") {
        onOpenQuest(result.quest.questId, debouncedQuery.trim());
      } else if (result.kind === "session") {
        navigateToSession(result.session.sessionId);
      } else if (result.kind === "recent_ask") {
        const first = result.bundle.members[0];
        if (first) onOpenMessage(result.bundle.sessionId, first.messageId, result.bundle.ownerThreadKey);
      } else {
        onOpenMessage(
          result.message.sessionId,
          result.message.messageId,
          result.message.routeThreadKey ?? currentThreadKey,
        );
      }
      onClose();
    },
    [currentThreadKey, debouncedQuery, onClose, onOpenMessage, onOpenQuest],
  );

  const copyQuestId = useCallback((questId: string) => {
    void writeClipboardText(questId)
      .then(() => {
        setCopiedQuestId(questId);
        if (copiedResetTimerRef.current != null) window.clearTimeout(copiedResetTimerRef.current);
        copiedResetTimerRef.current = window.setTimeout(() => setCopiedQuestId(null), 1200);
      })
      .catch((error) => console.error("Failed to copy quest ID:", error));
  }, []);

  const activateQuestResultAction = useCallback(
    (quest: QuestListPreview, action: QuestResultAction) => {
      if (action.id === "copy") {
        copyQuestId(quest.questId);
        setQuestActionMenu(null);
        return;
      }
      if (action.id === "leader") {
        navigateToSessionThread(action.sessionId, quest.questId, false, action.sessionNum ?? action.sessionId);
        setQuestActionMenu(null);
        onClose();
        return;
      }
      navigateToSession(action.sessionId);
      setQuestActionMenu(null);
      onClose();
    },
    [copyQuestId, onClose],
  );

  const cycleMode = useCallback(
    (direction: 1 | -1) => {
      setUserMode(nextMode(mode, direction));
    },
    [mode, setUserMode],
  );

  function handleKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (isComposingEnter(event)) return;

    if (questActionMenu) {
      const menuResult = results.find(
        (result): result is Extract<UniversalSearchResult, { kind: "quest" }> =>
          result.kind === "quest" && result.id === questActionMenu.resultId,
      );
      const actions = menuResult ? getQuestResultActions(menuResult.quest, sessions) : [];
      const selectedActionIndex =
        actions.length > 0 ? Math.min(questActionMenu.selectedActionIndex, actions.length - 1) : 0;

      if (!menuResult || actions.length === 0) {
        setQuestActionMenu(null);
      } else if (event.key === "Escape" || event.key === "ArrowLeft") {
        setQuestActionMenu(null);
        event.preventDefault();
        event.stopPropagation();
        return;
      } else if (event.key === "ArrowDown") {
        setQuestActionMenu({
          resultId: questActionMenu.resultId,
          selectedActionIndex: (selectedActionIndex + 1) % actions.length,
        });
        event.preventDefault();
        return;
      } else if (event.key === "ArrowUp") {
        setQuestActionMenu({
          resultId: questActionMenu.resultId,
          selectedActionIndex: (selectedActionIndex - 1 + actions.length) % actions.length,
        });
        event.preventDefault();
        return;
      } else if (event.key === "Enter") {
        activateQuestResultAction(menuResult.quest, actions[selectedActionIndex]!);
        event.preventDefault();
        return;
      }
    }

    if (event.key === "Escape") {
      onClose();
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key === "Tab") {
      cycleMode(event.shiftKey ? -1 : 1);
      event.preventDefault();
      return;
    }
    // Step from the row the list shows as selected: until new results' selection effect runs,
    // the stored index can still be -1 while the top row is already highlighted.
    if (event.key === "ArrowDown") {
      if (results.length > 0)
        setSelectedIndex((current) => (clampSelection(current, results.length) + 1) % results.length);
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowUp") {
      if (results.length > 0)
        setSelectedIndex((current) => (clampSelection(current, results.length) - 1 + results.length) % results.length);
      event.preventDefault();
      return;
    }
    if (event.key === "ArrowRight") {
      const result = results[selectedResultIndex];
      if (result?.kind === "quest") {
        setQuestActionMenu({ resultId: result.id, selectedActionIndex: 0 });
        event.preventDefault();
      }
      return;
    }
    if (event.key === "Enter") {
      openResult(results[selectedResultIndex]);
      event.preventDefault();
    }
  }

  function handleScroll() {
    const el = listRef.current;
    if (!el || !hasMore || loading) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 64) {
      setVisibleLimit((current) => current + PAGE_SIZE);
    }
  }

  if (!open) return null;

  const modeLabel = MODE_OPTIONS.find((option) => option.id === mode)?.label ?? "Search";
  const placeholder =
    mode === "recent"
      ? currentSessionAvailable
        ? "Search this session's messages"
        : "Browse recent conversations"
      : mode === "quests"
        ? "Search quests"
        : mode === "sessions"
          ? "Search sessions"
          : mode === "starred"
            ? "Search starred messages"
            : currentSessionAvailable
              ? "Search messages"
              : "Open a session to search messages";

  return (
    <SearchSheet
      label="Universal Search"
      presentation={presentation}
      layerClassName="z-[80]"
      onClose={onClose}
      onKeyDown={handleKeyDown}
      dataMode={mode}
      header={
        <SearchModeSwitch
          label="Search mode"
          options={MODE_OPTIONS}
          value={mode}
          onChange={setUserMode}
          testId="universal-search-mode"
        />
      }
    >
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {modeLabel} mode
      </div>
      <span role="status" className="sr-only">
        {loading ? "Searching..." : `${results.length}${hasMore ? "+" : ""} ${modeLabel.toLowerCase()}`}
      </span>
      <SearchField
        inputRef={inputRef}
        type="text"
        role="searchbox"
        inputMode="search"
        aria-label="Universal Search query"
        value={query}
        onChange={(event) => setUserQuery(event.target.value)}
        placeholder={placeholder}
        trailing={
          loading ? (
            <span
              aria-hidden="true"
              className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-cc-muted/30 border-t-cc-primary motion-safe:animate-spin"
            />
          ) : null
        }
      />
      {/* Recent browses the user's own messages, so it offers no attention filters; only
          the Session Space choice, when there is more than one. */}
      {mode === "recent" && (recentMeta?.sessionSpaces.length ?? 0) > 1 && (
        <SearchFilterRow>
          <select
            aria-label="Filter recent conversations by Session Space"
            value={recentSessionSpaceId ?? ""}
            onChange={(event) => setRecentSessionSpaceId(event.target.value || null)}
            className={`${FILTER_CHIP_CLASS} max-w-48 bg-transparent outline-none ${
              recentSessionSpaceId ? FILTER_CHIP_ACTIVE_CLASS : FILTER_CHIP_IDLE_CLASS
            }`}
          >
            <option value="">All Session Spaces</option>
            {recentMeta?.sessionSpaces.map((space) => (
              <option key={space.id} value={space.id}>
                {space.name} ({space.count})
              </option>
            ))}
          </select>
        </SearchFilterRow>
      )}
      {mode === "sessions" && (
        <SearchFilterRow>
          {SESSION_FILTERS.map((filter) => (
            <FilterChip
              key={filter.id}
              active={sessionFilters[filter.id]}
              onClick={() =>
                setSessionFilters((current) => ({
                  ...current,
                  [filter.id]: !current[filter.id],
                }))
              }
              label={filter.label}
            />
          ))}
        </SearchFilterRow>
      )}
      {mode === "messages" && currentSessionAvailable && (
        <SearchFilterRow>
          {isLeaderSession && (
            <>
              <FilterChip
                active={effectiveMessageScope === "current_thread"}
                disabled={!currentThreadKey || isAllThreadsKey(currentThreadKey)}
                onClick={() =>
                  setMessageSettings((current) => ({
                    ...current,
                    scope: "current_thread",
                  }))
                }
                label="Current tab"
              />
              <FilterChip
                active={effectiveMessageScope === "leader_all_tabs"}
                onClick={() =>
                  setMessageSettings((current) => ({
                    ...current,
                    scope: "leader_all_tabs",
                  }))
                }
                label="Across tabs"
              />
              <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-cc-border" />
            </>
          )}
          {MESSAGE_FILTERS.map((filter) => (
            <FilterChip
              key={filter.id}
              active={messageSettings.filters[filter.id]}
              onClick={() =>
                setMessageSettings((current) => ({
                  ...current,
                  filters: {
                    ...current.filters,
                    [filter.id]: !current.filters[filter.id],
                  },
                }))
              }
              label={filter.label}
            />
          ))}
          <span className="ml-1 shrink-0 text-[11.5px] text-cc-muted">{messageScopeLabel}</span>
        </SearchFilterRow>
      )}

      <div ref={listRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto pb-6">
        {mode === "messages" && !currentSessionAvailable ? (
          <EmptySearchState
            title="Current session required"
            detail="Open a session to search its messages. Recent, Quests, Sessions, and Starred remain available."
          />
        ) : error ? (
          <EmptySearchState title="Search failed" detail="Try again or switch modes." />
        ) : results.length === 0 && loading ? (
          <SearchSkeleton />
        ) : results.length === 0 ? (
          <EmptySearchState
            title="No results"
            detail={
              mode === "recent"
                ? recentSessionSpaceId
                  ? "No recent conversations match these filters."
                  : "No recent conversations are available yet."
                : mode === "messages" && !liveMessageQuery
                  ? "No messages here yet."
                  : mode === "starred"
                    ? debouncedQuery.trim()
                      ? "No starred messages match."
                      : "No starred messages yet."
                    : debouncedQuery.trim()
                      ? "Try a shorter query."
                      : "Nothing to show yet."
            }
          />
        ) : (
          <div role="listbox" aria-label={`${modeLabel} results`}>
            {results.map((result, index) => (
              <ResultRow
                key={`${result.kind}:${result.id}`}
                result={result}
                query={debouncedQuery}
                sessions={sessions}
                selected={index === selectedResultIndex}
                copiedQuestId={copiedQuestId}
                questActionMenu={
                  result.kind === "quest" && questActionMenu?.resultId === result.id ? questActionMenu : null
                }
                onPointerMove={() => {
                  setSelectedIndex(index);
                  if (questActionMenu && questActionMenu.resultId !== result.id) setQuestActionMenu(null);
                }}
                onOpen={() => openResult(result)}
                onCopyQuestId={copyQuestId}
                onOpenQuestActionMenu={() =>
                  setQuestActionMenu({
                    resultId: result.id,
                    selectedActionIndex: 0,
                  })
                }
                onSelectQuestAction={(selectedActionIndex) =>
                  setQuestActionMenu({
                    resultId: result.id,
                    selectedActionIndex,
                  })
                }
                onActivateQuestAction={(quest, action) => activateQuestResultAction(quest, action)}
                onInlineNavigate={onClose}
                onOpenRecentMessage={(bundle, messageId) => {
                  onOpenMessage(bundle.sessionId, messageId, bundle.ownerThreadKey);
                  onClose();
                }}
              />
            ))}
            {hasMore && (
              <button
                type="button"
                onClick={() => setVisibleLimit((current) => current + PAGE_SIZE)}
                className="w-full px-4 py-3 text-left text-[13px] text-cc-primary"
              >
                Load more
              </button>
            )}
          </div>
        )}
        {mode === "recent" && !loading && recentMeta?.coverageNotice && (
          <p className="px-4 pt-3 text-[11.5px] text-cc-muted">{recentMeta.coverageNotice}</p>
        )}
      </div>
    </SearchSheet>
  );
}

const FILTER_CHIP_CLASS = "h-7 shrink-0 whitespace-nowrap rounded-full border px-3 text-[12px] transition-colors";
const FILTER_CHIP_ACTIVE_CLASS = "border-cc-primary/40 bg-cc-primary/10 text-cc-primary";
const FILTER_CHIP_IDLE_CLASS = "border-cc-border text-cc-muted hover:text-cc-fg";

/** The current mode's filters, one scrollable line under the search box. */
function SearchFilterRow({ children }: { children: ReactNode }) {
  return (
    <div className={`flex shrink-0 items-center gap-1.5 overflow-x-auto px-4 pb-2 ${HIDDEN_SCROLLBAR_CLASS}`}>
      {children}
    </div>
  );
}

function FilterChip({
  label,
  active,
  disabled = false,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`${FILTER_CHIP_CLASS} ${active ? FILTER_CHIP_ACTIVE_CLASS : FILTER_CHIP_IDLE_CLASS} disabled:cursor-not-allowed disabled:opacity-45`}
    >
      {label}
    </button>
  );
}

function SearchSkeleton() {
  return (
    <div aria-label="Searching">
      {[0, 1, 2].map((item) => (
        <div key={item} className={SEARCH_ROW_CLASS}>
          <span className="h-10 w-1 shrink-0 rounded-full bg-cc-hover" />
          <span className="h-10 flex-1 animate-pulse rounded-lg bg-cc-hover/60" />
        </div>
      ))}
    </div>
  );
}

function EmptySearchState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="px-4 py-6">
      <div className="text-[14px] text-cc-fg">{title}</div>
      <div className="mt-0.5 text-[13px] text-cc-muted">{detail}</div>
    </div>
  );
}

function ResultRow({
  result,
  query,
  sessions,
  selected,
  copiedQuestId,
  questActionMenu,
  onPointerMove,
  onOpen,
  onCopyQuestId,
  onOpenQuestActionMenu,
  onSelectQuestAction,
  onActivateQuestAction,
  onInlineNavigate,
  onOpenRecentMessage,
}: {
  result: UniversalSearchResult;
  query: string;
  sessions: SdkSessionInfo[];
  selected: boolean;
  copiedQuestId: string | null;
  questActionMenu: { resultId: string; selectedActionIndex: number } | null;
  onPointerMove: () => void;
  onOpen: () => void;
  onCopyQuestId: (questId: string) => void;
  onOpenQuestActionMenu: () => void;
  onSelectQuestAction: (selectedActionIndex: number) => void;
  onActivateQuestAction: (quest: QuestListPreview, action: QuestResultAction) => void;
  onInlineNavigate: () => void;
  onOpenRecentMessage: (bundle: RecentAskBundle, messageId: string) => void;
}) {
  if (result.kind === "quest") {
    return (
      <QuestResultRow
        quest={result.quest}
        sessions={sessions}
        selected={selected}
        copied={copiedQuestId === result.quest.questId}
        actionMenu={questActionMenu}
        onPointerMove={onPointerMove}
        onOpen={onOpen}
        onCopyQuestId={onCopyQuestId}
        onOpenActionMenu={onOpenQuestActionMenu}
        onSelectAction={onSelectQuestAction}
        onActivateAction={onActivateQuestAction}
        onInlineNavigate={onInlineNavigate}
      />
    );
  }
  if (result.kind === "recent_ask") {
    return (
      <RecentAskBundleResult
        bundle={result.bundle}
        selected={selected}
        onPointerMove={onPointerMove}
        onOpenMember={(member) => onOpenRecentMessage(result.bundle, member.messageId)}
        onNavigateQuest={onInlineNavigate}
      />
    );
  }
  if (result.kind === "session") {
    return (
      <SessionResultRow
        session={result.session}
        query={query}
        selected={selected}
        onPointerMove={onPointerMove}
        onOpen={onOpen}
      />
    );
  }
  return (
    <MessageResultRow
      message={result.message}
      query={query}
      selected={selected}
      onPointerMove={onPointerMove}
      onOpen={onOpen}
    />
  );
}

function ResultOption({
  selected,
  onPointerMove,
  onOpen,
  children,
}: {
  selected: boolean;
  onPointerMove: () => void;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="option"
      aria-selected={selected}
      onPointerMove={onPointerMove}
      onClick={onOpen}
      // Keyboard selection shows on wide screens only; on a phone it would mark the first row for no reason.
      className={`${SEARCH_ROW_CLASS} relative cursor-pointer ${selected ? "md:bg-cc-hover/60" : "hover:bg-cc-hover/40"}`}
    >
      {children}
    </div>
  );
}

function QuestResultRow({
  quest,
  sessions,
  selected,
  copied,
  actionMenu,
  onPointerMove,
  onOpen,
  onCopyQuestId,
  onOpenActionMenu,
  onSelectAction,
  onActivateAction,
  onInlineNavigate,
}: {
  quest: QuestListPreview;
  sessions: SdkSessionInfo[];
  selected: boolean;
  copied: boolean;
  actionMenu: { resultId: string; selectedActionIndex: number } | null;
  onPointerMove: () => void;
  onOpen: () => void;
  onCopyQuestId: (questId: string) => void;
  onOpenActionMenu: () => void;
  onSelectAction: (selectedActionIndex: number) => void;
  onActivateAction: (quest: QuestListPreview, action: QuestResultAction) => void;
  onInlineNavigate: () => void;
}) {
  const leaderSessionId = getQuestLeaderSessionId(quest);
  const owner = getQuestDisplayOwner(quest);
  const workerSessionId = getQuestOwnerSessionId(quest);
  const leaderSessionNum = sessionNumForId(sessions, leaderSessionId);
  const workerSessionNum = sessionNumForId(sessions, workerSessionId);
  const actions = getQuestResultActions(quest, sessions);
  const leaderAction = actions.find((action) => action.id === "leader");
  const selectedActionIndex = Math.min(actionMenu?.selectedActionIndex ?? 0, actions.length - 1);
  const status = getQuestRecordStatusTheme(quest);
  function handleInteractiveKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.key === "Enter" || event.key === " ") event.stopPropagation();
  }
  function handleCopyClick(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    onCopyQuestId(quest.questId);
  }
  function handleOpenActionMenu(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    onOpenActionMenu();
  }
  return (
    <ResultOption selected={selected} onPointerMove={onPointerMove} onOpen={onOpen}>
      <SearchRowContent
        barColor={`var(--color-cc-status-${QUEST_STATUS_BAR[quest.status] ?? "idea"})`}
        barQuiet={quest.status === "done"}
        meta={
          <SearchMeta
            truncate={-1}
            items={[
              <span className="inline-flex items-center gap-0.5">
                <QuestInlineLink
                  questId={quest.questId}
                  stopPropagation
                  hoverCardZIndexClassName="z-[90]"
                  onNavigate={onInlineNavigate}
                  className="font-mono-code hover:underline"
                />
                <button
                  type="button"
                  className={`inline-flex h-5 w-5 items-center justify-center rounded hover:bg-cc-hover hover:text-cc-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/70 ${
                    copied ? "text-cc-success" : ""
                  }`}
                  aria-label={`Copy quest ID ${quest.questId}`}
                  title={copied ? `Copied ${quest.questId}` : `Copy ${quest.questId}`}
                  onKeyDown={handleInteractiveKeyDown}
                  onClick={handleCopyClick}
                >
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-3 w-3">
                    <rect x="5" y="3" width="8" height="10" rx="1.5" />
                    <path d="M3 11V5.5A2.5 2.5 0 015.5 3H9" />
                  </svg>
                </button>
              </span>,
              <span className={status.text}>{status.label}</span>,
              // Time comes before the people, so a narrow row clips a session number rather than when.
              timeAgo(questRecency(quest)),
              leaderSessionId ? (
                <span className="inline-flex items-center gap-1">
                  <span>leader</span>
                  <SessionInlineLink
                    sessionId={leaderSessionId}
                    sessionNum={leaderSessionNum}
                    threadKey={quest.questId}
                    stopPropagation
                    hoverCardZIndexClassName="z-[90]"
                    onNavigate={onInlineNavigate}
                    className="font-mono-code hover:underline"
                  >
                    {`#${leaderSessionNum ?? "?"}`}
                  </SessionInlineLink>
                </span>
              ) : null,
              owner?.kind === "codex" ? (
                <span className="inline-flex items-center gap-1">
                  <span>owner</span>
                  <CodexQuestOwnerChip owner={owner} stopPropagation />
                </span>
              ) : workerSessionId ? (
                <span className="inline-flex items-center gap-1">
                  <span>worker</span>
                  <SessionInlineLink
                    sessionId={workerSessionId}
                    sessionNum={workerSessionNum}
                    stopPropagation
                    hoverCardZIndexClassName="z-[90]"
                    onNavigate={onInlineNavigate}
                    className="font-mono-code hover:underline"
                  >
                    {`#${workerSessionNum ?? "?"}`}
                  </SessionInlineLink>
                </span>
              ) : null,
            ]}
          />
        }
      >
        <span className="truncate text-[14px] text-cc-fg">{quest.title}</span>
      </SearchRowContent>
      {leaderAction && (
        // A quest has one tab in its leader: this opens it, while the row opens the quest's details.
        <button
          type="button"
          className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-[12px] text-cc-muted transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/70"
          aria-label={`Open the tab of ${quest.questId} in leader #${leaderSessionNum ?? "?"}`}
          title={`Open its tab in leader #${leaderSessionNum ?? "?"}`}
          onKeyDown={handleInteractiveKeyDown}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onActivateAction(quest, leaderAction);
          }}
          data-testid="universal-search-quest-tab"
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3.5 w-3.5"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="7" />
            <path d="M4.5 8h6.5" />
            <path d="M8 5l3 3-3 3" />
          </svg>
          <span>Tab</span>
        </button>
      )}
      <button
        type="button"
        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-cc-hover hover:text-cc-fg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-cc-primary/70 ${
          actionMenu ? "text-cc-fg" : "text-cc-muted/75"
        }`}
        aria-label={`More options for ${quest.questId}`}
        title="More options (Right Arrow)"
        onKeyDown={handleInteractiveKeyDown}
        onClick={handleOpenActionMenu}
      >
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5">
          <path d="M6 4l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {actionMenu && (
        <div
          role="menu"
          aria-label={`Actions for ${quest.questId}`}
          className="absolute right-4 top-full z-[90] -mt-1 min-w-44 rounded-lg border border-cc-border bg-cc-card py-1 shadow-xl"
          onClick={(event) => event.stopPropagation()}
        >
          {actions.map((action, index) => {
            const actionSelected = index === selectedActionIndex;
            return (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[13px] transition-colors ${
                  actionSelected ? "bg-cc-hover text-cc-fg" : "text-cc-fg hover:bg-cc-hover"
                }`}
                onMouseEnter={() => onSelectAction(index)}
                onKeyDown={handleInteractiveKeyDown}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onActivateAction(quest, action);
                }}
              >
                <span>{action.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </ResultOption>
  );
}

/** Quest status token for the row's bar; finished quests fade like finished tabs in Find. */
const QUEST_STATUS_BAR: Record<string, string> = {
  idea: "idea",
  refined: "refined",
  in_progress: "progress",
  done: "done",
};

function SessionResultRow({
  session,
  query,
  selected,
  onPointerMove,
  onOpen,
}: {
  session: SdkSessionInfo;
  query: string;
  selected: boolean;
  onPointerMove: () => void;
  onOpen: () => void;
}) {
  const displayName = sessionDisplayName(session);
  const nameParts = getHighlightParts(displayName, query);
  return (
    <ResultOption selected={selected} onPointerMove={onPointerMove} onOpen={onOpen}>
      <SearchRowContent
        barColor={session.isOrchestrator ? "var(--color-cc-fg)" : "var(--color-cc-muted)"}
        barQuiet={session.archived === true}
        meta={
          <SearchMeta
            truncate={3}
            items={[
              typeof session.sessionNum === "number" ? `#${session.sessionNum}` : "session",
              session.archived ? "archived" : null,
              session.gitBranch ? `branch ${session.gitBranch}` : null,
              session.cwd || session.repoRoot || null,
              session.backendType ?? null,
              timeAgo(sessionRecency(session)),
            ]}
          />
        }
      >
        <span className="truncate text-[14px] text-cc-fg">
          <HighlightedText parts={nameParts} />
        </span>
      </SearchRowContent>
    </ResultOption>
  );
}

function MessageResultRow({
  message,
  query,
  selected,
  onPointerMove,
  onOpen,
}: {
  message: MessageSearchResult | GlobalStarredMessageSearchResult;
  query: string;
  selected: boolean;
  onPointerMove: () => void;
  onOpen: () => void;
}) {
  const sessionLabel = formatMessageResultSessionLabel(message);
  return (
    <ResultOption selected={selected} onPointerMove={onPointerMove} onOpen={onOpen}>
      <SearchRowContent
        barColor={message.category === "user" ? "var(--color-cc-fg)" : "var(--color-cc-muted)"}
        meta={
          <SearchMeta
            truncate={1}
            items={[
              <span className="inline-flex items-center gap-1 capitalize">
                {message.starred && <StarIcon className="h-3 w-3 text-amber-400" />}
                {message.category}
              </span>,
              sessionLabel,
              "archived" in message && message.archived ? "Archived" : null,
              "reviewerOf" in message && typeof message.reviewerOf === "number" ? "Reviewer" : null,
              message.sourceLabel,
              timeAgo(message.timestamp),
            ]}
          />
        }
      >
        <span className="line-clamp-2 text-[14px] text-cc-fg">
          <HighlightedText parts={getHighlightParts(message.snippet, query)} />
        </span>
      </SearchRowContent>
    </ResultOption>
  );
}

/** Query matches use the same tint as Find's. */
function HighlightedText({ parts }: { parts: ReadonlyArray<{ text: string; matched: boolean }> }) {
  return (
    <>
      {parts.map((part, index) =>
        part.matched ? (
          <mark key={`${part.text}-${index}`} className="rounded-sm bg-cc-primary/25 text-inherit">
            {part.text}
          </mark>
        ) : (
          <span key={`${part.text}-${index}`}>{part.text}</span>
        ),
      )}
    </>
  );
}

function formatMessageResultSessionLabel(message: MessageSearchResult | GlobalStarredMessageSearchResult): string {
  if (!("sessionName" in message) && !("archived" in message)) return "";
  const numberLabel = typeof message.sessionNum === "number" ? `#${message.sessionNum}` : "Session";
  const name = "sessionName" in message ? message.sessionName?.trim() : "";
  return name ? `${numberLabel} ${name}` : numberLabel;
}
