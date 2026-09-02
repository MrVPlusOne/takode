import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { FeedSection } from "./message-feed-sections.js";
import type { ChatMessage, QuestOutcomeRevision, QuestmasterTask } from "../types.js";
import { placeQuestOutcomeInFeed } from "../utils/quest-outcome-feed-placement.js";
import { useQuestDetailRecord } from "./useQuestDetailRecord.js";
import { QuestOutcomeCard } from "./QuestOutcomeCard.js";

export interface QuestOutcomeTurnPresentation {
  node: ReactNode;
  insertBeforeTurnId?: string;
  insertAfterUserTurnId?: string;
  insertWithinTurn?: { turnId: string; afterMessageId: string };
  insertAtEnd?: boolean;
  coveredTurnIds: ReadonlySet<string>;
  hideCoveredTurns: boolean;
  suppressQuizQuestId?: string;
}

function displayedRevision(quest: QuestmasterTask | null | undefined): QuestOutcomeRevision | null {
  const outcome = quest?.outcome;
  if (!quest || !outcome || (quest.status === "done" && quest.cancelled === true)) return null;
  if (quest.status === "done" && outcome.finalizedRevisionId !== outcome.currentRevisionId) return null;
  return outcome.revisions.find((revision) => revision.revisionId === outcome.currentRevisionId) ?? null;
}

function turnContainsMessageId(section: FeedSection, turnId: string, messageId: string): boolean {
  const turn = section.turns.find((candidate) => candidate.id === turnId);
  if (!turn) return false;
  if (turn.userEntry?.kind === "message" && turn.userEntry.msg.id === messageId) return true;
  return turn.allEntries.some((entry) => entry.kind === "message" && entry.msg.id === messageId);
}

function targetIsCovered(
  sections: FeedSection[],
  coveredTurnIds: ReadonlySet<string>,
  messageId: string | null | undefined,
): boolean {
  if (!messageId) return false;
  for (const section of sections) {
    for (const turnId of coveredTurnIds) {
      if (turnContainsMessageId(section, turnId, messageId)) return true;
    }
  }
  return false;
}

function placementSignature(placement: ReturnType<typeof placeQuestOutcomeInFeed>, historyExpanded: boolean): string {
  const location =
    placement.kind === "before-turn"
      ? `before:${placement.turnId}`
      : placement.kind === "after-user"
        ? `after-user:${placement.turnId}`
        : placement.kind === "within-turn"
          ? `within:${placement.turnId}:${placement.afterMessageId}`
          : placement.kind;
  return `${location}:${historyExpanded ? "expanded" : "collapsed"}`;
}

export function useQuestOutcomeFeedPresentation(input: {
  questId?: string;
  sessionId: string;
  sections: FeedSection[];
  messages: ChatMessage[];
  hasNewerItems: boolean;
  scrollTargetMessageIds: Array<string | null | undefined>;
}): {
  presentation?: QuestOutcomeTurnPresentation;
  hideOlderControl: boolean;
  layoutSignature: string;
} {
  const { quest } = useQuestDetailRecord(input.questId ?? null);
  const outcome = quest?.outcome;
  const revision = displayedRevision(quest);
  const completed = quest?.status === "done" && quest.cancelled !== true;
  const placement = useMemo(
    () =>
      revision
        ? placeQuestOutcomeInFeed({
            sections: input.sections,
            anchor: revision.anchor,
            sessionId: input.sessionId,
            hasNewerItems: input.hasNewerItems,
            ...(completed && quest ? { completedAt: quest.completedAt } : {}),
          })
        : null,
    [completed, input.hasNewerItems, input.sections, input.sessionId, quest, revision],
  );
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const targetRequiresHistory = Boolean(
    completed &&
      placement &&
      input.scrollTargetMessageIds.some((messageId) =>
        targetIsCovered(input.sections, placement.coveredTurnIds, messageId),
      ),
  );
  const effectiveHistoryExpanded = historyExpanded || targetRequiresHistory;

  useEffect(() => setHistoryExpanded(false), [input.questId, revision?.revisionId]);
  useEffect(() => {
    if (targetRequiresHistory) setHistoryExpanded(true);
  }, [targetRequiresHistory]);

  if (!quest || !outcome || !revision || !placement || placement.kind === "hidden") {
    return { hideOlderControl: false, layoutSignature: "none" };
  }

  const coveredTurnCount = placement.coveredTurnIds.size;
  const hideCoveredTurns = completed && coveredTurnCount > 0 && !effectiveHistoryExpanded;
  const hasQuiz = completed && (quest.quizItems?.length ?? 0) > 0;
  const newerActivityBelow = placement.newerTurnIds.size > 0 || input.hasNewerItems;
  const historyToggle = completed && coveredTurnCount > 0 && (
    <button
      type="button"
      onClick={() => setHistoryExpanded((value) => !value)}
      className="mb-3 inline-flex w-full items-center justify-between gap-3 rounded-lg border border-cc-border bg-cc-hover/25 px-3 py-2 text-xs font-medium text-cc-muted transition-colors hover:border-cc-primary/30 hover:bg-cc-hover/50 hover:text-cc-fg sm:mb-5"
      aria-expanded={effectiveHistoryExpanded}
      data-testid="quest-outcome-history-toggle"
    >
      <span>{effectiveHistoryExpanded ? "Hide covered history" : "Show covered history"}</span>
      <span className="font-mono-code text-[10px]">Loaded history</span>
    </button>
  );
  const node = (
    <div key={`quest-outcome:${quest.questId}`} data-testid="quest-outcome-feed-interstitial">
      {historyToggle}
      <QuestOutcomeCard
        questId={quest.questId}
        questTitle={quest.title}
        questStatus={quest.status}
        outcome={outcome}
        sessionId={input.sessionId}
        newerActivityBelow={newerActivityBelow}
        showQuiz={hasQuiz}
        quizItems={quest.quizItems}
      />
    </div>
  );

  return {
    presentation: {
      node,
      ...(placement.kind === "before-turn"
        ? { insertBeforeTurnId: placement.turnId }
        : placement.kind === "after-user"
          ? { insertAfterUserTurnId: placement.turnId }
          : placement.kind === "within-turn"
            ? { insertWithinTurn: { turnId: placement.turnId, afterMessageId: placement.afterMessageId } }
            : { insertAtEnd: true }),
      coveredTurnIds: placement.coveredTurnIds,
      hideCoveredTurns,
      ...(hasQuiz ? { suppressQuizQuestId: quest.questId.toLowerCase() } : {}),
    },
    hideOlderControl: hideCoveredTurns,
    layoutSignature: `${revision.revisionId}:${placementSignature(placement, effectiveHistoryExpanded)}:${hideCoveredTurns ? "hidden" : "shown"}:${newerActivityBelow ? "newer" : "current"}`,
  };
}
