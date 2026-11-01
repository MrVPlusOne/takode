import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import {
  api,
  type GlobalStarredMessageSearchResponse,
  type MessageSearchResponse,
  type MessageSearchScopeKind,
  type RecentAskBundlesResponse,
  type UserMessageSearchResponse,
} from "../api.js";
import type { QuestListPreview, SdkSessionInfo } from "../types.js";
import { writeClipboardText } from "../utils/copy-utils.js";
import { navigateToSession, navigateToSessionThread } from "../utils/routing.js";
import { useArchivedSessionMatches } from "./universal-search-archived-sessions.js";
import { scopedGetItem, scopedSetItem } from "../utils/scoped-storage.js";
import { isAllThreadsKey } from "../utils/thread-projection.js";
import { useTopicKeyNamer } from "../utils/leader-topics.js";
import { compareSearchRanks, rankSearchFields, type SearchRank } from "../../shared/search-utils.js";
import {
  ResultRow,
  getQuestResultActions,
  sessionDisplayName,
  sessionRecency,
  type QuestResultAction,
  type UniversalSearchResult,
} from "./UniversalSearchResultRows.js";
import { HIDDEN_SCROLLBAR_CLASS, SEARCH_ROW_CLASS, SearchField, SearchModeSwitch, SearchSheet } from "./SearchSheet.js";

export type UniversalSearchMode = "recent" | "quests" | "sessions" | "messages" | "starred";

type MessageFilter = "assistant" | "event";
type MessageFilters = Record<MessageFilter, boolean>;
type MessageSearchSettings = {
  scope: MessageSearchScopeKind;
  filters: MessageFilters;
};

export interface UniversalSearchOverlayProps {
  open: boolean;
  currentSessionId: string | null;
  currentThreadKey?: string | null;
  sessions: SdkSessionInfo[];
  leaderSessionId?: string;
  recentAskPreviewResponse?: RecentAskBundlesResponse;
  messageSearchPreviewResponse?: MessageSearchResponse;
  userMessageSearchPreviewResponse?: UserMessageSearchResponse;
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
  { id: "recent", label: "Recent", title: "Your recent messages, and a search of them in every session" },
  { id: "quests", label: "Quests", title: "Search quests" },
  { id: "sessions", label: "Sessions", title: "Search sessions" },
  { id: "messages", label: "Assistant", title: "Search one leader's replies and events" },
  { id: "starred", label: "Starred", title: "Search starred messages" },
];

const MESSAGE_FILTERS: Array<{ id: MessageFilter; label: string }> = [
  { id: "assistant", label: "Replies" },
  { id: "event", label: "Events" },
];

