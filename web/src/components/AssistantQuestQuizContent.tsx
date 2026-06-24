import { useMemo } from "react";
import { useStore } from "../store.js";
import type { QuestmasterTask } from "../types.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { QuestQuizSection } from "./QuestQuizSection.js";

const QUEST_QUIZ_DIRECTIVE_RE = /^\s*\{\[\(Quest Quiz:\s*(q-\d+)\)\]\}\s*$/i;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

export type AssistantQuestQuizSegment = { kind: "text"; text: string } | { kind: "quiz"; questId: string };

interface AssistantQuestQuizContentProps {
  text: string;
  sessionId?: string;
  searchHighlight?: { query: string; mode: "strict" | "fuzzy"; isCurrent: boolean } | null;
  enableChatSelectionMenu?: boolean;
}

export function stripQuestQuizMarkers(text: string): string {
  return parseQuestQuizContentSegments(text)
    .filter((segment): segment is Extract<AssistantQuestQuizSegment, { kind: "text" }> => segment.kind === "text")
    .map((segment) => segment.text)
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function extractQuestQuizMarkerIds(text: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const segment of parseQuestQuizContentSegments(text)) {
    if (segment.kind !== "quiz" || seen.has(segment.questId)) continue;
    seen.add(segment.questId);
    ids.push(segment.questId);
  }
  return ids;
}

function normalizeQuestQuizText(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

function readFence(line: string): { marker: "`" | "~"; length: number } | null {
  const match = line.match(FENCE_RE);
  if (!match) return null;
  const token = match[1];
  return { marker: token[0] as "`" | "~", length: token.length };
}

export function parseQuestQuizContentSegments(text: string): AssistantQuestQuizSegment[] {
  const segments: AssistantQuestQuizSegment[] = [];
  const textLines: string[] = [];
  let fence: { marker: "`" | "~"; length: number } | null = null;

  const flushText = () => {
    const visibleText = normalizeQuestQuizText(textLines.join("\n"));
    textLines.length = 0;
    if (visibleText) segments.push({ kind: "text", text: visibleText });
  };

  for (const line of text.split(/\r?\n/)) {
    if (fence) {
      textLines.push(line);
      const closingFence = readFence(line);
      if (closingFence && closingFence.marker === fence.marker && closingFence.length >= fence.length) {
        fence = null;
      }
      continue;
    }

    const openingFence = readFence(line);
    if (openingFence) {
      fence = openingFence;
      textLines.push(line);
      continue;
    }

    const directive = line.match(QUEST_QUIZ_DIRECTIVE_RE);
    if (directive) {
      flushText();
      segments.push({ kind: "quiz", questId: directive[1].toLowerCase() });
      continue;
    }

    textLines.push(line);
  }

  flushText();
  return segments;
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
  const segments = useMemo(() => parseQuestQuizContentSegments(text), [text]);
  const quests = useStore((state) => state.quests);

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === "text") {
          return (
            <MarkdownContent
              key={`text-${index}`}
              text={segment.text}
              sessionId={sessionId}
              searchHighlight={searchHighlight}
              enableChatSelectionMenu={enableChatSelectionMenu}
            />
          );
        }

        const quest = findQuest(quests, segment.questId);
        if (!quest || (quest.quizItems?.length ?? 0) === 0) return null;
        return (
          <QuestQuizSection
            key={`quiz-${segment.questId}-${index}`}
            items={quest.quizItems}
            questId={quest.questId}
            questTitle={quest.title}
            variant="inline"
            sessionId={sessionId}
          />
        );
      })}
    </>
  );
}
