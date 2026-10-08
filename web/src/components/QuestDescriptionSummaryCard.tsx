import type { ReactNode } from "react";
import type { QuestLinkSurface } from "./quest-link-surface.js";
import { QuestSummaryCard, useQuestRecord } from "./QuestSummaryCard.js";

const EXCERPT_CHARS = 280;

/**
 * Compact card that opens a leader quest thread with what the quest is about: the
 * description TLDR, expandable to the full description. Quests without a TLDR show
 * an excerpt of the description instead. It follows the current server quest record,
 * so description edits and refinements show up. Renders `fallback` (nothing by
 * default) until the record loads, and for a quest with neither TLDR nor description.
 */
export function QuestDescriptionSummaryCard({
  questId,
  sessionId,
  questLinkSurface,
  fallback = null,
}: {
  questId: string;
  sessionId?: string;
  questLinkSurface: QuestLinkSurface;
  fallback?: ReactNode;
}) {
  const quest = useQuestRecord(questId);
  if (!quest) return fallback;
  const description = quest.description?.trim() ?? "";
  const summary = quest.tldr?.trim() || descriptionExcerpt(description);
  if (!summary) return fallback;

  return (
    <QuestSummaryCard
      quest={quest}
      label="Quest"
      labelClassName="text-cc-primary"
      summary={summary}
      fullText={description}
      expandLabel="Show full description"
      testId="quest-description-summary"
      className="ml-9"
      sessionId={sessionId}
      questLinkSurface={questLinkSurface}
    />
  );
}

/** First prose paragraph of a description, skipping headings, shortened at a word boundary. */
function descriptionExcerpt(description: string): string {
  const paragraph =
    description
      .split(/\n\s*\n/)
      .map((block) =>
        block
          .split("\n")
          .filter((line) => !/^\s*#{1,6}\s/.test(line))
          .join("\n")
          .trim(),
      )
      .find(Boolean) ?? "";
  if (paragraph.length <= EXCERPT_CHARS) return paragraph;
  const cut = paragraph.lastIndexOf(" ", EXCERPT_CHARS);
  return `${paragraph.slice(0, cut > 0 ? cut : EXCERPT_CHARS).trimEnd()}…`;
}
