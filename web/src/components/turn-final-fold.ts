import { useMemo } from "react";
import type { ChatMessage } from "../types.js";
import type { LeaderThreadStatus } from "../../shared/thread-status-marker.js";
import { getEntryId, type FeedEntry, type Turn } from "../hooks/use-feed-model.js";
import { readyThreadResponseRows } from "./ReadyThreadResponseRows.js";
import { isBoardProposalMessage } from "../utils/takode-tool-command.js";
import { getAssistantVisibleMarkdown } from "../utils/assistant-message-renderability.js";
import { isQuestThreadKey } from "../../shared/thread-routing.js";
import { extractQuestQuizMarkerIds } from "./AssistantQuestQuizContent.js";
import { useQuestRecord } from "./QuestSummaryCard.js";
import {
  readyThreadResponseAppliesToTurn,
  threadResponsePresentationTouchesTurn,
  type ThreadResponsePresentation,
} from "./thread-response-presentation.js";

/**
 * Where a leader turn folds before its newest final message. Final messages are what a collapsed
 * turn keeps on screen: answers and new results, needs-input questions, published reports, a quiz
 * and the Quest complete card. While a newer final exists, the commentary and activity before it
 * fold away like an older turn's, and what came after it stays open, so a returning user reads the
 * newest final and what followed without scrolling past the work that led to it.
 */
export interface TurnFinalFold {
  turnId: string;
  /** The newest final: a new one starts a new fold, so an earlier expansion gives way to it. */
  finalKey: string;
  /** When the newest final was posted. */
  foldAt: number;
  /** Index in the turn's presentation entries of the first entry after that final. */
  tailStartIndex: number;
}

/** The thread's answer presentation while the thread is freshly Ready (no answer newer than the Ready). */
export function readyResponsePresentation(
  presentation: ThreadResponsePresentation | null | undefined,
  visibleThreadStatuses: readonly LeaderThreadStatus[],
): ThreadResponsePresentation | null {
  if (!presentation?.ready) return null;
  const latestAnswerAt = Math.max(
    0,
    ...presentation.currentResponses
      .filter((item) => item.response.coveredUserMessageIds.length > 0)
      .map((item) => item.response.updatedAt),
  );
  return visibleThreadStatuses.some((status) => status.kind === "ready" && status.timestamp >= latestAnswerAt)
    ? presentation
    : null;
}

/** The answer presentation a turn's collapsed card uses, or null when it shows its own collapsed rows. */
export function collapsedPresentationForTurn(
  turn: Turn,
  presentation: ThreadResponsePresentation | null | undefined,
  readyPresentation: ThreadResponsePresentation | null,
): ThreadResponsePresentation | null {
  if (!presentation || !readyThreadResponseAppliesToTurn(turn, presentation)) return null;
  return readyPresentation || threadResponsePresentationTouchesTurn(turn, presentation) ? presentation : null;
}

/**
 * The fold of a leader turn: null when it holds no final, or nothing before its newest final would
 * fold away (then the turn reads the same either way and stays as it is). `questCompletedAt` is when
 * the thread's quest completed, whose Quest complete card is a final placed at that time.
 */
