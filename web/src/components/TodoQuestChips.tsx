import type { TodoLinkedQuest } from "../../shared/todo-types.js";
import { getQuestStatusTheme } from "../utils/quest-status-theme.js";
import { QuestInlineLink } from "./QuestInlineLink.js";

const EXTRA_STATUS_LABELS: Partial<Record<TodoLinkedQuest["status"], string>> = {
  cancelled: "Cancelled",
  missing: "Not found",
};

/**
 * Read-only chips for the quests a to-do links, each showing the quest's
 * current status and opening the quest when clicked. Status comes from the
 * server's linked-quest lookup; a quest it has not reported yet shows its ID only.
 */
export function TodoQuestChips({
  questIds,
  linkedQuests,
  className = "mt-1 flex",
}: {
  questIds: string[];
  linkedQuests: ReadonlyMap<string, TodoLinkedQuest>;
  className?: string;
}) {
  return (
    <div className={`flex-wrap gap-1 ${className}`} aria-label="Linked quests">
      {questIds.map((questId) => {
        const linked = linkedQuests.get(questId);
        const theme = linked ? getQuestStatusTheme(linked.status) : null;
        const label = linked ? (EXTRA_STATUS_LABELS[linked.status] ?? theme!.label) : null;
        return (
          <QuestInlineLink
            key={questId}
            questId={questId}
            stopPropagation
            className={`inline-flex max-w-full items-center gap-1 whitespace-nowrap rounded-full border px-1.5 py-px text-[10px] leading-4 hover:brightness-125 ${
              theme ? `${theme.border} ${theme.bg} ${theme.text}` : "border-cc-border text-cc-muted"
            }`}
          >
            {theme && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${theme.dot}`} aria-hidden="true" />}
            <span className="font-medium">{questId}</span>
            {label && <span className="opacity-80">{label}</span>}
          </QuestInlineLink>
        );
      })}
    </div>
  );
}
