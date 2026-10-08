import { createContext } from "react";
import type { QuestLinkSurface } from "./quest-link-surface.js";
import { QuestSummaryCard, useQuestRecord } from "./QuestSummaryCard.js";

/**
 * Quest whose completion summary belongs above its Quiz in the current turn.
 * Only the leader quest thread's completion host turn provides a value, so
 * Quizzes elsewhere (worker feeds, Main, Playground) render unchanged.
 */
export const QuestCompletionSummaryContext = createContext<string | null>(null);

/**
 * Compact "Quest complete" card showing the quest's final debrief TLDR, expandable to
 * the full debrief. It follows the current server quest record, so a reopened quest
 * hides the card and a recompleted quest shows its current debrief. Renders nothing
 * until the quest is done, when cancelled, or when no debrief was recorded.
 */
export function QuestCompletionSummaryCard({
  questId,
  sessionId,
  questLinkSurface,
}: {
  questId: string;
  sessionId?: string;
  questLinkSurface: QuestLinkSurface;
}) {
  const quest = useQuestRecord(questId);
  if (!quest || quest.status !== "done" || quest.cancelled) return null;
  const debrief = quest.debrief?.trim() ?? "";
  const tldr = quest.debriefTldr?.trim() ?? "";
  if (!tldr && !debrief) return null;

  return (
    <QuestSummaryCard
      quest={quest}
      label="Quest complete"
      labelClassName="text-cc-success"
      summary={tldr || debrief}
      fullText={debrief}
      expandLabel="Show full debrief"
      testId="quest-completion-summary"
      className="mt-3"
      sessionId={sessionId}
      questLinkSurface={questLinkSurface}
    />
  );
}
