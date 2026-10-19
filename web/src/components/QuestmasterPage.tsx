import {
  useState,
  useEffect,
  useCallback,
  useRef,
  useMemo,
  useSyncExternalStore,
  useLayoutEffect,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { useStore } from "../store.js";
import { api } from "../api.js";
import { questOverlayTargetFromHash, withoutQuestIdInHash } from "../utils/routing.js";
import { loadQuestmasterViewState, saveQuestmasterViewState } from "../utils/questmaster-view-state.js";
import { buildQuestJourneyContextByQuestId } from "../utils/quest-journey-context.js";
import { useDesktopShellLayout } from "../hooks/useDesktopShellLayout.js";
import { QuestmasterCreateForm } from "./QuestmasterCreateForm.js";

import {
  nextCompactSort,
  normalizeCompactSort,
  QuestmasterColumnHeader,
  QuestmasterQuestRow,
  QuestmasterSortSelect,
  QuestmasterStatusFilter,
  type QuestmasterLayout,
} from "./QuestmasterQuestList.js";
import type {
  QuestListPage,
  QuestListPageOptions,
  QuestmasterCompactSort,
  QuestmasterCompactSortColumn,
} from "../api.js";
import type { QuestListPreview, QuestmasterTask, QuestStatus } from "../types.js";
import { multiWordMatch } from "../../shared/search-utils.js";
import {
  compactPhaseDocumentationGroups,
  phaseDocumentationPreview,
  summarizeQuestPhaseDocumentation,
} from "../../shared/quest-phase-documentation-summary.js";
import { liveQuestFeedbackEntries } from "../../shared/quest-feedback.js";

const QUEST_PAGE_SIZE = 50;
const MAX_RENDERED_QUESTS = 150;
const SEARCH_DEBOUNCE_MS = 500;
const AUTO_PAGE_SCROLL_THRESHOLD = 120;

// ─── Helpers ────────────────────────────────────────────────────────────────

function classifyQuestSearchToken(token: string): { kind: "positiveTag" | "negatedTag" | "text"; value: string } {
  const negatedMatch = token.match(/^(?:!#|-#)([^\s#]*)$/);
  if (negatedMatch) {
    const value = negatedMatch[1].toLowerCase();
    if (!/^\d/.test(value)) return { kind: "negatedTag", value };
  }
  const positiveMatch = token.match(/^#([^\s#]*)$/);
  if (positiveMatch) {
    const value = positiveMatch[1].toLowerCase();
    if (!/^\d/.test(value)) return { kind: "positiveTag", value };
  }
  return { kind: "text", value: token };
}

function getTrailingQuestSearchToken(query: string): { kind: "positiveTag" | "negatedTag"; value: string } | null {
  const match = query.match(/(?:^|\s)(\S*)$/);
  if (!match) return null;
  const rawToken = match[1];
  if (!rawToken) return null;
  const classified = classifyQuestSearchToken(rawToken);
  if (classified.kind === "text") return null;
  return { kind: classified.kind, value: classified.value };
}

function parseQuestSearchQuery(query: string): { searchText: string; negatedTags: Set<string> } {
  const negatedTags = new Set<string>();
  const positiveTokens: string[] = [];
  let trailingPositiveTag = false;

  const tokens = query.trim().split(/\s+/).filter(Boolean);
  for (const [index, token] of tokens.entries()) {
    const classified = classifyQuestSearchToken(token);
    if (classified.kind === "negatedTag") {
      if (classified.value) negatedTags.add(classified.value);
      continue;
    }
    if (classified.kind === "positiveTag" && index === tokens.length - 1) {
      trailingPositiveTag = true;
    }
    positiveTokens.push(token);
  }

  // Preserve the existing positive #tag autocomplete flow by keeping a trailing
  // positive hashtag token out of plain-text matching/highlighting until the
  // user selects it into the positive tag pill set.
  const searchText = (trailingPositiveTag ? positiveTokens.slice(0, -1) : positiveTokens).join(" ").trim();
  return { searchText, negatedTags };
}

function getQuestSearchAutocompleteMatches(query: string, allTags: string[], selectedTags: Set<string>): string[] {
  const q = query.toLowerCase();
  return allTags.filter((t) => (!q || t.includes(q)) && !selectedTags.has(t));
}

function mergeUniqueQuestPage(
  existing: QuestListPreview[],
  incoming: QuestListPreview[],
  direction: "append" | "prepend",
) {
  const merged = direction === "prepend" ? [...incoming, ...existing] : [...existing, ...incoming];
  const seen = new Set<string>();
  return merged.filter((quest) => {
    const key = quest.questId.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function questPreviewFromTask(quest: QuestmasterTask): QuestListPreview {
  const verificationItems = "verificationItems" in quest ? (quest.verificationItems ?? []) : [];
  const humanFeedback = liveQuestFeedbackEntries(quest.feedback).filter((entry) => entry.author === "human");
  const phasePreviewLines = compactPhaseDocumentationGroups(summarizeQuestPhaseDocumentation(quest), 2).flatMap(
    (group) => {
      const latestEntry = group.entries.at(-1);
      if (!latestEntry) return [];
      return [
        {
          key: group.key,
          label: group.displayLabel,
          ...(group.metaLabel ? { metaLabel: group.metaLabel } : {}),
          text: phaseDocumentationPreview(latestEntry),
        },
      ];
    },
  );
  return {
    preview: true,
    id: quest.id,
    questId: quest.questId,
    version: quest.version,
    title: quest.title,
    status: quest.status,
    ...(quest.tldr ? { tldr: quest.tldr } : {}),
    createdAt: quest.createdAt,
    ...(quest.updatedAt ? { updatedAt: quest.updatedAt } : {}),
    ...(quest.statusChangedAt ? { statusChangedAt: quest.statusChangedAt } : {}),
    ...(quest.tags ? { tags: quest.tags } : {}),
    ...(quest.parentId ? { parentId: quest.parentId } : {}),
    ...(quest.sessionSpaceSlug ? { sessionSpaceSlug: quest.sessionSpaceSlug } : {}),
    ...("sessionId" in quest && quest.sessionId ? { sessionId: quest.sessionId } : {}),
    ...("ownerKind" in quest && quest.ownerKind ? { ownerKind: quest.ownerKind } : {}),
    ...("claimedAt" in quest && quest.claimedAt ? { claimedAt: quest.claimedAt } : {}),
    ...(quest.previousOwnerSessionIds ? { previousOwnerSessionIds: quest.previousOwnerSessionIds } : {}),
    ...(quest.previousOwners ? { previousOwners: quest.previousOwners } : {}),
    ...(quest.leaderSessionId ? { leaderSessionId: quest.leaderSessionId } : {}),
    ...("completedAt" in quest && quest.completedAt ? { completedAt: quest.completedAt } : {}),
    ...("verificationInboxUnread" in quest && typeof quest.verificationInboxUnread === "boolean"
      ? { verificationInboxUnread: quest.verificationInboxUnread }
      : {}),
    ...("cancelled" in quest && quest.cancelled === true ? { cancelled: true } : {}),
    ...("debriefTldr" in quest && quest.debriefTldr ? { debriefTldr: quest.debriefTldr } : {}),
    ...(quest.relationships ? { relationships: quest.relationships } : {}),
    ...(quest.relatedQuests ? { relatedQuests: quest.relatedQuests } : {}),
    ...(quest.journeyRuns ? { journeyRuns: quest.journeyRuns } : {}),
    ...(verificationItems.length > 0
      ? {
          verificationProgress: {
            checked: verificationItems.filter((item) => item.checked).length,
            total: verificationItems.length,
          },
        }
      : {}),
    ...(humanFeedback.length > 0
      ? {
          feedbackSummary: {
            humanTotal: humanFeedback.length,
            humanUnaddressed: humanFeedback.filter((entry) => !entry.addressed).length,
            humanAddressed: humanFeedback.filter((entry) => entry.addressed).length,
          },
        }
      : {}),
    ...(phasePreviewLines.length > 0 ? { phasePreviewLines } : {}),
  };
}

function fallbackQuestPage(quests: QuestmasterTask[]): QuestListPage {
  const previews = quests.map(questPreviewFromTask);
  return {
    quests: previews,
    total: quests.length,
    offset: 0,
    limit: QUEST_PAGE_SIZE,
    hasMore: quests.length > QUEST_PAGE_SIZE,
    nextOffset: quests.length > QUEST_PAGE_SIZE ? QUEST_PAGE_SIZE : null,
    previousOffset: null,
    counts: {
      all: quests.length,
      idea: quests.filter((quest) => quest.status === "idea").length,
      refined: quests.filter((quest) => quest.status === "refined").length,
      in_progress: quests.filter((quest) => quest.status === "in_progress").length,
      done: quests.filter((quest) => quest.status === "done").length,
    },
    allTags: Array.from(new Set(quests.flatMap((quest) => quest.tags ?? []).map((tag) => tag.toLowerCase()))).sort(
      (a, b) => a.localeCompare(b),
    ),
  };
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function questMatchesCurrentPageCorpus(
  quest: QuestListPreview,
  selectedTags: Set<string>,
  negatedTags: Set<string>,
  searchText: string,
) {
  const questTags = new Set((quest.tags ?? []).map((tag) => tag.toLowerCase()));
  if (selectedTags.size > 0 && !Array.from(selectedTags).some((tag) => questTags.has(tag.toLowerCase()))) return false;
  if (Array.from(negatedTags).some((tag) => questTags.has(tag.toLowerCase()))) return false;

  const query = searchText.trim();
  if (!query) return true;
  return multiWordMatch(
    `${quest.questId}\n${quest.title}\n${(quest.tags ?? []).join("\n")}\n${quest.tldr ?? ""}\n${quest.debriefTldr ?? ""}\n${(quest.phasePreviewLines ?? []).map((line) => line.text).join("\n")}`,
    query,
  );
}

function questMatchesCurrentVisibleFilters(
  quest: QuestListPreview,
  statusFilter: QuestStatus | null,
  selectedTags: Set<string>,
  negatedTags: Set<string>,
  searchText: string,
) {
  if (!questMatchesCurrentPageCorpus(quest, selectedTags, negatedTags, searchText)) return false;
  return statusFilter === null || statusFilter === quest.status;
}

function questPageRequestKey(options: QuestListPageOptions): string {
  return JSON.stringify({
    offset: options.offset ?? 0,
    limit: options.limit ?? QUEST_PAGE_SIZE,
    status: options.status ?? "",
    session: options.session ?? "",
    sessionId: options.sessionId ?? "",
    tags: [...(options.tags ?? [])].sort(),
    excludeTags: [...(options.excludeTags ?? [])].sort(),
    text: options.text ?? "",
    sortColumn: options.sortColumn ?? "",
    sortDirection: options.sortDirection ?? "",
  });
}

// ─── Component ──────────────────────────────────────────────────────────────

export function QuestmasterPage({ isActive = true }: { isActive?: boolean }) {
  const initialViewStateRef = useRef<ReturnType<typeof loadQuestmasterViewState> | undefined>(undefined);
  if (initialViewStateRef.current === undefined) {
    initialViewStateRef.current = loadQuestmasterViewState();
  }
  const initialViewState = initialViewStateRef.current;
  const restoreScrollTopRef = useRef<number | null>(initialViewState?.scrollTop ?? null);
  const hasHydratedViewStateRef = useRef(restoreScrollTopRef.current === null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hash = useSyncExternalStore(
    (cb) => {
      window.addEventListener("hashchange", cb);
      return () => window.removeEventListener("hashchange", cb);
    },
    () => window.location.hash,
  );
  const storeQuests = useStore((s) => s.quests);
  const upsertQuestDetail = useStore((s) => s.upsertQuestDetail);
  const sessionBoards = useStore((s) => s.sessionBoards);
  const sessionCompletedBoards = useStore((s) => s.sessionCompletedBoards);
  const currentSessionSpaceSlug = useStore((s) => {
    const sessionId = s.currentSessionId;
    if (!sessionId) return undefined;
    return (
      s.sessions.get(sessionId)?.memorySessionSpaceSlug ??
      s.sdkSessions.find((session) => session.sessionId === sessionId)?.memorySessionSpaceSlug ??
      undefined
    );
  });

  const [statusFilter, setStatusFilter] = useState<QuestStatus | null>(initialViewState?.statusFilter ?? null);
  const layout: QuestmasterLayout = useDesktopShellLayout() ? "desktop" : "phone";
  const [compactSortSaving, setCompactSortSaving] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const initialPage = useMemo(() => fallbackQuestPage(storeQuests), []);
  const [pagedQuests, setPagedQuests] = useState<QuestListPreview[]>(initialPage.quests.slice(0, QUEST_PAGE_SIZE));
  const [pageInfo, setPageInfo] = useState<QuestListPage>(initialPage);
  const [windowOffset, setWindowOffset] = useState(0);
  const [questsLoading, setQuestsLoading] = useState(false);
  const [loadingMoreDirection, setLoadingMoreDirection] = useState<"next" | "previous" | null>(null);
  const [debouncedSearchText, setDebouncedSearchText] = useState("");
  const pageRequestSeqRef = useRef(0);
  const pageAbortControllerRef = useRef<AbortController | null>(null);
  const pageEtagsRef = useRef(new Map<string, string>());
  const pageRequestInFlightRef = useRef(false);
  const visibleWindowRef = useRef({ offset: 0, count: 0 });
  const autoPagingDirectionRef = useRef<"next" | "previous" | null>(null);
  const prependAnchorRef = useRef<{
    questId: string;
    offsetTop: number | null;
    scrollHeight: number;
    scrollTop: number;
  } | null>(null);

  // Search, tags, and sort -- local state initialized from store, synced back on every change.
  // Local state ensures React re-renders on every keystroke; store persists across navigation.
  const [searchQuery, setSearchQueryLocal] = useState(() => useStore.getState().questmasterSearchQuery ?? "");
  const [selectedTags, setSelectedTagsLocal] = useState<Set<string>>(
    () => new Set(useStore.getState().questmasterSelectedTags ?? []),
  );
  const [compactSort, setCompactSortLocal] = useState<QuestmasterCompactSort>(() =>
    normalizeCompactSort(useStore.getState().questmasterCompactSort),
  );
  const setSearchQuery = useCallback((val: string) => {
    setSearchQueryLocal(val);
    useStore.getState().setQuestmasterSearchQuery(val);
  }, []);
  const setSelectedTags = useCallback((update: Set<string> | ((prev: Set<string>) => Set<string>)) => {
    setSelectedTagsLocal((prev) => {
      const next = typeof update === "function" ? update(prev) : update;
      useStore.getState().setQuestmasterSelectedTags(Array.from(next));
      return next;
    });
  }, []);
  const setCompactSort = useCallback((sort: QuestmasterCompactSort) => {
    const normalized = normalizeCompactSort(sort);
    setCompactSortLocal((current) =>
      current.column === normalized.column && current.direction === normalized.direction ? current : normalized,
    );
    useStore.getState().setQuestmasterCompactSort(normalized);
  }, []);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Hashtag autocomplete state
  const [hashtagQuery, setHashtagQuery] = useState("");
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);
  const [searchFocused, setSearchFocused] = useState(false);
  const autocompleteRef = useRef<HTMLDivElement>(null);

  // Error state
  const [error, setError] = useState("");

  const parsedSearch = useMemo(() => parseQuestSearchQuery(searchQuery), [searchQuery]);
  const searchText = parsedSearch.searchText;
  const negatedTags = parsedSearch.negatedTags;
  const negatedTagKey = Array.from(negatedTags).sort().join("\n");
  const negatedTagList = useMemo(() => (negatedTagKey ? negatedTagKey.split("\n") : []), [negatedTagKey]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => setDebouncedSearchText(searchText.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeoutId);
  }, [searchText]);

  useEffect(() => {
    visibleWindowRef.current = { offset: windowOffset, count: pagedQuests.length };
  }, [windowOffset, pagedQuests.length]);

  useLayoutEffect(() => {
    const anchor = prependAnchorRef.current;
    const el = scrollContainerRef.current;
    if (!anchor || !el) return;

    const anchorEl = Array.from(el.querySelectorAll<HTMLElement>("[data-quest-id]")).find(
      (node) => node.dataset.questId === anchor.questId,
    );
    const offsetDelta =
      anchorEl && anchor.offsetTop !== null
        ? anchorEl.offsetTop - anchor.offsetTop
        : el.scrollHeight - anchor.scrollHeight;
    el.scrollTop = anchor.scrollTop + offsetDelta;
    prependAnchorRef.current = null;
  }, [pagedQuests]);

  const loadQuestPage = useCallback(
    async (offset: number, mode: "replace" | "append" | "prepend", pageLimit = QUEST_PAGE_SIZE) => {
      const requestSeq = ++pageRequestSeqRef.current;
      pageAbortControllerRef.current?.abort();
      const abortController = new AbortController();
      pageAbortControllerRef.current = abortController;
      pageRequestInFlightRef.current = true;
      const loadingDirection = mode === "append" ? "next" : mode === "prepend" ? "previous" : null;
      if (mode === "replace") setQuestsLoading(true);
      else setLoadingMoreDirection(loadingDirection);
      setError("");

      try {
        const status = statusFilter ?? undefined;
        const pageOptions: Omit<QuestListPageOptions, "offset"> = {
          limit: pageLimit,
          status,
          tags: Array.from(selectedTags),
          excludeTags: negatedTagList,
          text: debouncedSearchText,
          sortColumn: debouncedSearchText ? undefined : compactSort.column,
          sortDirection: debouncedSearchText ? undefined : compactSort.direction,
        };
        let pageRequest: QuestListPageOptions = { ...pageOptions, offset };
        let requestKey = questPageRequestKey(pageRequest);
        let result = await api.listQuestPageValidated(pageRequest, {
          signal: abortController.signal,
          etag: pageEtagsRef.current.get(requestKey) ?? null,
        });
        if (result.status === "not-modified") {
          if (requestSeq !== pageRequestSeqRef.current) return;
          return;
        }
        if (result.etag) pageEtagsRef.current.set(requestKey, result.etag);
        let page = result.data;
        if (page.quests.length === 0 && page.total > 0 && offset > 0) {
          pageRequest = { ...pageOptions, offset: Math.max(0, page.total - pageLimit) };
          requestKey = questPageRequestKey(pageRequest);
          result = await api.listQuestPageValidated(pageRequest, {
            signal: abortController.signal,
            etag: pageEtagsRef.current.get(requestKey) ?? null,
          });
          if (result.status === "not-modified") {
            if (requestSeq !== pageRequestSeqRef.current) return;
            return;
          }
          if (result.etag) pageEtagsRef.current.set(requestKey, result.etag);
          page = result.data;
        }
        if (requestSeq !== pageRequestSeqRef.current) return;

        setPageInfo(page);
        setPagedQuests((current) => {
          if (mode === "replace") {
            setWindowOffset(page.offset);
            return page.quests;
          }
          const merged = mergeUniqueQuestPage(current, page.quests, mode);
          if (merged.length <= MAX_RENDERED_QUESTS) return merged;
          if (mode === "append") {
            const dropped = merged.length - MAX_RENDERED_QUESTS;
            setWindowOffset((currentOffset) => currentOffset + dropped);
            return merged.slice(-MAX_RENDERED_QUESTS);
          }
          setWindowOffset(page.offset);
          return merged.slice(0, MAX_RENDERED_QUESTS);
        });
      } catch (err) {
        if (isAbortError(err)) return;
        if (requestSeq === pageRequestSeqRef.current) {
          setError(err instanceof Error ? err.message : "Failed to load quests");
        }
      } finally {
        if (pageAbortControllerRef.current === abortController) pageAbortControllerRef.current = null;
        if (requestSeq === pageRequestSeqRef.current) {
          pageRequestInFlightRef.current = false;
          if (!abortController.signal.aborted) {
            setQuestsLoading(false);
            setLoadingMoreDirection(null);
          }
        }
      }
    },
    [compactSort, debouncedSearchText, negatedTagList, selectedTags, statusFilter],
  );

  const refreshVisibleQuestWindow = useCallback(() => {
    const { offset, count } = visibleWindowRef.current;
    const limit = Math.max(QUEST_PAGE_SIZE, Math.min(MAX_RENDERED_QUESTS, count || QUEST_PAGE_SIZE));
    return loadQuestPage(offset, "replace", limit);
  }, [loadQuestPage]);

  useEffect(() => {
    return () => {
      pageAbortControllerRef.current?.abort();
    };
  }, []);

  // Load quests on mount, pause polling entirely while hidden, and resume with
  // a foreground refresh when the tab becomes visible again.
  useEffect(() => {
    if (!isActive) return;
    let timeoutId: number | null = null;

    const scheduleNextPoll = () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      if (document.visibilityState !== "visible") return;
      timeoutId = window.setTimeout(() => {
        if (!pageRequestInFlightRef.current) void refreshVisibleQuestWindow();
        scheduleNextPoll();
      }, 5_000);
    };

    void loadQuestPage(0, "replace");
    scheduleNextPoll();

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        void refreshVisibleQuestWindow();
        scheduleNextPoll();
      } else if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
        timeoutId = null;
      }
    }
    document.addEventListener("visibilitychange", handleVisibility);

    function handleFocus() {
      void refreshVisibleQuestWindow();
      scheduleNextPoll();
    }
    window.addEventListener("focus", handleFocus);

    return () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("focus", handleFocus);
    };
  }, [isActive, loadQuestPage, refreshVisibleQuestWindow]);

  const refreshServerQuestmasterSettings = useCallback(async () => {
    try {
      const settings = await api.getSettings();
      setCompactSort(normalizeCompactSort(settings.questmasterCompactSort));
    } catch (err) {
      console.warn("[questmaster] failed to load server Questmaster settings", err);
    }
  }, [setCompactSort]);

  // The sort is server-owned. Refresh it on page activation and on focus so
  // multiple browser tabs converge to the latest saved sort.
  useEffect(() => {
    if (!isActive) return;
    refreshServerQuestmasterSettings();

    function handleFocus() {
      refreshServerQuestmasterSettings();
    }
    function handleVisibility() {
      if (document.visibilityState === "visible") refreshServerQuestmasterSettings();
    }

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [isActive, refreshServerQuestmasterSettings]);

  // Hydrate persisted scroll position once enough content has rendered.
  useEffect(() => {
    if (!isActive) return;
    if (hasHydratedViewStateRef.current) return;
    const el = scrollContainerRef.current;
    const savedScrollTop = restoreScrollTopRef.current;
    if (!el || savedScrollTop === null) return;
    if (questsLoading && pagedQuests.length === 0) return;
    const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
    el.scrollTop = Math.min(savedScrollTop, maxScrollTop);
    hasHydratedViewStateRef.current = true;
    restoreScrollTopRef.current = null;
  }, [isActive, questsLoading, pagedQuests.length]);

  // Persist view state on scroll and before unmount so navigation preserves context.
  useEffect(() => {
    if (!isActive) return;
    const el = scrollContainerRef.current;
    if (!el) return;

    let rafId: number | null = null;
    const persistNow = () => {
      if (!hasHydratedViewStateRef.current) return;
      saveQuestmasterViewState({
        scrollTop: el.scrollTop,
        statusFilter: statusFilter ?? undefined,
      });
    };

    const onScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        persistNow();
      });
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (rafId !== null) cancelAnimationFrame(rafId);
      persistNow();
    };
  }, [isActive, statusFilter]);

  // Persist immediately when the filter changes.
  useEffect(() => {
    if (!isActive) return;
    if (!hasHydratedViewStateRef.current) return;
    saveQuestmasterViewState({
      scrollTop: scrollContainerRef.current?.scrollTop ?? 0,
      statusFilter: statusFilter ?? undefined,
    });
  }, [isActive, statusFilter]);
  // Deep-link support: any hash with ?quest=q-123 should focus and expand that quest.
  useEffect(() => {
    const target = questOverlayTargetFromHash(hash);
    if (!target) return;
    const targetQuestId = target.questId;
    const targetQuest = pagedQuests.find((q) => q.questId === targetQuestId);
    setStatusFilter(null);
    // Ensure deep-linked quests are visible in the list as well as the modal.
    const store = useStore.getState();
    if (
      store.questOverlayId !== targetQuestId ||
      (store.questOverlayFeedbackTarget?.index ?? null) !== (target.feedbackIndex ?? null)
    ) {
      if (target.feedbackIndex === undefined) store.openQuestOverlay(targetQuestId);
      else store.openQuestOverlay(targetQuestId, undefined, target.feedbackIndex);
    }
    setShowCreateForm(false);

    if (!targetQuest) {
      let cancelled = false;
      void api
        .getQuest(targetQuestId)
        .then((quest) => {
          if (cancelled) return;
          upsertQuestDetail(quest);
          const preview = questPreviewFromTask(quest);
          setPagedQuests((current) =>
            current.some((existing) => existing.questId === quest.questId) ? current : [preview, ...current],
          );
        })
        .catch(() => undefined);
      return () => {
        cancelled = true;
      };
    }

    const scrollFrameId = window.requestAnimationFrame(() => {
      const el = document.querySelector(`[data-quest-id="${targetQuestId}"]`);
      if (el instanceof HTMLElement && typeof el.scrollIntoView === "function") {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
    return () => window.cancelAnimationFrame(scrollFrameId);
  }, [hash, pagedQuests, upsertQuestDetail]);

  const handleExpand = useCallback(
    (quest: QuestListPreview | QuestmasterTask) => {
      const store = useStore.getState();
      if (store.questOverlayId === quest.questId) {
        const currentHash = window.location.hash || "#/";
        const nextHash = withoutQuestIdInHash(currentHash);
        if (nextHash !== currentHash) {
          window.location.hash = nextHash.startsWith("#") ? nextHash.slice(1) : nextHash;
        }
        store.closeQuestOverlay();
        return;
      }
      store.openQuestOverlay(quest.questId, searchText || undefined);
    },
    [searchText],
  );

  // ─── Actions ──────────────────────────────────────────────────────────

  const handleCreateQuestCreated = useCallback(
    (createdQuest: QuestmasterTask) => {
      upsertQuestDetail(createdQuest);
      const createdPreview = questPreviewFromTask(createdQuest);
      const matchesCurrentCorpus = questMatchesCurrentPageCorpus(createdPreview, selectedTags, negatedTags, searchText);
      const matchesVisibleFilters = questMatchesCurrentVisibleFilters(
        createdPreview,
        statusFilter,
        selectedTags,
        negatedTags,
        searchText,
      );
      const shouldInsertIntoWindow = matchesVisibleFilters && windowOffset === 0;
      if (shouldInsertIntoWindow) {
        setPagedQuests((current) =>
          [createdPreview, ...current.filter((q) => q.questId !== createdQuest.questId)].slice(0, MAX_RENDERED_QUESTS),
        );
      }
      setPageInfo((current) => ({
        ...current,
        quests: shouldInsertIntoWindow
          ? [createdPreview, ...current.quests.filter((q) => q.questId !== createdQuest.questId)].slice(
              0,
              current.limit,
            )
          : current.quests,
        total: current.total + (matchesVisibleFilters ? 1 : 0),
        counts: matchesCurrentCorpus
          ? {
              ...current.counts,
              all: current.counts.all + 1,
              [createdQuest.status]: current.counts[createdQuest.status] + 1,
            }
          : current.counts,
        allTags: Array.from(
          new Set([...current.allTags, ...(createdQuest.tags ?? [])].map((tag) => tag.toLowerCase())),
        ).sort((a, b) => a.localeCompare(b)),
      }));
      setShowCreateForm(false);
      useStore.getState().openQuestOverlay(createdQuest.questId);
    },
    [negatedTags, searchText, selectedTags, statusFilter, upsertQuestDetail, windowOffset],
  );
  const handleCreateQuestCancel = useCallback(() => {
    setShowCreateForm(false);
  }, []);

  async function handleCompactSortChange(column: QuestmasterCompactSortColumn) {
    const previousSort = compactSort;
    const nextSort = nextCompactSort(compactSort, column);
    setCompactSort(nextSort);
    setCompactSortSaving(true);
    setError("");
    try {
      const settings = await api.updateSettings({ questmasterCompactSort: nextSort });
      setCompactSort(normalizeCompactSort(settings.questmasterCompactSort));
    } catch (err) {
      setCompactSort(previousSort);
      setError(err instanceof Error ? err.message : "Failed to save Questmaster compact sort");
    } finally {
      setCompactSortSaving(false);
    }
  }

  // ─── Derived tag list ─────────────────────────────────────────────────

  const allTags = pageInfo.allTags;

  // Clean up stale selected tags when tags disappear from dataset
  useEffect(() => {
    if (selectedTags.size === 0) return;
    const currentTagSet = new Set(allTags);
    const hasStale = Array.from(selectedTags).some((t) => !currentTagSet.has(t));
    if (hasStale) {
      setSelectedTags((prev) => new Set(Array.from(prev).filter((t) => currentTagSet.has(t))));
    }
  }, [allTags, selectedTags]);

  // Compute autocomplete matches for hashtag query
  const autocompleteMatches = useMemo(() => {
    const activeSearchToken = getTrailingQuestSearchToken(searchQuery);
    if (!activeSearchToken) return [];
    return getQuestSearchAutocompleteMatches(hashtagQuery, allTags, selectedTags);
  }, [searchQuery, hashtagQuery, allTags, selectedTags]);
  const activeSearchToken = useMemo(() => getTrailingQuestSearchToken(searchQuery), [searchQuery]);

  function replaceTrailingSearchToken(query: string, replacement: string): string {
    const match = query.match(/^(.*?)(\S*)$/s);
    if (!match) return replacement;
    const prefix = match[1];
    return `${prefix}${replacement}`;
  }

  // ─── Backend paging result shaping ────────────────────────────────────

  const searchNormalized = searchText.trim();
  const counts: Record<string, number> = pageInfo.counts;
  const filtered = pagedQuests;

  const journeyContextByQuestId = useMemo(
    () => buildQuestJourneyContextByQuestId(pagedQuests, sessionBoards, sessionCompletedBoards),
    [pagedQuests, sessionBoards, sessionCompletedBoards],
  );

  const renderRow = (quest: QuestListPreview) => (
    <QuestmasterQuestRow
      key={quest.id}
      quest={quest}
      layout={layout}
      searchText={searchText}
      journeyContext={journeyContextByQuestId.get(quest.questId.toLowerCase())}
      onOpenQuest={handleExpand}
    />
  );
  const previousPageOffset = windowOffset > 0 ? Math.max(0, windowOffset - QUEST_PAGE_SIZE) : null;
  const nextPageOffset = windowOffset + pagedQuests.length < pageInfo.total ? windowOffset + pagedQuests.length : null;

  const capturePrependAnchor = useCallback(() => {
    const el = scrollContainerRef.current;
    const questId = pagedQuests[0]?.questId;
    if (!el || !questId) return;
    const anchorEl = Array.from(el.querySelectorAll<HTMLElement>("[data-quest-id]")).find(
      (node) => node.dataset.questId === questId,
    );
    prependAnchorRef.current = {
      questId,
      offsetTop: anchorEl?.offsetTop ?? null,
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
    };
  }, [pagedQuests]);

  const triggerAutoPageLoad = useCallback(
    (direction: "next" | "previous") => {
      if (questsLoading || loadingMoreDirection !== null || autoPagingDirectionRef.current !== null) return;
      if (direction === "next") {
        if (nextPageOffset === null) return;
        autoPagingDirectionRef.current = "next";
        void loadQuestPage(nextPageOffset, "append").finally(() => {
          autoPagingDirectionRef.current = null;
        });
        return;
      }
      if (previousPageOffset === null) return;
      capturePrependAnchor();
      autoPagingDirectionRef.current = "previous";
      void loadQuestPage(previousPageOffset, "prepend").finally(() => {
        autoPagingDirectionRef.current = null;
      });
    },
    [capturePrependAnchor, loadQuestPage, loadingMoreDirection, nextPageOffset, previousPageOffset, questsLoading],
  );

  const evaluateAutoPageBoundary = useCallback(
    (deltaY: number) => {
      if (!isActive) return;
      const el = scrollContainerRef.current;
      if (!el) return;

      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      const nearTop = el.scrollTop <= AUTO_PAGE_SCROLL_THRESHOLD;
      const nearBottom = distanceFromBottom <= AUTO_PAGE_SCROLL_THRESHOLD;

      if (nearTop && previousPageOffset !== null && deltaY <= 0) {
        triggerAutoPageLoad("previous");
        return;
      }
      if (nearBottom && nextPageOffset !== null && deltaY >= 0) {
        triggerAutoPageLoad("next");
      }
    },
    [isActive, nextPageOffset, previousPageOffset, triggerAutoPageLoad],
  );

  const handleAutoPageScroll = useCallback(() => {
    evaluateAutoPageBoundary(0);
  }, [evaluateAutoPageBoundary]);

  const handleAutoPageWheel = useCallback(
    (event: ReactWheelEvent<HTMLDivElement>) => {
      evaluateAutoPageBoundary(event.deltaY);
    },
    [evaluateAutoPageBoundary],
  );

  // ─── Render ───────────────────────────────────────────────────────────

  const sortable = !searchNormalized;
  const boundary = (position: "top" | "bottom") => (
    <QuestPageBoundaryStatus
      position={position}
      total={pageInfo.total}
      limit={pageInfo.limit}
      windowOffset={windowOffset}
      renderedCount={pagedQuests.length}
      loadingDirection={loadingMoreDirection}
      canLoadPrevious={previousPageOffset !== null}
      canLoadNext={nextPageOffset !== null}
    />
  );

  return (
    <div
      ref={scrollContainerRef}
      data-testid="questmaster-scroll-container"
      onScroll={handleAutoPageScroll}
      onWheel={handleAutoPageWheel}
      className="h-full bg-cc-bg overflow-y-auto"
    >
      {/* ─── Sticky toolbar ────────────────────────────────────────────── */}
      <div className="sticky top-0 z-20 bg-cc-bg border-b border-cc-border/40">
        <div className="max-w-5xl mx-auto px-3 sm:px-6 pt-3 pb-2 space-y-2">
          <div className="flex items-center gap-2">
            {/* Unified search bar with hashtag chips */}
            <div className="relative flex-1 min-w-0">
              <div
                onClick={() => searchInputRef.current?.focus()}
                className={`flex items-center gap-1 px-2.5 py-1.5 bg-cc-input-bg border rounded-lg transition-colors cursor-text ${
                  searchFocused ? "border-cc-primary/50" : "border-cc-border"
                }`}
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="w-3.5 h-3.5 text-cc-muted shrink-0"
                >
                  <circle cx="6.5" cy="6.5" r="4.5" />
                  <path d="M10 10l3.5 3.5" strokeLinecap="round" />
                </svg>
                {/* Selected tag chips */}
                {Array.from(selectedTags).map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded bg-cc-primary/15 text-cc-primary shrink-0"
                  >
                    #{tag}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedTags((prev) => {
                          const next = new Set(prev);
                          next.delete(tag);
                          return next;
                        });
                      }}
                      className="hover:text-cc-fg cursor-pointer ml-0.5"
                    >
                      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-2 h-2">
                        <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                      </svg>
                    </button>
                  </span>
                ))}
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onFocus={() => setSearchFocused(true)}
                  onBlur={() => {
                    setSearchFocused(false);
                    // Delay closing autocomplete to allow click on item
                    setTimeout(() => {
                      setHashtagQuery("");
                      setAutocompleteIndex(0);
                    }, 150);
                  }}
                  onChange={(e) => {
                    const val = e.target.value;
                    // Positive trailing #tags keep the existing autocomplete flow.
                    // Negated tags (`-#tag`) stay in the raw query and should not
                    // create positive tag pills.
                    const trailingToken = getTrailingQuestSearchToken(val);
                    if (trailingToken) {
                      setHashtagQuery(trailingToken.value);
                      setAutocompleteIndex(0);
                      setSearchQuery(val);
                      return;
                    }
                    setHashtagQuery("");
                    setSearchQuery(val);
                  }}
                  onKeyDown={(e) => {
                    const currentSearchValue = (e.currentTarget as HTMLInputElement).value;
                    const currentTrailingToken = getTrailingQuestSearchToken(currentSearchValue);
                    const currentAutocompleteMatches = currentTrailingToken
                      ? getQuestSearchAutocompleteMatches(currentTrailingToken.value, allTags, selectedTags)
                      : [];
                    // Autocomplete navigation
                    if (currentTrailingToken && currentAutocompleteMatches.length > 0) {
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setAutocompleteIndex((i) => Math.min(i + 1, currentAutocompleteMatches.length - 1));
                        return;
                      }
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setAutocompleteIndex((i) => Math.max(i - 1, 0));
                        return;
                      }
                      if (e.key === "Enter" || e.key === "Tab") {
                        e.preventDefault();
                        const tag = currentAutocompleteMatches[autocompleteIndex];
                        if (tag) {
                          if (currentTrailingToken?.kind === "negatedTag") {
                            setSearchQuery(replaceTrailingSearchToken(currentSearchValue, `!#${tag}`));
                          } else {
                            setSelectedTags((prev) => new Set([...prev, tag]));
                            // Remove #query from search text
                            const hashIdx = currentSearchValue.lastIndexOf("#");
                            setSearchQuery(hashIdx > 0 ? currentSearchValue.slice(0, hashIdx).trimEnd() : "");
                          }
                          setHashtagQuery("");
                          setAutocompleteIndex(0);
                        }
                        return;
                      }
                    }
                    if (e.key === "Escape") {
                      if (currentTrailingToken) {
                        setHashtagQuery("");
                        setAutocompleteIndex(0);
                      } else {
                        setSearchQuery("");
                        setSelectedTags(new Set());
                        searchInputRef.current?.blur();
                      }
                    }
                    // Backspace on empty input removes last tag
                    if (e.key === "Backspace" && !searchQuery && selectedTags.size > 0) {
                      const tags = Array.from(selectedTags);
                      setSelectedTags(new Set(tags.slice(0, -1)));
                    }
                  }}
                  placeholder={selectedTags.size > 0 ? "Type or #tag..." : "Search or #tag..."}
                  className="flex-1 min-w-[60px] text-sm bg-transparent text-cc-fg placeholder:text-cc-muted focus:outline-none"
                />
                {(searchQuery || selectedTags.size > 0) && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setSearchQuery("");
                      setSelectedTags(new Set());
                      setHashtagQuery("");
                      searchInputRef.current?.focus();
                    }}
                    className="text-cc-muted hover:text-cc-fg cursor-pointer shrink-0"
                  >
                    <svg
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      className="w-3.5 h-3.5"
                    >
                      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Hashtag autocomplete dropdown */}
              {activeSearchToken && autocompleteMatches.length > 0 && searchFocused && (
                <div
                  ref={autocompleteRef}
                  className="absolute top-full left-0 right-0 mt-1 bg-cc-card border border-cc-border rounded-lg shadow-xl z-30 py-1 max-h-48 overflow-y-auto"
                >
                  {activeSearchToken?.kind === "negatedTag" && (
                    <div className="px-3 pb-1 text-[10px] font-medium uppercase tracking-wide text-cc-muted/70">
                      excluding:
                    </div>
                  )}
                  {autocompleteMatches.map((tag, i) => (
                    <button
                      key={tag}
                      onMouseDown={(e) => {
                        e.preventDefault(); // Prevent blur
                        if (activeSearchToken?.kind === "negatedTag") {
                          setSearchQuery(replaceTrailingSearchToken(searchQuery, `!#${tag}`));
                        } else {
                          setSelectedTags((prev) => new Set([...prev, tag]));
                          const hashIdx = searchQuery.lastIndexOf("#");
                          setSearchQuery(hashIdx > 0 ? searchQuery.slice(0, hashIdx).trimEnd() : "");
                        }
                        setHashtagQuery("");
                        setAutocompleteIndex(0);
                        searchInputRef.current?.focus();
                      }}
                      className={`w-full px-3 py-1.5 text-xs text-left flex items-center gap-2 transition-colors cursor-pointer ${
                        i === autocompleteIndex ? "bg-cc-primary/10 text-cc-primary" : "text-cc-fg hover:bg-cc-hover"
                      }`}
                    >
                      <span className="text-cc-muted">{activeSearchToken?.kind === "negatedTag" ? "!#" : "#"}</span>
                      {tag}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {layout === "phone" && sortable && (
              <QuestmasterSortSelect
                sort={compactSort}
                disabled={compactSortSaving}
                onSortChange={handleCompactSortChange}
              />
            )}
            <button
              type="button"
              onClick={() => setShowCreateForm(!showCreateForm)}
              aria-label="New quest"
              className="h-8 px-3 text-sm rounded-lg bg-cc-primary hover:bg-cc-primary-hover text-white transition-colors duration-150 flex items-center gap-1.5 cursor-pointer shrink-0"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
                <path d="M8 3v10M3 8h10" />
              </svg>
              <span>New</span>
            </button>
          </div>
          <QuestmasterStatusFilter
            statusFilter={statusFilter}
            counts={counts}
            layout={layout}
            onSelect={setStatusFilter}
          />
        </div>
      </div>

      {/* ─── Scrollable content ────────────────────────────────────────── */}
      <div className="max-w-5xl mx-auto px-3 sm:px-6 pb-6 sm:pb-10 pt-3">
        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-xs text-red-400 flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError("")} className="text-red-400 hover:text-red-300 cursor-pointer ml-2">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3 h-3">
                <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}

        <QuestmasterCreateForm
          isVisible={showCreateForm}
          allTags={allTags}
          sessionSpaceSlug={currentSessionSpaceSlug}
          onCreated={handleCreateQuestCreated}
          onCancel={handleCreateQuestCancel}
        />

        {questsLoading && pagedQuests.length === 0 ? (
          <div className="text-sm text-cc-muted text-center py-12">Loading quests...</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-cc-muted text-center py-12">
            {pageInfo.total === 0 && counts.all === 0
              ? "No quests yet. Create one to get started."
              : searchText || selectedTags.size > 0
                ? "No quests match your search."
                : "No quests match this filter."}
          </div>
        ) : (
          <>
            {boundary("top")}
            <div className="overflow-hidden rounded-xl border border-cc-border bg-cc-card divide-y divide-cc-border/60">
              {layout === "desktop" && (
                <QuestmasterColumnHeader
                  sort={compactSort}
                  sortSaving={compactSortSaving}
                  onSortChange={sortable ? handleCompactSortChange : undefined}
                />
              )}
              {filtered.map(renderRow)}
            </div>
            {boundary("bottom")}
          </>
        )}
      </div>
    </div>
  );
}

function QuestPageBoundaryStatus({
  position,
  total,
  limit,
  windowOffset,
  renderedCount,
  loadingDirection,
  canLoadPrevious,
  canLoadNext,
}: {
  position: "top" | "bottom";
  total: number;
  limit: number;
  windowOffset: number;
  renderedCount: number;
  loadingDirection: "next" | "previous" | null;
  canLoadPrevious: boolean;
  canLoadNext: boolean;
}) {
  if (total <= limit && windowOffset === 0) return null;
  if (position === "top" && !canLoadPrevious && loadingDirection !== "previous") return null;
  const start = total === 0 ? 0 : windowOffset + 1;
  const end = Math.min(windowOffset + renderedCount, total);
  const canLoad = position === "top" ? canLoadPrevious : canLoadNext;
  const loading = loadingDirection === (position === "top" ? "previous" : "next");
  const hint = loading
    ? position === "top"
      ? "Loading previous results..."
      : "Loading more results..."
    : canLoad
      ? position === "top"
        ? "Scroll up to load previous results"
        : "Scroll down to load more results"
      : position === "top"
        ? "Start of results"
        : "End of results";

  return (
    <div className="flex flex-col items-center gap-1 py-4 text-xs text-cc-muted" data-testid={`quest-page-${position}`}>
      <div data-testid={`quest-page-${position}-range`}>
        Showing {start}-{end} of {total}
      </div>
      <div className="text-[11px] text-cc-muted/70" data-testid={`quest-page-${position}-hint`}>
        {hint}
      </div>
    </div>
  );
}
