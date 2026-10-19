import type { ReactNode } from "react";
import type { FeedEntry, Turn } from "../hooks/use-feed-model.js";
import type { QuestLinkSurface } from "./quest-link-surface.js";
import { AssistantQuestQuizContent } from "./AssistantQuestQuizContent.js";
import { HidePawContext } from "./PawTrail.js";
import { collapsedResponseEntry, type ThreadResponsePresentation } from "./thread-response-presentation.js";
import { AnsweredMessage, type AnswerChrome } from "./ThreadResponsePresentationChrome.js";
import { isBoardProposalMessage } from "../utils/takode-tool-command.js";

function presentationEntries(turn: Turn): readonly FeedEntry[] {
  return turn.presentationEntries ?? turn.allEntries;
}

function sourceDecisionEntries(
  turn: Turn,
  needsInputAnchorMessageIds: ReadonlySet<string>,
  excludedMessageIds: ReadonlySet<string>,
): Array<{ entry: Extract<FeedEntry, { kind: "message" }>; order: number }> {
  const seenMessageIds = new Set<string>();
  return presentationEntries(turn).flatMap((entry, order) => {
    if (entry.kind !== "message") return [];
    const messageId = entry.msg.id;
    // Decisions stay at their source after they are answered too: the user's
    // next message usually answers them and reads poorly without them.
    if (
      (!needsInputAnchorMessageIds.has(messageId) && !isBoardProposalMessage(entry.msg)) ||
      excludedMessageIds.has(messageId) ||
      seenMessageIds.has(messageId)
    ) {
      return [];
    }
    seenMessageIds.add(messageId);
    return [{ entry, order }];
  });
}

/** Published Markdown reports stay visible in a collapsed turn, so an
 *  answer that points at "the report above" still has it on screen. */
function sourceReportEntries(turn: Turn): Array<Extract<FeedEntry, { kind: "message" }>> {
  return presentationEntries(turn).filter(
    (entry): entry is Extract<FeedEntry, { kind: "message" }> =>
      entry.kind === "message" && entry.msg.metadata?.markdownReport != null,
  );
}

/** Whether the collapsed turn shows an answer, decision or report message of its own. */
export function readyThreadResponseTurnHasMessage(
  turn: Turn,
  presentation: ThreadResponsePresentation,
  needsInputAnchorMessageIds: ReadonlySet<string> = new Set(),
): boolean {
  return (
    presentation.currentResponses.some((item) => item.sourceTurnId === turn.id) ||
    sourceReportEntries(turn).length > 0 ||
    sourceDecisionEntries(turn, needsInputAnchorMessageIds, presentation.currentResponseMessageIds).length > 0
  );
}

export function readyThreadResponseTurnHasContent(
  turn: Turn,
  presentation: ThreadResponsePresentation,
  needsInputAnchorMessageIds: ReadonlySet<string> = new Set(),
): boolean {
  if (readyThreadResponseTurnHasMessage(turn, presentation, needsInputAnchorMessageIds)) return true;
  if (presentation.quizGroups.some((group) => group.hostTurnId === turn.id && group.questIds.length > 0)) return true;
  return false;
}

/** A card shown among a turn's entries at the time it happened, such as the Quest complete card. */
export interface TimedCard {
  node: ReactNode;
  at: number;
}

/** Index of the first entry written after `at`, or -1; entries without a time of their own never count. */
export function firstEntryAfter(entries: readonly FeedEntry[], at: number): number {
  return entries.findIndex((entry) => entry.kind === "message" && entry.msg.timestamp > at);
}

/** One row of a collapsed turn's card. */
export interface CollapsedTurnRow {
  /** Keyed by entry, so a message keeps its row whichever presentation lists it. */
  key: string;
  entry: FeedEntry;
  testId?: string;
  /** Overrides the standard row padding. */
  className?: string;
  /** Present when the row is the thread's current answer. */
  answer?: AnswerChrome;
}

