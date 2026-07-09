import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { api } from "../api.js";
import { hydrateSessionList } from "../session-list-hydration.js";
import {
  ARCHIVED_SESSION_AUTO_LOAD_ROOT_MARGIN_PX,
  ARCHIVED_SESSION_PAGE_SIZE,
  type ArchivedSessionPageState,
} from "../utils/archived-session-page.js";

const INITIAL_ARCHIVED_SESSION_PAGE: ArchivedSessionPageState = {
  loaded: false,
  loading: false,
  total: null,
  hasMore: false,
  nextOffset: 0,
  ids: [],
  error: null,
};

export function useArchivedSessionPaging({
  showArchived,
  scrollerRef,
}: {
  showArchived: boolean;
  scrollerRef: RefObject<HTMLDivElement | null>;
}) {
  const [archivedSessionPage, setArchivedSessionPage] =
    useState<ArchivedSessionPageState>(INITIAL_ARCHIVED_SESSION_PAGE);
  const [autoLoadUnsupported, setAutoLoadUnsupported] = useState(false);
  const archivedSessionPageRef = useRef(archivedSessionPage);
  const inFlightOffsetRef = useRef<number | null>(null);
  const loadMoreSentinelRef = useRef<HTMLDivElement | null>(null);

  const setArchivedSessionPageAndRef = useCallback(
    (updater: (prev: ArchivedSessionPageState) => ArchivedSessionPageState) => {
      const next = updater(archivedSessionPageRef.current);
      archivedSessionPageRef.current = next;
      setArchivedSessionPage(next);
    },
    [],
  );

  useEffect(() => {
    archivedSessionPageRef.current = archivedSessionPage;
  }, [archivedSessionPage]);

  useEffect(() => {
    let cancelled = false;
    api
      .getArchivedSessionsSummary()
      .then((summary) => {
        if (cancelled) return;
        setArchivedSessionPageAndRef((prev) => (prev.loaded ? prev : { ...prev, total: summary.total }));
      })
      .catch((err) => {
        console.warn("[sidebar] archived session summary refresh failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [setArchivedSessionPageAndRef]);

  const loadArchivedSessionsPage = useCallback(
    async (options: { reset?: boolean } = {}) => {
      const current = archivedSessionPageRef.current;
      const offset = options.reset ? 0 : current.nextOffset;
      if (current.loading || inFlightOffsetRef.current !== null) return;
      inFlightOffsetRef.current = offset;
      setArchivedSessionPageAndRef((prev) => ({
        ...prev,
        loading: true,
        error: null,
        ...(options.reset ? { ids: [], nextOffset: 0, hasMore: false } : {}),
      }));
      try {
        const page = await api.listArchivedSessionsPage({ offset, limit: ARCHIVED_SESSION_PAGE_SIZE });
        hydrateSessionList(page.sessions, { preserveMissingSessions: true });
        setArchivedSessionPageAndRef((prev) => {
          const nextIds = options.reset ? [] : [...prev.ids];
          const seen = new Set(nextIds);
          for (const session of page.sessions) {
            if (seen.has(session.sessionId)) continue;
            seen.add(session.sessionId);
            nextIds.push(session.sessionId);
          }
          return {
            loaded: true,
            loading: false,
            total: page.total,
            hasMore: page.hasMore,
            nextOffset: page.nextOffset ?? offset + page.sessions.length,
            ids: nextIds,
            error: null,
          };
        });
      } catch (err) {
        console.warn("[sidebar] archived session page refresh failed:", err);
        setArchivedSessionPageAndRef((prev) => ({
          ...prev,
          loaded: true,
          loading: false,
          error: "Archived sessions failed to load.",
        }));
      } finally {
        inFlightOffsetRef.current = null;
      }
    },
    [setArchivedSessionPageAndRef],
  );

  useEffect(() => {
    if (!showArchived || !archivedSessionPage.hasMore) {
      setAutoLoadUnsupported(false);
      return;
    }

    const root = scrollerRef.current;
    const sentinel = loadMoreSentinelRef.current;
    if (!root || !sentinel || typeof IntersectionObserver === "undefined") {
      setAutoLoadUnsupported(true);
      return;
    }

    setAutoLoadUnsupported(false);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadArchivedSessionsPage();
      },
      {
        root,
        rootMargin: `${ARCHIVED_SESSION_AUTO_LOAD_ROOT_MARGIN_PX}px 0px`,
        threshold: 0,
      },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [archivedSessionPage.hasMore, loadArchivedSessionsPage, scrollerRef, showArchived]);

  return {
    archivedSessionPage,
    autoLoadUnsupported,
    loadArchivedSessionsPage,
    loadMoreSentinelRef,
  };
}
