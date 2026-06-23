import { useMemo } from "react";
import { useStore } from "../store.js";
import type { QuestmasterTask } from "../types.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { QuestQuizSection } from "./QuestQuizSection.js";

function questQuizMarkerRe(): RegExp {
  return /(?:<!--\s*(?:takode:)?quest-quiz\s+(q-\d+)\s*-->|<!--\s*quest-quiz:(q-\d+)\s*-->)/gi;
}

interface AssistantQuestQuizContentProps {
  text: string;
  sessionId?: string;
  searchHighlight?: { query: string; mode: "strict" | "fuzzy"; isCurrent: boolean } | null;
  enableChatSelectionMenu?: boolean;
}

export function stripQuestQuizMarkers(text: string): string {
  return text
    .replace(questQuizMarkerRe(), "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractQuestQuizMarkerIds(text: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(questQuizMarkerRe())) {
    const id = (match[1] || match[2] || "").toLowerCase();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function findQuest(quests: QuestmasterTask[], questId: string): QuestmasterTask | null {
  return quests.find((quest) => quest.questId.toLowerCase() === questId.toLowerCase()) ?? null;
}

export function AssistantQuestQuizContent({
  text,
  sessionId,
  searchHighlight,
  enableChatSelectionMenu = false,
}: AssistantQuestQuizContentProps) {
  const markerQuestIds = useMemo(() => extractQuestQuizMarkerIds(text), [text]);
  const visibleText = useMemo(() => stripQuestQuizMarkers(text), [text]);
  const quests = useStore((state) => state.quests);
  const quizzes = useMemo(
    () =>
      markerQuestIds
        .map((questId) => findQuest(quests, questId))
        .filter((quest): quest is QuestmasterTask => !!quest && (quest.quizItems?.length ?? 0) > 0),
    [markerQuestIds, quests],
  );

  return (
    <>
      {visibleText && (
        <MarkdownContent
          text={visibleText}
          sessionId={sessionId}
          searchHighlight={searchHighlight}
          enableChatSelectionMenu={enableChatSelectionMenu}
        />
      )}
      {quizzes.map((quest) => (
        <QuestQuizSection
          key={quest.questId}
          items={quest.quizItems}
          questId={quest.questId}
          questTitle={quest.title}
          variant="inline"
          sessionId={sessionId}
        />
      ))}
    </>
  );
}
