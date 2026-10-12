import type { QuestListPreview, QuestRelatedQuest, QuestRelatedQuestKind, QuestmasterTask } from "../types.js";
import { useId, useState } from "react";
import { QuestDisclosureChip, QUEST_CHIP_CLASS } from "./QuestDisclosureChip.js";
import { QuestInlineLink } from "./QuestInlineLink.js";

type DisplayedQuestRelationshipKind = Exclude<QuestRelatedQuestKind, "references">;

const RELATIONSHIP_LABELS: Record<DisplayedQuestRelationshipKind, string> = {
  follow_up_of: "Follow-up of",
  has_follow_up: "Has follow-up",
  referenced_by: "Referenced by",
};

const RELATIONSHIP_ORDER: DisplayedQuestRelationshipKind[] = ["follow_up_of", "has_follow_up", "referenced_by"];

export function QuestRelationshipLinks({
  quest,
  variant = "detail",
}: {
  quest: QuestmasterTask | QuestListPreview;
  variant?: "detail" | "inline";
}) {
  const groups = groupRelatedQuests(quest.relatedQuests ?? []);
  if (groups.length === 0) return null;

  if (variant === "inline") {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-cc-muted">
        {groups.map(([kind, entries]) => (
          <span key={kind} className="inline-flex min-w-0 items-center gap-1">
            <span className="text-cc-muted/70">{RELATIONSHIP_LABELS[kind]}</span>
            {entries.map((entry) => (
              <RelatedQuestLink key={entry.questId} entry={entry} />
            ))}
          </span>
        ))}
      </div>
    );
  }

  return <QuestRelationshipChip groups={groups} />;
}

/**
 * The quest view's single related-quests chip. One related quest is shown directly; more collapse
 * into one counted chip whose list opens on its own line below the parent's wrapping chip row.
 */
function QuestRelationshipChip({ groups }: { groups: Array<[DisplayedQuestRelationshipKind, QuestRelatedQuest[]]> }) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const total = groups.reduce((count, [, entries]) => count + entries.length, 0);
  if (total === 1) {
    const [kind, [entry]] = groups[0];
    return (
      <span className={QUEST_CHIP_CLASS} data-testid="quest-relationships">
        <span>{RELATIONSHIP_LABELS[kind]}</span>
        <RelatedQuestLink entry={entry} />
      </span>
    );
  }
  const label = groups.length === 1 ? `${RELATIONSHIP_LABELS[groups[0][0]]} ${total}` : `${total} related quests`;
  return (
    <>
      <QuestDisclosureChip
        expanded={expanded}
        controls={listId}
        onToggle={() => setExpanded((value) => !value)}
        ariaLabel={`${expanded ? "Collapse" : "Expand"} related quests, ${total}`}
      >
        {label}
      </QuestDisclosureChip>
      {expanded && (
        <div
          id={listId}
          role="region"
          aria-label="Related quests"
          data-testid="quest-relationships"
          className="order-last basis-full space-y-1 rounded-md border border-cc-border bg-cc-hover/40 px-2 py-1.5 text-[11px] text-cc-muted"
        >
          {groups.map(([kind, entries]) => (
            <div key={kind} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span>{RELATIONSHIP_LABELS[kind]}</span>
              {entries.map((entry) => (
                <RelatedQuestLink key={entry.questId} entry={entry} />
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function RelatedQuestLink({ entry }: { entry: QuestRelatedQuest }) {
  return (
    <QuestInlineLink
      questId={entry.questId}
      className="font-mono-code text-cc-primary hover:underline"
      stopPropagation
    />
  );
}

function groupRelatedQuests(
  relatedQuests: QuestRelatedQuest[],
): Array<[DisplayedQuestRelationshipKind, QuestRelatedQuest[]]> {
  return RELATIONSHIP_ORDER.map((kind) => [kind, relatedQuests.filter((entry) => entry.kind === kind)]).filter(
    (entry): entry is [DisplayedQuestRelationshipKind, QuestRelatedQuest[]] => entry[1].length > 0,
  );
}
