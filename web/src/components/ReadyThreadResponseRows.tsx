import type { ReactNode } from "react";
import type { FeedEntry, Turn } from "../hooks/use-feed-model.js";
import type { QuestLinkSurface } from "./quest-link-surface.js";
import { AssistantQuestQuizContent } from "./AssistantQuestQuizContent.js";
import { HidePawContext } from "./PawTrail.js";
import { collapsedResponseEntry, type ThreadResponsePresentation } from "./thread-response-presentation.js";
import { AnsweredMessage, type AnswerChrome } from "./ThreadResponsePresentationChrome.js";
import { CollapsedReportPreview } from "./CollapsedReportPreview.js";
import { isBoardProposalMessage, isNeedsInputNotifyMessage } from "../utils/takode-tool-command.js";

function presentationEntries(turn: Turn): readonly FeedEntry[] {
  return turn.presentationEntries ?? turn.allEntries;
}

function sourceDecisionEntries(
  turn: Turn,
  activeNeedsInputAnchorMessageIds: ReadonlySet<string>,
  excludedMessageIds: ReadonlySet<string>,
): Array<{ entry: Extract<FeedEntry, { kind: "message" }>; order: number }> {
  const seenMessageIds = new Set<string>();
  return presentationEntries(turn).flatMap((entry, order) => {
    if (entry.kind !== "message") return [];
    const messageId = entry.msg.id;
    // Structured decisions stay at their original source even after resolution.
    // Ordinary resolved prose prompts still lose their active pin as before.
    const hasSourceDecision =
      isBoardProposalMessage(entry.msg) ||
      (entry.msg.notification?.category === "needs-input" && isNeedsInputNotifyMessage(entry.msg));
    if (
      (!activeNeedsInputAnchorMessageIds.has(messageId) && !hasSourceDecision) ||
      excludedMessageIds.has(messageId) ||
      seenMessageIds.has(messageId)
    ) {
      return [];
    }
    seenMessageIds.add(messageId);
    return [{ entry, order }];
  });
}

/** Published Markdown reports stay visible, clipped, in a collapsed turn, so an
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
  activeNeedsInputAnchorMessageIds: ReadonlySet<string> = new Set(),
): boolean {
  return (
    presentation.currentResponses.some((item) => item.sourceTurnId === turn.id) ||
    sourceReportEntries(turn).length > 0 ||
    sourceDecisionEntries(turn, activeNeedsInputAnchorMessageIds, presentation.currentResponseMessageIds).length > 0
  );
}

export function readyThreadResponseTurnHasContent(
  turn: Turn,
  presentation: ThreadResponsePresentation,
  activeNeedsInputAnchorMessageIds: ReadonlySet<string> = new Set(),
): boolean {
  if (readyThreadResponseTurnHasMessage(turn, presentation, activeNeedsInputAnchorMessageIds)) return true;
  if (presentation.quizGroups.some((group) => group.hostTurnId === turn.id && group.questIds.length > 0)) return true;
  return false;
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
  /** A published report, shown framed and clipped. */
  report?: boolean;
}

/** The rows a collapsed turn shows while the thread's answer presentation applies to it. */
export function readyThreadResponseRows(
  turn: Turn,
  presentation: ThreadResponsePresentation,
  activeNeedsInputAnchorMessageIds: ReadonlySet<string>,
  unansweredMessageEntry: Extract<FeedEntry, { kind: "message" }> | null,
): { rows: CollapsedTurnRow[]; quizQuestIds: readonly string[] } {
  const responses = presentation.currentResponses.filter((item) => item.sourceTurnId === turn.id);
  const responseMessageIds = new Set(responses.map((item) => item.response.currentMessageId));
  const promptEntries = sourceDecisionEntries(turn, activeNeedsInputAnchorMessageIds, responseMessageIds);
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
        report: true,
      },
      // A report that arrived live has no history index until the next window sync.
      order: (entry.msg.historyIndex ?? -1) >= 0 ? entry.msg.historyIndex! : Number.MAX_SAFE_INTEGER,
      fallbackOrder: order,
    })),
  ].sort((left, right) => left.order - right.order || left.fallbackOrder - right.fallbackOrder);

  const rows: CollapsedTurnRow[] = ordered.map((item) => item.row);
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
}: {
  rows: readonly CollapsedTurnRow[];
  quizQuestIds: readonly string[];
  renderEntry: (entry: FeedEntry) => ReactNode;
  sessionId: string;
  currentThreadKey?: string;
  onSelectThread?: (threadKey: string) => void;
  questLinkSurface: QuestLinkSurface;
}) {
  const seenKeys = new Set<string>();
  return (
    <>
      {rows.map((row) => {
        if (seenKeys.has(row.key)) return null;
        seenKeys.add(row.key);
        const content = renderEntry(row.entry);
        return (
          <div key={row.key} className={row.className ?? "min-w-0 px-2.5 py-2 sm:px-3"} data-testid={row.testId}>
            <HidePawContext.Provider value={true}>
              <AnsweredMessage
                answer={row.answer ?? null}
                currentThreadKey={currentThreadKey}
                onSelectThread={onSelectThread}
              >
                {row.report ? <CollapsedReportPreview>{content}</CollapsedReportPreview> : content}
              </AnsweredMessage>
            </HidePawContext.Provider>
          </div>
        );
      })}
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
  activeNeedsInputAnchorMessageIds = new Set(),
  unansweredMessageEntry = null,
}: {
  turn: Turn;
  presentation: ThreadResponsePresentation;
  renderEntry: (entry: FeedEntry) => ReactNode;
  sessionId: string;
  currentThreadKey?: string;
  onSelectThread?: (threadKey: string) => void;
  questLinkSurface: QuestLinkSurface;
  activeNeedsInputAnchorMessageIds?: ReadonlySet<string>;
  /** Shown only when the turn has no answer or decision row of its own. */
  unansweredMessageEntry?: Extract<FeedEntry, { kind: "message" }> | null;
}) {
  const { rows, quizQuestIds } = readyThreadResponseRows(
    turn,
    presentation,
    activeNeedsInputAnchorMessageIds,
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
    />
  );
}
