import { createContext } from "react";
import type { Turn } from "../hooks/use-feed-model.js";
import { topicMemberOfMessage } from "../utils/thread-projection.js";
import { useQuestRecord } from "./QuestSummaryCard.js";

/**
 * A topic conversation: one feed stitching together the threads of a topic's quests, in time
 * order. Where the feed moves to another quest it shows that quest's strip, as part of the feed;
 * a strip scrolled to the top sticks there until the next quest's strip covers it, so the quest
 * being read is always named and several quests on screen each show their own strip.
 */
export interface TopicFeed {
  /** The topic's quests (their threads make the feed). */
  questIds: string[];
}

export const TopicFeedContext = createContext<TopicFeed | null>(null);

/**
 * The quest each turn belongs to: the first of the topic's quests its messages are routed to. A
 * turn routed to none of them (a tool result, a turn-closing result) continues the previous quest.
 */
export function topicQuestsOfTurns(turns: readonly Turn[], questIds: readonly string[]): Array<string | null> {
  let previous: string | null = null;
  return turns.map((turn) => {
    for (const entry of [turn.userEntry, ...turn.allEntries]) {
      if (entry?.kind !== "message") continue;
      const quest = topicMemberOfMessage(entry.msg, questIds);
      if (quest) {
        previous = quest;
        return quest;
      }
    }
    return previous;
  });
}

/** The strip naming `questId` where the conversation moves to it; tapping opens the quest's own tab. */
export function TopicFeedQuestStart({
  questId,
  onSelectThread,
}: {
  questId: string;
  onSelectThread?: (threadKey: string) => void;
}) {
  const quest = useQuestRecord(questId);
  const status = quest ? (quest.status === "done" ? "Done" : quest.status.replace("_", " ")) : "";
  // Sticky offsets are measured inside the feed's top padding (py-4, sm:py-6), so they cancel it.
  return (
    <div
      className="sticky -top-4 z-10 sm:-top-6 bg-cc-bg pb-1 pt-2"
      data-testid="topic-feed-quest-start"
      data-quest={questId}
    >
      <button
        type="button"
        onClick={() => onSelectThread?.(questId)}
        className="flex w-full min-w-0 items-baseline gap-1.5 rounded-lg border border-cc-border bg-cc-card/95 px-3 py-1.5 text-left text-xs shadow-sm backdrop-blur-sm hover:bg-cc-hover sm:text-[13px]"
        title="Open this quest's own tab"
      >
        <span className="cc-quest-link shrink-0 font-mono-code font-medium">{questId}</span>
        <span className="min-w-0 truncate font-medium text-cc-fg">{quest?.title ?? ""}</span>
        {status && <span className="shrink-0 text-cc-muted">· {status}</span>}
        <span aria-hidden="true" className="ml-auto shrink-0 pl-1 text-cc-muted">
          ›
        </span>
      </button>
    </div>
  );
}
