import { useCallback, useMemo } from "react";
import { LEADER_THREAD_TABS_PROJECTION_MAX_MESSAGE_ID_LENGTH } from "../../shared/leader-thread-tabs-projection.js";
import {
  threadStatusKey,
  threadStatusMessageIdHash,
  type LeaderThreadStatus,
} from "../../shared/thread-status-marker.js";
import { useStore } from "../store.js";
import { getAssistantVisibleMarkdown } from "../utils/assistant-message-renderability.js";
import { normalizeThreadKey, threadViewShows } from "../utils/thread-projection.js";
import { extractQuestQuizMarkerIds, stripQuestQuizMarkers } from "../components/AssistantQuestQuizContent.js";
import { selectThreadStatus } from "../utils/thread-status-store.js";
import type { Turn } from "./use-feed-model.js";
import type { TurnFinalFold } from "../components/turn-final-fold.js";

export interface TurnCollapseState {
  turnId: string;
  /**
   * Store key for this turn's manual expand/collapse choice. While a fresh
   * Ready collapses the turn, the key names that Ready, so a choice made
   * before it (a manual peek, or an expansion by navigation) gives way to the
   * Ready, while a choice made after it lasts until the next Ready.
   */
  overrideKey: string;
  defaultExpanded: boolean;
  isActivityExpanded: boolean;
  /** The latest turn is collapsed by default because its thread is freshly Ready. */
  readyCollapsed: boolean;
  /** The message in this turn that carries the Ready marker, when it is in the turn. */
  readyAnchorMessageId: string | null;
  /**
   * The latest turn folds before its newest final message: collapsed, it shows its final messages
   * and everything after the newest one. Null when the turn has no such fold or is Ready-collapsed.
   */
  finalFold: TurnFinalFold | null;
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
  return !threadViewShows(currentThreadKey, activeTurnThreadKey);
}

function matchesReadyMessageId(messageId: string, status: LeaderThreadStatus): boolean {
  if (status.messageId && status.messageId === messageId) return true;
  return !!status.messageIdHash && status.messageIdHash === threadStatusMessageIdHash(messageId);
}

/** Whether the status names its message completely, so a miss proves the message is elsewhere. */
function hasCompleteMessageIdentity(status: LeaderThreadStatus): boolean {
  if (status.messageIdHash) return true;
  return status.messageId.length > 0 && status.messageId.length < LEADER_THREAD_TABS_PROJECTION_MAX_MESSAGE_ID_LENGTH;
}

/** The override key of a turn while it folds before `fold`'s final message. */
export function finalFoldOverrideKey(fold: TurnFinalFold): string {
  return `${fold.turnId}#final:${fold.finalKey}`;
}