export function turnFinalFold(
  turn: Turn | undefined,
  collapsedPresentation: ThreadResponsePresentation | null,
  needsInputAnchorMessageIds: ReadonlySet<string>,
  questCompletedAt: number | null = null,
): TurnFinalFold | null {
  if (!turn) return null;
  // The rows the turn's collapsed card shows.
  const shownIds = new Set(
    collapsedPresentation
      ? readyThreadResponseRows(turn, collapsedPresentation, needsInputAnchorMessageIds, null).rows.map((row) =>
          getEntryId(row.entry),
        )
      : [
          ...turn.subConclusions.map((item) => getEntryId(item.entry)),
          ...(turn.collapsedEntries ?? []).flatMap((row) => (row.kind === "entry" ? [getEntryId(row.entry)] : [])),
        ],
  );
  const entries: readonly FeedEntry[] = turn.presentationEntries ?? turn.allEntries;
  // Only an explicit final folds a turn: a row the card shows by inference (an unrouted legacy
  // message standing in for an answer) leaves the activity before it open. A quiz's message is a
  // final the card shows in its own Quiz row.
  const isFinal = (entry: FeedEntry) =>
    entry.kind === "message" &&
    ((shownIds.has(entry.msg.id) && isFinalMessage(entry.msg, needsInputAnchorMessageIds)) || hostsQuiz(entry.msg));
  const finalIndex = entries.findLastIndex(isFinal);
  const finalEntry = entries[finalIndex];
  let fold =
    finalEntry?.kind === "message"
      ? { finalKey: finalEntry.msg.id, foldAt: finalEntry.msg.timestamp, tailStartIndex: finalIndex + 1 }
      : null;
  const turnStart = [turn.userEntry, ...entries].find((entry) => entry?.kind === "message");
  if (
    questCompletedAt !== null &&
    questCompletedAt >= (fold?.foldAt ?? -Infinity) &&
    turnStart?.kind === "message" &&
    questCompletedAt >= turnStart.msg.timestamp
  ) {
    const after = entries.findIndex((entry) => entry.kind === "message" && entry.msg.timestamp > questCompletedAt);
    fold = {
      finalKey: `quest-complete@${questCompletedAt}`,
      foldAt: questCompletedAt,
      tailStartIndex: after < 0 ? entries.length : after,
    };
  }
  if (!fold) return null;
  const foldsSomething = entries
    .slice(0, fold.tailStartIndex)
    .some((entry) => !shownIds.has(getEntryId(entry)) && !isFinal(entry));
  return foldsSomething ? { turnId: turn.id, ...fold } : null;
}

/** Whether a message is final: an answer or new result, a needs-input question, a published report or a proposal. */
export function isFinalMessage(msg: ChatMessage, needsInputAnchorMessageIds: ReadonlySet<string>): boolean {
  const metadata = msg.metadata;
  return (
    metadata?.leaderThreadRole === "answer" ||
    metadata?.threadAnswer != null ||
    metadata?.markdownReport != null ||
    msg.notification?.category === "needs-input" ||
    needsInputAnchorMessageIds.has(msg.id) ||
    isBoardProposalMessage(msg)
  );
}

/**
 * The fold of a leader feed's latest turn. `threadKey` is the view's thread (null where no fold
 * applies, such as All Threads); a quest thread's Quest complete card counts as a final.
 */
export function useLatestTurnFinalFold(
  threadKey: string | null,
  turns: readonly Turn[],
  presentation: ThreadResponsePresentation | null | undefined,
  needsInputAnchorMessageIds: ReadonlySet<string>,
  visibleThreadStatuses: readonly LeaderThreadStatus[],
): TurnFinalFold | null {
  const quest = useQuestRecord(threadKey && isQuestThreadKey(threadKey) ? threadKey : null);
  const questCompletedAt = quest?.status === "done" ? quest.completedAt : null;
  return useMemo(() => {
    const turn = turns.at(-1);
    if (threadKey === null || !turn) return null;
    const ready = readyResponsePresentation(presentation, visibleThreadStatuses);
    return turnFinalFold(
      turn,
      collapsedPresentationForTurn(turn, presentation, ready),
      needsInputAnchorMessageIds,
      questCompletedAt,
    );
  }, [threadKey, turns, presentation, needsInputAnchorMessageIds, visibleThreadStatuses, questCompletedAt]);
}

/** Whether a message carries a Quest Quiz directive. */
function hostsQuiz(msg: ChatMessage): boolean {
  return msg.role === "assistant" && extractQuestQuizMarkerIds(getAssistantVisibleMarkdown(msg)).length > 0;
}

const tailTurns = new WeakMap<Turn, { tailStartIndex: number; tail: Turn }>();

/**
 * The part of a folded turn after its newest final message, as a turn of its own that renders like
 * an expanded one. Kept per turn object, so the memoized expanded rendering sees the same tail.
 */
export function finalFoldTail(turn: Turn, fold: TurnFinalFold): Turn {
  const cached = tailTurns.get(turn);
  if (cached?.tailStartIndex === fold.tailStartIndex) return cached.tail;
  const entries = turn.presentationEntries ?? turn.allEntries;
  // No user message heads the tail, so its first entry doesn't read as a reply to it.
  const tail: Turn = { ...turn, userEntry: null, presentationEntries: entries.slice(fold.tailStartIndex) };
  tailTurns.set(turn, { tailStartIndex: fold.tailStartIndex, tail });
  return tail;
}