/** The rows a collapsed turn shows while the thread's answer presentation applies to it. */
export function readyThreadResponseRows(
  turn: Turn,
  presentation: ThreadResponsePresentation,
  needsInputAnchorMessageIds: ReadonlySet<string>,
  unansweredMessageEntry: Extract<FeedEntry, { kind: "message" }> | null,
): { rows: CollapsedTurnRow[]; quizQuestIds: readonly string[] } {
  const responses = presentation.currentResponses.filter((item) => item.sourceTurnId === turn.id);
  const responseMessageIds = new Set(responses.map((item) => item.response.currentMessageId));
  const promptEntries = sourceDecisionEntries(turn, needsInputAnchorMessageIds, responseMessageIds);
  const quizGroup = presentation.quizGroups.find((group) => group.hostTurnId === turn.id);
  const ordered = [
    ...responses.map((item, responseOrder) => ({
      row: {
        key: `entry:${item.collapsedMessageEntry.msg.id}`,
        entry: item.collapsedMessageEntry,
        testId: "thread-response-current",
        answer: {
          message: item.collapsedMessageEntry.msg,
          messageCount: item.response.answerUserMessageIds.length,
          referencedMessages: item.referencedUserMessages,
        },
      },
      order: item.response.currentHistoryIndex,
      fallbackOrder: responseOrder,
    })),
    ...promptEntries.map(({ entry, order }) => ({
      row: {
        key: `entry:${entry.msg.id}`,
        // A pinned source keeps its prose and notification, while only this
        // turn's grouped directives move into the separate Quiz row below.
        entry:
          quizGroup &&
          entry.msg.role === "assistant" &&
          Number.isInteger(entry.msg.historyIndex) &&
          entry.msg.historyIndex! >= presentation.cutoverHistoryIndex
            ? collapsedResponseEntry(entry, (questId) => quizGroup.questIds.includes(questId))
            : entry,
        testId: "thread-response-needs-input-prompt",
      },
      order: Number.isInteger(entry.msg.historyIndex) ? entry.msg.historyIndex! : Number.MAX_SAFE_INTEGER,
      fallbackOrder: order,
    })),
    ...sourceReportEntries(turn).map((entry, order) => ({
      row: {
        key: `entry:${entry.msg.id}`,
        entry,
        testId: "thread-response-report",
      },
      // A report that arrived live has no history index until the next window sync.
      order: (entry.msg.historyIndex ?? -1) >= 0 ? entry.msg.historyIndex! : Number.MAX_SAFE_INTEGER,
      fallbackOrder: order,
    })),
  ].sort((left, right) => left.order - right.order || left.fallbackOrder - right.fallbackOrder);

  const rows: CollapsedTurnRow[] = ordered.map((item) => item.row);
  // An answer first in the card follows its turn's own message directly.
  const userMessageId = turn.userEntry?.kind === "message" ? turn.userEntry.msg.id : null;
  const first = rows[0];
  const firstResponse = responses.find((item) => `entry:${item.collapsedMessageEntry.msg.id}` === first?.key);
  if (
    first?.answer &&
    userMessageId &&
    firstResponse?.response.referencedUserMessageIds.length === 1 &&
    firstResponse.response.referencedUserMessageIds[0] === userMessageId
  ) {
    first.answer = { ...first.answer, answersMessageAbove: true };
  }
  if (unansweredMessageEntry) {
    rows.push({
      key: `entry:${unansweredMessageEntry.msg.id}`,
      entry: unansweredMessageEntry,
      testId: "thread-response-unanswered-message",
    });
  }
  return { rows, quizQuestIds: quizGroup?.questIds ?? [] };
}

/**
 * Renders a collapsed turn's rows. Every presentation of a collapsed turn goes
 * through this one list with entry-based keys and the same row tree: the thread's
 * answer presentation drops out briefly whenever a message is sent, and a different
 * tree would remount every earlier answer and reload its images.
 */