/** The override key of a turn while `status` (a fresh Ready) collapses it. */
export function readyTurnOverrideKey(turnId: string, status: LeaderThreadStatus): string {
  return `${turnId}#ready:${status.messageIdHash ?? status.messageId}@${status.timestamp}`;
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

function findReadyAnchorIndex(turn: Turn, status: LeaderThreadStatus, normalizedThreadKey: string): number {
  let readyAnchorIndex = -1;
  for (const [index, entry] of turn.allEntries.entries()) {
    if (entry.kind !== "message") continue;
    const matchesMessage = matchesReadyMessageId(entry.msg.id, status);
    const matchesMarker = (entry.msg.metadata?.threadStatusMarkers ?? []).some(
      (marker) =>
        marker.kind === "ready" &&
        threadStatusKey(marker.threadKey) === normalizedThreadKey &&
        matchesReadyMessageId(marker.messageId, status),
    );
    if (matchesMessage || matchesMarker) readyAnchorIndex = index;
  }
  return readyAnchorIndex;
}

/**
 * A leader can mark this thread Ready from a message routed to another
 * thread, so the marker is not in this turn. The Ready still covers the turn
 * when the turn began before it: anchor just before the first message timed
 * after the Ready.
 */
function findCrossThreadReadyAnchorIndex(turn: Turn, status: LeaderThreadStatus): number {
  if (!hasCompleteMessageIdentity(status)) return -1;
  const userEntry = turn.userEntry;
  if (userEntry?.kind === "message" && userEntry.msg.timestamp > status.timestamp) return -1;
  const firstLaterIndex = turn.allEntries.findIndex(
    (entry) => entry.kind === "message" && entry.msg.timestamp > status.timestamp,
  );
  return (firstLaterIndex < 0 ? turn.allEntries.length : firstLaterIndex) - 1;
}

/** The Ready anchor when the status is fresh for this turn: nothing the model did follows it. */
function findFreshReadyAnchor(
  turn: Turn,
  threadKey: string | null,
  status: LeaderThreadStatus | null,
): { messageId: string | null } | null {
  if (!threadKey || !status) return null;
  const normalizedThreadKey = normalizeThreadKey(threadKey);
  const anchorIndex = findReadyAnchorIndex(turn, status, normalizedThreadKey);
  const effectiveIndex = anchorIndex >= 0 ? anchorIndex : findCrossThreadReadyAnchorIndex(turn, status);
  if (effectiveIndex < 0) return null;
  if (turn.allEntries.slice(effectiveIndex + 1).some(entryHasModelActivity)) return null;
  const anchor = anchorIndex >= 0 ? turn.allEntries[anchorIndex] : null;
  return { messageId: anchor?.kind === "message" ? anchor.msg.id : null };
}

export function useCollapsePolicy({
  autoCollapseReadyAfter = null,
  autoCollapseReadyThreadKey = null,
  finalFold = null,
  sessionId,
  turns,
}: {
  autoCollapseReadyAfter?: number | null;
  autoCollapseReadyThreadKey?: string | null;
  /** The latest turn's fold before its newest final message (leader threads), when it has one. */
  finalFold?: TurnFinalFold | null;
  sessionId: string;
  turns: Turn[];
}): {
  turnStates: TurnCollapseState[];
  toggleTurn: (turnId: string) => void;
} {
  const overrides = useStore((s) => s.turnActivityOverrides.get(sessionId));
  const threadStatus = useStore((s) =>
    autoCollapseReadyThreadKey ? selectThreadStatus(s, sessionId, autoCollapseReadyThreadKey) : null,
  );
  const toggleTurnActivity = useStore((s) => s.toggleTurnActivity);
  const readyStatus = useMemo<LeaderThreadStatus | null>(() => {
    if (threadStatus?.kind !== "ready" || !(threadStatus.messageId || threadStatus.messageIdHash)) return null;
    return autoCollapseReadyAfter == null || threadStatus.timestamp >= autoCollapseReadyAfter ? threadStatus : null;
  }, [autoCollapseReadyAfter, threadStatus]);

  const turnStates = useMemo(() => {
    return turns.map((turn, index): TurnCollapseState => {
      const isLastTurn = index === turns.length - 1;
      const freshReady = isLastTurn ? findFreshReadyAnchor(turn, autoCollapseReadyThreadKey, readyStatus) : null;
      const readyCollapsed = freshReady !== null;
      const fold = isLastTurn && !readyCollapsed && finalFold?.turnId === turn.id ? finalFold : null;
      const defaultExpanded = isLastTurn && !readyCollapsed && !fold;
      // Like a Ready, each newer final message folds the turn again, even after the user expanded it.
      const overrideKey =
        readyCollapsed && readyStatus
          ? readyTurnOverrideKey(turn.id, readyStatus)
          : fold
            ? finalFoldOverrideKey(fold)
            : turn.id;
      const override = overrides?.get(overrideKey);
      const isActivityExpanded = override !== undefined ? override : defaultExpanded;

      return {
        turnId: turn.id,
        overrideKey,
        defaultExpanded,
        isActivityExpanded,
        readyCollapsed,
        readyAnchorMessageId: freshReady?.messageId ?? null,
        finalFold: fold,
      };
    });
  }, [autoCollapseReadyThreadKey, finalFold, overrides, readyStatus, turns]);

  const turnStateById = useMemo(() => new Map(turnStates.map((state) => [state.turnId, state])), [turnStates]);

  const toggleTurn = useCallback(
    (turnId: string) => {
      const state = turnStateById.get(turnId);
      if (!state) return;
      toggleTurnActivity(sessionId, state.overrideKey, state.defaultExpanded);
    },
    [sessionId, toggleTurnActivity, turnStateById],
  );

  return {
    turnStates,
    toggleTurn,
  };
}
