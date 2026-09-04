import type { ReactNode } from "react";
import type { FeedEntry, Turn } from "../hooks/use-feed-model.js";
import type { QuestLinkSurface } from "./quest-link-surface.js";
import { AssistantQuestQuizContent } from "./AssistantQuestQuizContent.js";
import { HidePawContext } from "./PawTrail.js";
import type { ThreadResponsePresentation } from "./thread-response-presentation.js";
import { ThreadResponseCoverageBadge } from "./ThreadResponsePresentationChrome.js";

function presentationEntries(turn: Turn): readonly FeedEntry[] {
  return turn.presentationEntries ?? turn.allEntries;
}

function unresolvedNeedsInputPromptEntries(
  turn: Turn,
  activeNeedsInputAnchorMessageIds: ReadonlySet<string>,
  excludedMessageIds: ReadonlySet<string>,
): Array<{ entry: Extract<FeedEntry, { kind: "message" }>; order: number }> {
  const seenMessageIds = new Set<string>();
  return presentationEntries(turn).flatMap((entry, order) => {
    if (entry.kind !== "message") return [];
    const messageId = entry.msg.id;
    if (
      !activeNeedsInputAnchorMessageIds.has(messageId) ||
      excludedMessageIds.has(messageId) ||
      seenMessageIds.has(messageId)
    ) {
      return [];
    }
    seenMessageIds.add(messageId);
    return [{ entry, order }];
  });
}

export function readyThreadResponseTurnHasContent(
  turn: Turn,
  presentation: ThreadResponsePresentation,
  activeNeedsInputAnchorMessageIds: ReadonlySet<string> = new Set(),
): boolean {
  if (presentation.currentResponses.some((item) => item.anchorTurnId === turn.id)) return true;
  if (
    unresolvedNeedsInputPromptEntries(turn, activeNeedsInputAnchorMessageIds, presentation.currentResponseMessageIds)
      .length > 0
  ) {
    return true;
  }
  if (presentation.quizGroups.some((group) => group.hostTurnId === turn.id && group.questIds.length > 0)) return true;
  return false;
}

export function ReadyThreadResponseRows({
  turn,
  presentation,
  renderEntry,
  sessionId,
  questLinkSurface,
  activeNeedsInputAnchorMessageIds = new Set(),
}: {
  turn: Turn;
  presentation: ThreadResponsePresentation;
  renderEntry: (entry: FeedEntry) => ReactNode;
  sessionId: string;
  questLinkSurface: QuestLinkSurface;
  activeNeedsInputAnchorMessageIds?: ReadonlySet<string>;
}) {
  const responses = presentation.currentResponses.filter((item) => item.anchorTurnId === turn.id);
  const responseMessageIds = new Set(responses.map((item) => item.response.currentMessageId));
  const sourceOrderByMessageId = new Map<string, number>();
  presentationEntries(turn).forEach((entry, order) => {
    if (entry.kind === "message" && !sourceOrderByMessageId.has(entry.msg.id)) {
      sourceOrderByMessageId.set(entry.msg.id, order);
    }
  });
  const promptEntries = unresolvedNeedsInputPromptEntries(turn, activeNeedsInputAnchorMessageIds, responseMessageIds);
  const rows = [
    ...responses.map((item, responseOrder) => ({
      kind: "response" as const,
      item,
      order: sourceOrderByMessageId.get(item.response.currentMessageId) ?? Number.MAX_SAFE_INTEGER,
      fallbackOrder: item.response.currentHistoryIndex * 2 + responseOrder,
    })),
    ...promptEntries.map(({ entry, order }) => ({
      kind: "prompt" as const,
      entry,
      order,
      fallbackOrder: Number.MAX_SAFE_INTEGER,
    })),
  ].sort((left, right) => left.order - right.order || left.fallbackOrder - right.fallbackOrder);
  const quizGroup = presentation.quizGroups.find((group) => group.hostTurnId === turn.id);

  return (
    <>
      {rows.map((row) =>
        row.kind === "response" ? (
          <div
            key={row.item.response.currentMessageId}
            className="min-w-0 px-2.5 py-2 sm:px-3"
            data-testid="thread-response-current"
          >
            <ThreadResponseCoverageBadge
              messageCount={row.item.response.coveredUserMessageIds.length}
              referencedMessages={row.item.coveredUserMessages}
              className="mb-1.5"
            />
            <HidePawContext.Provider value={true}>
              {renderEntry(row.item.collapsedMessageEntry)}
            </HidePawContext.Provider>
          </div>
        ) : (
          <div
            key={`needs-input-prompt:${row.entry.msg.id}`}
            className="min-w-0 px-2.5 py-2 sm:px-3"
            data-testid="thread-response-needs-input-prompt"
          >
            <HidePawContext.Provider value={true}>{renderEntry(row.entry)}</HidePawContext.Provider>
          </div>
        ),
      )}
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