export function CollapsedTurnRows({
  rows,
  quizQuestIds,
  renderEntry,
  sessionId,
  currentThreadKey,
  onSelectThread,
  questLinkSurface,
  timedCard = null,
}: {
  rows: readonly CollapsedTurnRow[];
  quizQuestIds: readonly string[];
  renderEntry: (entry: FeedEntry) => ReactNode;
  sessionId: string;
  currentThreadKey?: string;
  onSelectThread?: (threadKey: string) => void;
  questLinkSurface: QuestLinkSurface;
  /** Placed before the first row written after its time, else after the rows. */
  timedCard?: TimedCard | null;
}) {
  const seenKeys = new Set<string>();
  const cardIndex = timedCard
    ? firstEntryAfter(
        rows.map((row) => row.entry),
        timedCard.at,
      )
    : -1;
  const card = timedCard && (
    <div key="timed-card" className="min-w-0 px-2.5 py-2 empty:hidden sm:px-3" data-testid="collapsed-turn-timed-card">
      {timedCard.node}
    </div>
  );
  const renderRow = (row: CollapsedTurnRow, index: number) => {
    if (seenKeys.has(row.key)) return null;
    seenKeys.add(row.key);
    const content = renderEntry(row.entry);
    // Answers sharing a card can be hours apart; a rule keeps each one its own message.
    const separation = index > 0 && row.answer ? " border-t border-cc-border/50" : "";
    return (
      <div
        key={row.key}
        className={`${row.className ?? "min-w-0 px-2.5 py-2 sm:px-3"}${separation}`}
        data-testid={row.testId}
      >
        <HidePawContext.Provider value={true}>
          <AnsweredMessage
            answer={row.answer ?? null}
            currentThreadKey={currentThreadKey}
            onSelectThread={onSelectThread}
          >
            {content}
          </AnsweredMessage>
        </HidePawContext.Provider>
      </div>
    );
  };
  // One flat keyed list: a row the card moves next to keeps its element (and loaded images).
  const items: ReactNode[] = [];
  rows.forEach((row, index) => {
    if (index === cardIndex) items.push(card);
    items.push(renderRow(row, index));
  });
  if (cardIndex === -1) items.push(card);
  return (
    <>
      {items}
      {quizQuestIds.length > 0 && (
        <div className="min-w-0 px-2.5 pb-2 sm:px-3" data-testid="thread-response-quiz">
          <AssistantQuestQuizContent
            text={quizQuestIds.map((questId) => `{[(Quest Quiz: ${questId})]}`).join("\n")}
            sessionId={sessionId}
            questLinkSurface={questLinkSurface}
          />
        </div>
      )}
    </>
  );
}

export function ReadyThreadResponseRows({
  turn,
  presentation,
  renderEntry,
  sessionId,
  currentThreadKey,
  onSelectThread,
  questLinkSurface,
  needsInputAnchorMessageIds = new Set(),
  unansweredMessageEntry = null,
  timedCard = null,
}: {
  turn: Turn;
  presentation: ThreadResponsePresentation;
  renderEntry: (entry: FeedEntry) => ReactNode;
  sessionId: string;
  currentThreadKey?: string;
  onSelectThread?: (threadKey: string) => void;
  questLinkSurface: QuestLinkSurface;
  needsInputAnchorMessageIds?: ReadonlySet<string>;
  /** Shown only when the turn has no answer or decision row of its own. */
  unansweredMessageEntry?: Extract<FeedEntry, { kind: "message" }> | null;
  timedCard?: TimedCard | null;
}) {
  const { rows, quizQuestIds } = readyThreadResponseRows(
    turn,
    presentation,
    needsInputAnchorMessageIds,
    unansweredMessageEntry,
  );
  return (
    <CollapsedTurnRows
      rows={rows}
      quizQuestIds={quizQuestIds}
      renderEntry={renderEntry}
      sessionId={sessionId}
      currentThreadKey={currentThreadKey}
      onSelectThread={onSelectThread}
      questLinkSurface={questLinkSurface}
      timedCard={timedCard}
    />
  );
}
