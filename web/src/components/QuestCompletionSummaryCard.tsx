import { createContext, useContext, useEffect, useState } from "react";
import { fetchSupportingQuestAnswer, type SupportingQuestAnswer } from "../api/started-quests.js";
import type { QuestmasterTask } from "../types.js";
import type { QuestLinkSurface } from "./quest-link-surface.js";
import { ThreadMessageLink } from "./QuestForkLinks.js";
import { QuestRecordFetchContext, QuestSummaryCard, useQuestRecord } from "./QuestSummaryCard.js";

/** Supporting quests' delivering answers by quest ID, instead of loading them; the Playground provides these. */
export const SupportingQuestAnswerContext = createContext<ReadonlyMap<string, SupportingQuestAnswer> | null>(null);

/**
 * Compact "Quest complete" card showing the quest's final debrief TLDR, expandable to
 * the full debrief. It follows the current server quest record, so a reopened quest
 * hides the card and a recompleted quest shows its current debrief. Renders nothing
 * until the quest is done, when cancelled, or when no debrief was recorded.
 *
 * A supporting quest's result was answered where the user asked, so its card leads with
 * that answer ("Answered in <thread>") and keeps the debrief behind the toggle.
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
  const answer = useSupportingQuestAnswer(quest, sessionId);
  if (!quest || quest.status !== "done" || quest.cancelled) return null;
  const debrief = quest.debrief?.trim() ?? "";
  const tldr = quest.debriefTldr?.trim() ?? "";
  if (!tldr && !debrief && !answer) return null;

  return (
    <QuestSummaryCard
      quest={quest}
      label="Quest complete"
      labelClassName="text-cc-success"
      summary={answer ? answer.markdown : tldr || debrief}
      fullText={answer ? (debrief || tldr ? `${answer.markdown}\n\n---\n\n${debrief || tldr}` : "") : debrief}
      expandLabel={answer ? "Show debrief" : "Show full debrief"}
      testId="quest-completion-summary"
      sessionId={sessionId}
      questLinkSurface={questLinkSurface}
      detail={
        answer && sessionId ? (
          <ThreadMessageLink
            lead="Answered in "
            target={{ ...answer, sessionId }}
            sessionId={sessionId}
            className="mt-0.5"
            testId="quest-completion-answered-in"
          />
        ) : undefined
      }
    />
  );
}

/** The answer that delivered a done supporting quest's result, loaded once per quest version. */
function useSupportingQuestAnswer(
  quest: QuestmasterTask | null,
  sessionId: string | undefined,
): SupportingQuestAnswer | null {
  const provided = useContext(SupportingQuestAnswerContext);
  const fetchEnabled = useContext(QuestRecordFetchContext);
  // Only quests filed from this leader's conversation can be supporting quests here.
  const key =
    quest && sessionId && quest.status === "done" && quest.relationships?.startedFrom?.sessionId === sessionId
      ? `${quest.questId}:${quest.version}`
      : null;
  const questId = quest?.questId;
  const [loaded, setLoaded] = useState<{ key: string; answer: SupportingQuestAnswer | null } | null>(null);
  useEffect(() => {
    if (!key || !questId || !sessionId || provided || !fetchEnabled) return;
    const controller = new AbortController();
    fetchSupportingQuestAnswer(sessionId, questId, controller.signal)
      .then((answer) => setLoaded({ key, answer }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) console.warn(`[quest-summary] ${questId} answer failed to load`, error);
      });
    return () => controller.abort();
  }, [key, questId, sessionId, provided, fetchEnabled]);
  if (!key || !quest) return null;
  if (provided) return provided.get(quest.questId) ?? null;
  return loaded?.key === key ? loaded.answer : null;
}
