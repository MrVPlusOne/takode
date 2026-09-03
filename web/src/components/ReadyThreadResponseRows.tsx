import type { ReactNode } from "react";
import type { FeedEntry, Turn } from "../hooks/use-feed-model.js";
import type { QuestLinkSurface } from "./quest-link-surface.js";
import { AssistantQuestQuizContent } from "./AssistantQuestQuizContent.js";
import { HidePawContext } from "./PawTrail.js";
import type { ThreadResponsePresentation } from "./thread-response-presentation.js";
import { ThreadResponseCoverageBadge } from "./ThreadResponsePresentationChrome.js";

export function readyThreadResponseTurnHasContent(turn: Turn, presentation: ThreadResponsePresentation): boolean {
  if (presentation.currentResponses.some((item) => item.anchorTurnId === turn.id)) return true;
  if (presentation.quizGroups.some((group) => group.hostTurnId === turn.id && group.questIds.length > 0)) return true;
  return false;
}

export function ReadyThreadResponseRows({
  turn,
  presentation,
  renderEntry,
  sessionId,
  questLinkSurface,
}: {
  turn: Turn;
  presentation: ThreadResponsePresentation;
  renderEntry: (entry: FeedEntry) => ReactNode;
  sessionId: string;
  questLinkSurface: QuestLinkSurface;
}) {
  const responses = presentation.currentResponses.filter((item) => item.anchorTurnId === turn.id);
  const quizGroup = presentation.quizGroups.find((group) => group.hostTurnId === turn.id);

  return (
    <>
      {responses.map((item) => (
        <div
          key={item.response.currentMessageId}
          className="min-w-0 px-2.5 py-2 sm:px-3"
          data-testid="thread-response-current"
        >
          <ThreadResponseCoverageBadge messageCount={item.response.coveredUserMessageIds.length} className="mb-1.5" />
          <HidePawContext.Provider value={true}>{renderEntry(item.collapsedMessageEntry)}</HidePawContext.Provider>
        </div>
      ))}
      {quizGroup && quizGroup.questIds.length > 0 && (
        <div className="min-w-0 px-2.5 pb-2 sm:px-3" data-testid="thread-response-quiz">
          <AssistantQuestQuizContent
            text={quizGroup.questIds.map((questId) => `{[(Quest Quiz: ${questId})]}`).join("\n")}
            sessionId={sessionId}
            questLinkSurface={questLinkSurface}
          />
        </div>
      )}
    </>
  );
}