const DEFAULT_MESSAGE_SEARCH_SETTINGS: MessageSearchSettings = {
  scope: "current_thread",
  filters: {
    assistant: true,
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
  // Settings saved when this tab also searched the user's messages may have neither kind on.
  const event = settings.filters?.event === true;
  const assistant = settings.filters?.assistant === true || !event;
  return { scope, filters: { assistant, event } };
}

interface InitialSearchState {
  mode: UniversalSearchMode;
  query: string;
}

function resolveInitialSearchState(
  initialMode: UniversalSearchMode | undefined,
  initialQuery: string | undefined,
): InitialSearchState {
  return { mode: initialMode ?? readLastMode() ?? "recent", query: initialQuery ?? readLastQuery() };
}

/**
 * The leaders the Assistant tab can search, most recently active first. One leader is searched at
 * a time: a leader's history can be very large.
 */
function searchableLeaders(sessions: SdkSessionInfo[]): SdkSessionInfo[] {
  return sessions
    .filter((session) => session.isOrchestrator === true && !session.archived)
    .sort((left, right) => sessionRecency(right) - sessionRecency(left));
}

/** The leader the Assistant tab starts on: the one on screen, else the leader of the session on screen. */
function defaultSearchLeader(sessions: SdkSessionInfo[], currentSessionId: string | null): string | null {
  const leaders = searchableLeaders(sessions);
  const current = sessions.find((session) => session.sessionId === currentSessionId);
  const preferred = current?.isOrchestrator ? current.sessionId : current?.herdedBy;
  return leaders.find((leader) => leader.sessionId === preferred)?.sessionId ?? leaders[0]?.sessionId ?? null;
}

/** A leader's tab on screen when chosen (only for the leader on screen), else all its tabs. */
function normalizeMessageSearchScope(input: {
  preferredScope: MessageSearchScopeKind;
  leaderOnScreen: boolean;
  currentThreadKey?: string | null;
}): MessageSearchScopeKind {
  if (
    !input.leaderOnScreen ||
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
  topicKeyName?: { name: string; thread: boolean },
): string {
  const sessionLabel = typeof sessionNum === "number" ? `#${sessionNum}` : "current session";
  if (scope === "session") {
    return typeof sessionNum === "number" ? `Searching in session ${sessionLabel}` : "Searching in current session";
  }
  if (scope === "leader_all_tabs") return `Searching in ${sessionLabel} across tabs`;
  // A topic conversation or user thread reads by its name, as the server's label does.
  const threadLabel = topicKeyName
    ? `${topicKeyName.thread ? "Thread" : "Topic"} "${topicKeyName.name}"`
    : currentThreadKey && currentThreadKey !== "main"
      ? `thread ${currentThreadKey}`
      : "Main";
  return `Searching in ${sessionLabel} ${threadLabel}`;
}

function nextMode(current: UniversalSearchMode, direction: 1 | -1): UniversalSearchMode {
  const modes: UniversalSearchMode[] = ["recent", "quests", "sessions", "messages", "starred"];
  const currentIndex = Math.max(0, modes.indexOf(current));
  return modes[(currentIndex + direction + modes.length) % modes.length]!;
}

function isComposingEnter(event: KeyboardEvent<HTMLElement>): boolean {
  return event.key === "Enter" && (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229);
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
  userMessageSearchPreviewResponse,
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
  // Read when the panel opens, which shouldn't reset its state whenever a session changes.
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const searchKeyRef = useRef("");
  const copiedResetTimerRef = useRef<number | null>(null);
  const initialSearchStateRef = useRef<InitialSearchState | null>(null);
  if (initialSearchStateRef.current == null) {
    initialSearchStateRef.current = resolveInitialSearchState(initialMode, initialQuery);
  }
  const [mode, setMode] = useState<UniversalSearchMode>(initialSearchStateRef.current.mode);
  const [query, setQuery] = useState(initialSearchStateRef.current.query);
  const debouncedQuery = useDebouncedValue(query, DEBOUNCE_MS);
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [recentSessionSpaceId, setRecentSessionSpaceId] = useState<string | null>(null);
  const [messageSettings, setMessageSettings] = useState<MessageSearchSettings>(() => readMessageSearchSettings());
  const [searchLeaderId, setSearchLeaderId] = useState(() => defaultSearchLeader(sessions, currentSessionId));
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
    query?: string;
  }>({ mode: null, status: "idle", results: [], total: 0 });
  // Kept while Recent searches, so its Session Space choice stays.
  const [recentMeta, setRecentMeta] = useState<Omit<RecentAskBundlesResponse, "groups"> | undefined>();

  const sessionById = useMemo(
    () => new Map(sessions.map((session) => [session.sessionId, session] as const)),
    [sessions],
  );
  const leaders = useMemo(() => searchableLeaders(sessions), [sessions]);
  const searchLeader = searchLeaderId ? sessionById.get(searchLeaderId) : undefined;
  // The tab on screen can be chosen only while searching the leader on screen.
  const leaderOnScreen = searchLeaderId !== null && searchLeaderId === currentSessionId;
  const effectiveMessageScope = normalizeMessageSearchScope({
    preferredScope: messageSettings.scope,
    leaderOnScreen,
    currentThreadKey,
  });
  const topicKeyNamer = useTopicKeyNamer();
  const currentTopicKeyName =
    leaderOnScreen && currentSessionId && currentThreadKey
      ? topicKeyNamer(currentSessionId, currentThreadKey)
      : undefined;
  // Read by the search effect, which shouldn't search again when the name arrives.
  const currentTopicKeyNameRef = useRef(currentTopicKeyName);
  currentTopicKeyNameRef.current = currentTopicKeyName;
  const messageScopeLabel =
    remoteState.mode === "messages" && remoteState.scopeLabel
      ? remoteState.scopeLabel
      : localMessageScopeLabel(
          searchLeader?.sessionNum ?? null,
          effectiveMessageScope,
          currentThreadKey,
          currentTopicKeyName,
        );
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
    setMode(next);
    writeLastMode(next);
  }, []);

  const setUserQuery = useCallback((next: string) => {
    setQuery(next);
    writeLastQuery(next);
  }, []);

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
    setMessageSettings(readMessageSearchSettings());
    setSearchLeaderId(defaultSearchLeader(sessionsRef.current, currentSessionId));
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
    mode,
    recentSessionSpaceId,
    searchLeaderId,
  ]);

  const liveMessageQuery = mode === "messages" ? query.trim() : "";
  const resultQuery = mode === "messages" ? liveMessageQuery : debouncedQuery.trim();
  const recentQuery = mode === "recent" ? debouncedQuery.trim() : "";
  const searchKey = `${mode}:${resultQuery}:leader=${searchLeaderId ?? ""}:scope=${effectiveMessageScope}:thread=${currentThreadKey ?? ""}:assistant=${messageSettings.filters.assistant}:event=${messageSettings.filters.event}:space=${recentSessionSpaceId ?? ""}`;

  useEffect(() => {
    if (!open) return;
    const trimmedQuery = debouncedQuery.trim();
    const requestSeq = ++requestSeqRef.current;

    if (mode === "recent" && recentQuery) {
      // Typed into Recent: every message the user wrote, in every session.
      const toResults = (response: UserMessageSearchResponse) =>
        response.results.map((message) => ({ kind: "my_message" as const, id: message.id, message }));
      if (userMessageSearchPreviewResponse) {
        setRemoteState({
          mode: "recent",
          status: "idle",
          total: userMessageSearchPreviewResponse.totalMatches,
          results: toResults(userMessageSearchPreviewResponse),
          query: recentQuery,
        });
        return;
      }
      const controller = new AbortController();
      setRemoteState((current) => ({
        ...current,
        mode: "recent",
        status: "loading",
        results: current.mode === "recent" && current.query === recentQuery ? current.results : [],
        query: recentQuery,
      }));
      void api
        .searchUserMessages({
          query: recentQuery,
          sessionSpaceId: recentSessionSpaceId,
          limit: visibleLimit,
          signal: controller.signal,
        })
        .then((response) => {
          if (controller.signal.aborted || requestSeq !== requestSeqRef.current) return;
          setRemoteState({
            mode: "recent",
            status: "idle",
            total: response.totalMatches,
            results: toResults(response),
            query: recentQuery,
          });
        })
        .catch((err) => {
          if (controller.signal.aborted || requestSeq !== requestSeqRef.current) return;
          console.warn("[universal-search] user message search failed:", err);
          setRemoteState({ mode: "recent", status: "error", total: 0, results: [], query: recentQuery });
        });
      return () => controller.abort();
    }

    if (mode === "recent") {
      const showBundles = (response: RecentAskBundlesResponse) => {
        const { groups, ...meta } = response;
        setRecentMeta(meta);
        setRemoteState({
          mode: "recent",
          status: "idle",
          total: response.totalMatches,
          results: groups.map((bundle) => ({ kind: "recent_ask" as const, id: bundle.id, bundle })),
          query: "",
        });
      };
      if (recentAskPreviewResponse) {
        showBundles(recentAskPreviewResponse);
        return;
      }
      const controller = new AbortController();
      setRemoteState((current) => ({
        ...current,
        mode: "recent",
        status: "loading",
        results: current.mode === "recent" && !current.query ? current.results : [],
        query: "",
      }));
      void api
        .fetchRecentAskBundles({
          sessionSpaceId: recentSessionSpaceId,
          signal: controller.signal,
        })
        .then((response: RecentAskBundlesResponse) => {
          if (controller.signal.aborted || requestSeq !== requestSeqRef.current) return;
          showBundles(response);
        })
        .catch((err) => {
          if (controller.signal.aborted || requestSeq !== requestSeqRef.current) return;
          console.warn("[universal-search] recent asks failed:", err);
          setRemoteState({ mode: "recent", status: "error", total: 0, results: [], query: "" });
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
      const nextScopeLabel = localMessageScopeLabel(
        sessionByIdRef.current.get(searchLeaderId ?? "")?.sessionNum ?? null,
        effectiveMessageScope,
        currentThreadKey,
        currentTopicKeyNameRef.current,
      );
      if (!searchLeaderId) {
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
        .searchSessionMessages(searchLeaderId, {
          query: liveMessageQuery,
          scope: effectiveMessageScope,
          threadKey: effectiveMessageScope === "current_thread" ? currentThreadKey || "main" : undefined,
          filters: { user: false, ...messageSettings.filters },
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
    currentThreadKey,
    debouncedQuery,
    effectiveMessageScope,
    liveMessageQuery,
    messageSearchPreviewResponse,
    messageSettings.filters,
    mode,
    open,
    recentAskPreviewResponse,
    recentQuery,
    recentSessionSpaceId,
    searchKey,
    searchLeaderId,
    starredSearchPreviewResponse,
    userMessageSearchPreviewResponse,
    visibleLimit,
  ]);

  // Recent shows what was fetched for the query it has now: conversations, or a search of the user's messages.
  const recentRemoteCurrent = remoteState.mode === "recent" && (remoteState.query ?? "") === recentQuery;
  const results = useMemo(() => {
    if (mode === "recent") return recentRemoteCurrent ? remoteState.results : [];
    if (mode === "quests") return remoteState.mode === "quests" ? remoteState.results : [];
    if (mode === "sessions") return sessionResults;
    if (mode === "starred") return remoteState.mode === "starred" ? remoteState.results : [];
    return remoteState.mode === "messages" && remoteState.query === liveMessageQuery ? remoteState.results : [];
  }, [liveMessageQuery, mode, recentRemoteCurrent, remoteState, sessionResults]);

  const totalResults = useMemo(() => {
    if (mode === "recent" && recentRemoteCurrent) return remoteState.total;
    if (mode === "quests" && remoteState.mode === "quests") return remoteState.total;
    if (mode === "sessions") return totalSessionResults;
    if (mode === "messages" && remoteState.mode === "messages" && remoteState.query === liveMessageQuery) {
      return remoteState.total;
    }
    if (mode === "starred" && remoteState.mode === "starred") return remoteState.total;
    return 0;
  }, [liveMessageQuery, mode, recentRemoteCurrent, remoteState, totalSessionResults]);

  const messageQueryWaitingForDebounce =
    mode === "messages" &&
    searchLeaderId !== null &&
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
  // Recent's conversations are one bounded list; a search of the user's messages pages like the others.
  const hasMore = (mode !== "recent" || recentQuery.length > 0) && results.length < totalResults;
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
      ? "Search your messages in every session"
      : mode === "quests"
        ? "Search quests"
        : mode === "sessions"
          ? "Search sessions"
          : mode === "starred"
            ? "Search starred messages"
            : searchLeader
              ? `Search ${typeof searchLeader.sessionNum === "number" ? `#${searchLeader.sessionNum}` : "the leader"}'s replies`
              : "No leader to search";

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
      {/* Recent lists and searches the user's own messages, so it offers no attention filters; only
          the Session Space choice, when there is more than one. */}
      {mode === "recent" && (recentMeta?.sessionSpaces.length ?? 0) > 1 && (
        <SearchFilterRow>
          <select
            aria-label="Filter your messages by Session Space"
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
      {mode === "messages" && searchLeader && (
        <SearchFilterRow>
          <select
            aria-label="Leader to search"
            value={searchLeaderId ?? ""}
            onChange={(event) => setSearchLeaderId(event.target.value || null)}
            className={`${FILTER_CHIP_CLASS} ${FILTER_CHIP_ACTIVE_CLASS} max-w-56 bg-transparent outline-none`}
            data-testid="universal-search-leader"
          >
            {leaders.map((leader) => (
              <option key={leader.sessionId} value={leader.sessionId}>
                {typeof leader.sessionNum === "number" ? `#${leader.sessionNum} ` : ""}
                {sessionDisplayName(leader)}
              </option>
            ))}
          </select>
          {leaderOnScreen && (
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
        {mode === "messages" && !searchLeader ? (
          <EmptySearchState
            title="No leader to search"
            detail="Assistant searches one leader's replies at a time. Recent searches your own messages everywhere."
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
                ? recentQuery
                  ? recentSessionSpaceId
                    ? "None of your messages in this Session Space match."
                    : "None of your messages match."
                  : recentSessionSpaceId
                    ? "No recent conversations match these filters."
                    : "No recent conversations are available yet."
                : mode === "messages"
                  ? liveMessageQuery
                    ? "Nothing here matches. Your own messages are searched in Recent."
                    : "No messages here yet."
                  : mode === "starred"
                    ? debouncedQuery.trim()
                      ? "No starred messages match."
                      : "No starred messages yet."
                    : debouncedQuery.trim()
                      ? "Nothing matches."
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
