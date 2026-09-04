import { useCallback, useMemo } from "react";
import { threadStatusKey, threadStatusMessageIdHash } from "../../shared/thread-status-marker.js";
import { useStore } from "../store.js";
import { getAssistantVisibleMarkdown } from "../utils/assistant-message-renderability.js";
import { normalizeThreadKey } from "../utils/thread-projection.js";
import { extractQuestQuizMarkerIds, stripQuestQuizMarkers } from "../components/AssistantQuestQuizContent.js";
import { selectLeaderThreadStatuses } from "../utils/leader-thread-tabs-resolver.js";
import type { Turn } from "./use-feed-model.js";

export interface TurnCollapseState {
  turnId: string;
  defaultExpanded: boolean;
  isActivityExpanded: boolean;
}

export function canAutoCollapseReadyThread({
  activeTurnThreadKey,
  currentThreadKey,
  sessionStatus,
}: {
  activeTurnThreadKey?: string | null;
  currentThreadKey: string;
  sessionStatus: "idle" | "running" | "compacting" | "reverting" | null;
}): boolean {
  if (sessionStatus === "compacting" || sessionStatus === "reverting") return false;
  if (sessionStatus !== "running") return true;
  if (!activeTurnThreadKey) return false;
  return normalizeThreadKey(activeTurnThreadKey) !== normalizeThreadKey(currentThreadKey);
}

interface ReadyMessageIdentities {
  exact: ReadonlySet<string>;
  hashes: ReadonlySet<string>;
}

function matchesReadyMessageId(messageId: string, identities: ReadyMessageIdentities): boolean {
  return identities.exact.has(messageId) || identities.hashes.has(threadStatusMessageIdHash(messageId));
}

function entryHasModelActivity(entry: Turn["allEntries"][number]): boolean {
  if (entry.kind !== "message") return true;
  if (entry.msg.role !== "assistant") return false;
  const visibleMarkdown = getAssistantVisibleMarkdown(entry.msg);
  const hasQuiz = extractQuestQuizMarkerIds(visibleMarkdown).length > 0;
  const onlyQuizText = hasQuiz && stripQuestQuizMarkers(visibleMarkdown).length === 0;
  const hasNonTextBlock = (entry.msg.contentBlocks ?? []).some((block) => block.type !== "text");
  const hasVisibleChild =
    entry.msg.notification != null ||
    (entry.msg.images?.length ?? 0) > 0 ||
    (entry.msg.localImages?.length ?? 0) > 0 ||
    entry.msg.metadata?.attentionRecord != null ||
    entry.msg.metadata?.codexReasoningDetail != null;
  if (onlyQuizText && !hasNonTextBlock && !hasVisibleChild) return false;
  return (entry.msg.contentBlocks?.length ?? 0) > 0 || entry.msg.content.trim().length > 0 || hasVisibleChild;
}

function turnHasFreshReadyStatusMarker(
  turn: Turn,
  threadKey: string | null,
  readyMessageIds: ReadyMessageIdentities,
): boolean {
  if (!threadKey || (readyMessageIds.exact.size === 0 && readyMessageIds.hashes.size === 0)) return false;
  const normalizedThreadKey = normalizeThreadKey(threadKey);
  let readyAnchorIndex = -1;
  for (const [index, entry] of turn.allEntries.entries()) {
    if (entry.kind !== "message") continue;
    const matchesMessage = matchesReadyMessageId(entry.msg.id, readyMessageIds);
    const matchesMarker = (entry.msg.metadata?.threadStatusMarkers ?? []).some(
      (marker) =>
        marker.kind === "ready" &&
        threadStatusKey(marker.threadKey) === normalizedThreadKey &&
        matchesReadyMessageId(marker.messageId, readyMessageIds),
    );
    if (matchesMessage || matchesMarker) readyAnchorIndex = index;
  }
  if (readyAnchorIndex < 0) return false;
  return !turn.allEntries.slice(readyAnchorIndex + 1).some(entryHasModelActivity);
}

export function useCollapsePolicy({
  autoCollapseReadyAfter = null,
  autoCollapseReadyThreadKey = null,
  sessionId,
  turns,
}: {
  autoCollapseReadyAfter?: number | null;
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
      (status) =>
        status.kind === "ready" &&
        threadStatusKey(status.threadKey) === normalizedThreadKey &&
        (autoCollapseReadyAfter == null || status.timestamp >= autoCollapseReadyAfter),
    );
    return {
      exact: new Set(statuses.map((status) => status.messageId).filter(Boolean)),
      hashes: new Set(statuses.map((status) => status.messageIdHash).filter((hash): hash is string => !!hash)),
    };
  }, [autoCollapseReadyAfter, autoCollapseReadyThreadKey, currentThreadStatuses]);

  const turnStates = useMemo(() => {
    return turns.map((turn, index) => {
      const isLastTurn = index === turns.length - 1;
      const defaultExpanded =
        isLastTurn && !turnHasFreshReadyStatusMarker(turn, autoCollapseReadyThreadKey, readyMessageIds);
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
