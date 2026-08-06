import { useCallback, useMemo } from "react";
import { threadStatusKey } from "../../shared/thread-status-marker.js";
import { useStore } from "../store.js";
import { normalizeThreadKey } from "../utils/thread-projection.js";
import type { Turn } from "./use-feed-model.js";

export interface TurnCollapseState {
  turnId: string;
  defaultExpanded: boolean;
  isActivityExpanded: boolean;
}

function turnHasReadyStatusMarker(turn: Turn, threadKey: string | null, readyMessageIds: ReadonlySet<string>): boolean {
  if (!threadKey || readyMessageIds.size === 0) return false;
  const normalizedThreadKey = normalizeThreadKey(threadKey);
  for (const entry of turn.allEntries) {
    if (entry.kind !== "message") continue;
    if (readyMessageIds.has(entry.msg.id)) return true;
    if (
      (entry.msg.metadata?.threadStatusMarkers ?? []).some(
        (marker) =>
          marker.kind === "ready" &&
          threadStatusKey(marker.threadKey) === normalizedThreadKey &&
          readyMessageIds.has(marker.messageId),
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
  const currentThreadStatuses = useStore((s) => s.sessions?.get(sessionId)?.leaderThreadStatuses);
  const toggleTurnActivity = useStore((s) => s.toggleTurnActivity);
  const readyMessageIds = useMemo(() => {
    if (!autoCollapseReadyThreadKey || !currentThreadStatuses) return new Set<string>();
    const normalizedThreadKey = normalizeThreadKey(autoCollapseReadyThreadKey);
    return new Set(
      Object.values(currentThreadStatuses)
        .filter((status) => status.kind === "ready" && threadStatusKey(status.threadKey) === normalizedThreadKey)
        .map((status) => status.messageId),
    );
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
