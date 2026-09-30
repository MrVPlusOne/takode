import { useCallback, useState } from "react";
import { api } from "../api.js";
import { useStore } from "../store.js";
import { disconnectSession } from "../ws.js";
import { navigateToMostRecentSession } from "../utils/routing.js";
import { applyAuthoritativeSessionArchive, refreshActiveSessionMetadata } from "../session-list-hydration.js";
import { archiveGroupNavigationExcludedIds, archiveGroupSuccessfulIds } from "../utils/archive-group-reconciliation.js";
import type { ArchiveConfirmationState } from "../components/SessionArchiveConfirmation.js";

const refreshActiveSessions = () => refreshActiveSessionMetadata({ force: true });

/** Session actions shared by sidebar rows and the header, including archive safeguards. */
export function useSessionActions(
  refreshSessionListNow: (refreshArchivedPage?: boolean) => Promise<void> = refreshActiveSessions,
  refreshArchived = false,
) {
  const [archiveConfirmation, setArchiveConfirmation] = useState<ArchiveConfirmationState | null>(null);
  const removeSession = useStore((s) => s.removeSession);
  const handlePauseToggle = useCallback(
    async (sessionId: string, paused: boolean) => {
      try {
        if (paused) await api.unpauseSession(sessionId);
        else await api.pauseSession(sessionId);
        await refreshSessionListNow();
      } catch (err) {
        console.warn("[sidebar] failed to toggle session pause:", err);
      }
    },
    [refreshSessionListNow],
  );

  const handleDeleteSession = useCallback(
    async (e: React.MouseEvent, sessionId: string) => {
      e.stopPropagation();
      try {
        disconnectSession(sessionId);
        await api.deleteSession(sessionId);
      } catch {
        // best-effort
      }
      if (useStore.getState().currentSessionId === sessionId) {
        navigateToMostRecentSession({ excludeId: sessionId });
      }
      removeSession(sessionId);
    },
    [removeSession],
  );

  function handleArchiveSession(e: React.MouseEvent, sessionId: string) {
    e.stopPropagation();
    const state = useStore.getState();
    const sdk = state.sdkSessions.find((candidate) => candidate.sessionId === sessionId);
    const bridge = state.sessions.get(sessionId);
    const isContainerized = bridge?.is_containerized === true || typeof sdk?.containerId === "string";
    const isWorktree = bridge?.is_worktree === true || sdk?.isWorktree === true;
    const isOrchestrator = bridge?.isOrchestrator === true || sdk?.isOrchestrator === true;
    const activeWorkerCount = isOrchestrator
      ? state.sdkSessions.filter((worker) => worker.herdedBy === sessionId && !worker.archived).length
      : 0;
    if (isWorktree || isContainerized || activeWorkerCount > 0) {
      setArchiveConfirmation({
        sessionId,
        kind: activeWorkerCount > 0 ? "leader" : isWorktree ? "worktree" : "container",
        activeWorkerCount: activeWorkerCount > 0 ? activeWorkerCount : undefined,
        leaderArchiveDestructiveTarget:
          activeWorkerCount > 0 && isWorktree
            ? "worktree"
            : activeWorkerCount > 0 && isContainerized
              ? "container"
              : undefined,
      });
      return;
    }
    doArchive(sessionId);
  }

  async function doArchive(sessionId: string, force?: boolean) {
    try {
      disconnectSession(sessionId);
      const result = await api.archiveSession(sessionId, force ? { force: true } : undefined);
      applyAuthoritativeSessionArchive(result.sessionId ?? sessionId, result.archivedAt);
    } catch {
      // best-effort
    }
    if (useStore.getState().currentSessionId === sessionId) {
      navigateToMostRecentSession({ excludeId: sessionId });
    }
    void refreshSessionListNow(refreshArchived);
  }

  const confirmArchive = useCallback(() => {
    if (archiveConfirmation) {
      doArchive(archiveConfirmation.sessionId, true);
      setArchiveConfirmation(null);
    }
  }, [archiveConfirmation, doArchive]);

  const cancelArchive = useCallback(() => {
    setArchiveConfirmation(null);
  }, []);

  const doArchiveGroup = useCallback(
    async (leaderId: string) => {
      const state = useStore.getState();
      const workers = state.sdkSessions
        .filter((worker) => worker.herdedBy === leaderId && !worker.archived)
        .map((worker) => ({ sessionId: worker.sessionId }));
      const navigationExcludedIds = archiveGroupNavigationExcludedIds(leaderId, workers);
      let archivedIds = new Set<string>();
      try {
        for (const w of workers) {
          disconnectSession(w.sessionId);
        }
        disconnectSession(leaderId);

        const result = await api.archiveGroup(leaderId);
        archivedIds = archiveGroupSuccessfulIds(leaderId, workers, result);
        const archivedAt = Date.now();
        for (const archivedId of archivedIds) {
          applyAuthoritativeSessionArchive(archivedId, archivedAt);
        }
      } catch {
        // best-effort
      }
      // Navigate away if the current session is part of the archived group
      const currentId = useStore.getState().currentSessionId;
      if (currentId) {
        if (navigationExcludedIds.has(currentId)) {
          navigateToMostRecentSession({ excludeIds: navigationExcludedIds });
        }
      }
      void refreshSessionListNow(refreshArchived);
    },
    [refreshArchived, refreshSessionListNow],
  );

  const confirmArchiveHerdMembers = useCallback(() => {
    if (archiveConfirmation?.kind === "leader") {
      void doArchiveGroup(archiveConfirmation.sessionId);
      setArchiveConfirmation(null);
    }
  }, [archiveConfirmation, doArchiveGroup]);

  const doHerdToCurrentSession = useCallback(async (workerId: string, force = false) => {
    const leaderId = useStore.getState().currentSessionId;
    if (!leaderId) return;
    try {
      const result = await api.herdWorkerToLeader(workerId, leaderId, force ? { force: true } : undefined);
      if (result.herded.length === 0) {
        throw new Error("Failed to herd session");
      }
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to herd session");
      return;
    }
  }, []);

  async function handleUnarchiveSession(e: React.MouseEvent, sessionId: string) {
    e.stopPropagation();
    try {
      await api.unarchiveSession(sessionId);
    } catch {
      // best-effort
    }
    void refreshSessionListNow(true);
  }

  return {
    handlePauseToggle,
    handleDeleteSession,
    handleArchiveSession,
    handleUnarchiveSession,
    doArchiveGroup,
    doHerdToCurrentSession,
    archiveConfirmation,
    confirmArchive,
    confirmArchiveHerdMembers,
    cancelArchive,
  };
}
