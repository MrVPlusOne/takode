import type { ReactNode } from "react";
import type { FeedEntry, Turn } from "../hooks/use-feed-model.js";
import type { QuestLinkSurface } from "./quest-link-surface.js";
import { AssistantQuestQuizContent } from "./AssistantQuestQuizContent.js";
import { HidePawContext } from "./PawTrail.js";
import type { ThreadResponsePresentation } from "./thread-response-presentation.js";
import { CollapsedActivityBar } from "./TurnActivitySummary.js";

export function readyThreadResponseTurnHasContent(turn: Turn, presentation: ThreadResponsePresentation): boolean {
  if (presentation.currentResponses.some((item) => item.anchorTurnId === turn.id)) return true;
  if (presentation.quizHostTurnId === turn.id && presentation.quizQuestIds.length > 0) return true;
  return (
    turn.systemEntries.length > 0 ||
    (turn.presentationEntries ?? turn.allEntries).some(
      (entry) => !(entry.kind === "message" && presentation.currentResponseMessageIds.has(entry.msg.id)),
    )
  );
}

export function ReadyThreadResponseRows({
  turn,
  presentation,
  durationMs,
  onExpand,
  renderEntry,
  sessionId,
  questLinkSurface,
}: {
  turn: Turn;
  presentation: ThreadResponsePresentation;
  durationMs: number | null;
  onExpand: () => void;
  renderEntry: (entry: FeedEntry) => ReactNode;
  sessionId: string;
  questLinkSurface: QuestLinkSurface;
}) {
  const responses = presentation.currentResponses.filter((item) => item.anchorTurnId === turn.id);
  const hasHiddenActivity =
    turn.systemEntries.length > 0 ||
    (turn.presentationEntries ?? turn.allEntries).some(
      (entry) => !(entry.kind === "message" && presentation.currentResponseMessageIds.has(entry.msg.id)),
    );
  const showQuiz = presentation.quizHostTurnId === turn.id && presentation.quizQuestIds.length > 0;

  return (
    <>
      {hasHiddenActivity && (
        <CollapsedActivityBar stats={turn.stats} durationMs={durationMs} leaderMode onClick={onExpand} />
      )}
      {responses.map((item) => (
        <div
          key={item.response.logicalResponseId}
          className="min-w-0 px-2.5 py-2 sm:px-3"
          data-testid="thread-response-current"
        >
          {item.response.coveredUserMessageIds.length > 1 && (
            <div
              className="mb-1.5 inline-flex max-w-full items-center rounded-full border border-cc-primary/25 bg-cc-primary/10 px-2 py-0.5 text-[10px] font-medium text-cc-primary"
              data-testid="thread-response-group-provenance"
            >
              Answers {item.response.coveredUserMessageIds.length} messages
            </div>
          )}
          <HidePawContext.Provider value={true}>{renderEntry(item.collapsedMessageEntry)}</HidePawContext.Provider>
        </div>
      ))}
      {showQuiz && (
        <div className="min-w-0 px-2.5 pb-2 sm:px-3" data-testid="thread-response-quiz">
          <AssistantQuestQuizContent
            text={presentation.quizQuestIds.map((questId) => `{[(Quest Quiz: ${questId})]}`).join("\n")}
            sessionId={sessionId}
            questLinkSurface={questLinkSurface}
          />
        </div>
      )}
    </>
  );
}
