import { useCallback, useMemo } from "react";
import { threadStatusKey, threadStatusMessageIdHash } from "../../shared/thread-status-marker.js";
import { useStore } from "../store.js";
import { normalizeThreadKey } from "../utils/thread-projection.js";
import { selectLeaderThreadStatuses } from "../utils/leader-thread-tabs-resolver.js";
import type { Turn } from "./use-feed-model.js";

export interface TurnCollapseState {
  turnId: string;
  defaultExpanded: boolean;
  isActivityExpanded: boolean;
}

interface ReadyMessageIdentities {
  exact: ReadonlySet<string>;
  hashes: ReadonlySet<string>;
}

function matchesReadyMessageId(messageId: string, identities: ReadyMessageIdentities): boolean {
  return identities.exact.has(messageId) || identities.hashes.has(threadStatusMessageIdHash(messageId));
}

function turnHasReadyStatusMarker(
  turn: Turn,
  threadKey: string | null,
  readyMessageIds: ReadyMessageIdentities,
): boolean {
  if (!threadKey || (readyMessageIds.exact.size === 0 && readyMessageIds.hashes.size === 0)) return false;
  const normalizedThreadKey = normalizeThreadKey(threadKey);
  for (const entry of turn.allEntries) {
    if (entry.kind !== "message") continue;
    if (matchesReadyMessageId(entry.msg.id, readyMessageIds)) return true;
    if (
      (entry.msg.metadata?.threadStatusMarkers ?? []).some(
        (marker) =>
          marker.kind === "ready" &&
          threadStatusKey(marker.threadKey) === normalizedThreadKey &&
          matchesReadyMessageId(marker.messageId, readyMessageIds),
      )
    ) {
      return true;
    }
  }
  return false;
}

export function useCollapsePolicy({
  autoCollapseReadyThreadKey = null,
  sessionId,
  turns,
}: {
  autoCollapseReadyThreadKey?: string | null;
  sessionId: string;
  turns: Turn[];
}): {
  turnStates: TurnCollapseState[];
  toggleTurn: (turnId: string) => void;
} {
  const overrides = useStore((s) => s.turnActivityOverrides.get(sessionId));
  const currentThreadStatuses = useStore((s) => selectLeaderThreadStatuses(s, sessionId));
  const toggleTurnActivity = useStore((s) => s.toggleTurnActivity);
  const readyMessageIds = useMemo<ReadyMessageIdentities>(() => {
    if (!autoCollapseReadyThreadKey || !currentThreadStatuses) {
      return { exact: new Set<string>(), hashes: new Set<string>() };
    }
    const normalizedThreadKey = normalizeThreadKey(autoCollapseReadyThreadKey);
    const statuses = Object.values(currentThreadStatuses).filter(
      (status) => status.kind === "ready" && threadStatusKey(status.threadKey) === normalizedThreadKey,
    );
    return {
      exact: new Set(statuses.map((status) => status.messageId).filter(Boolean)),
      hashes: new Set(statuses.map((status) => status.messageIdHash).filter((hash): hash is string => !!hash)),
    };
  }, [autoCollapseReadyThreadKey, currentThreadStatuses]);

  const turnStates = useMemo(() => {
    return turns.map((turn, index) => {
      const isLastTurn = index === turns.length - 1;
      const defaultExpanded =
        isLastTurn && !turnHasReadyStatusMarker(turn, autoCollapseReadyThreadKey, readyMessageIds);
      const override = overrides?.get(turn.id);
      const isActivityExpanded = override !== undefined ? override : defaultExpanded;

      return {
        turnId: turn.id,
        defaultExpanded,
        isActivityExpanded,
      };
    });
  }, [autoCollapseReadyThreadKey, overrides, readyMessageIds, turns]);

  const turnStateById = useMemo(() => new Map(turnStates.map((state) => [state.turnId, state])), [turnStates]);

  const toggleTurn = useCallback(
    (turnId: string) => {
      const state = turnStateById.get(turnId);
      if (!state) return;
      toggleTurnActivity(sessionId, turnId, state.defaultExpanded);
    },
    [sessionId, toggleTurnActivity, turnStateById],
  );

  return {
    turnStates,
    toggleTurn,
  };
}
