import { createContext, useContext, useMemo } from "react";
import type { ChatMessage } from "../types.js";
import type { LeaderThreadResponseProjection } from "../../server/leader-thread-response-types.js";
import type { FeedSection } from "./message-feed-sections.js";
import { resolveThreadResponses, type ThreadResponsePresentation } from "./thread-response-presentation.js";
import type { Turn } from "../hooks/use-feed-model.js";
import { topicMemberOfMessage } from "../utils/thread-projection.js";
import { QuestInlineLink } from "./QuestInlineLink.js";
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
  /**
   * Zooms into a quest: its own tab, showing it alone (also when it is this tab's quest). `part` is
   * the strip tapped, whose messages on screen stay in place.
   */
  openQuest: (questId: string, part?: HTMLElement | null) => void;
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

/**
 * In a topic conversation: which of the topic's quests a message belongs to, so the feed starts a
 * new turn (and shows the quest's strip) wherever the conversation moves to another quest, also
 * in the middle of what would otherwise be one turn. Null outside topic conversations.
 */
export function useTopicTurnPartOf(): ((message: ChatMessage) => string | null) | null {
  const topicFeed = useContext(TopicFeedContext);
  const key = topicFeed?.questIds.join(",") ?? "";
  return useMemo(() => {
    if (!key) return null;
    const questIds = key.split(",");
    return (message: ChatMessage) => topicMemberOfMessage(message, questIds);
  }, [key]);
}

/**
 * The strip naming `questId` where the conversation moves to it: the ID is a quest link like any in
 * the feed, and tapping the rest of the strip zooms into the quest.
 */
export function TopicFeedQuestStart({ questId }: { questId: string }) {
  const topicFeed = useContext(TopicFeedContext);
  const quest = useQuestRecord(questId);
  const status = quest ? (quest.status === "done" ? "Done" : quest.status.replace("_", " ")) : "";
  // Sticky offsets are measured inside the feed's top padding (py-4, sm:py-6), so they cancel it;
  // z-30 keeps the pinned strip above bubbles, cards and their own sticky bars as they scroll by.
  return (
    <div
      className="sticky -top-4 z-30 sm:-top-6 bg-cc-bg pb-1 pt-2"
      data-testid="topic-feed-quest-start"
      data-quest={questId}
    >
      {/* The quest ID is a real quest link (hover preview, jump icon); the rest of the strip zooms. */}
      <div className="flex w-full min-w-0 items-baseline gap-1.5 rounded-lg border border-cc-border bg-cc-card/95 pl-3 text-xs shadow-sm backdrop-blur-sm sm:text-[13px]">
        <span className="shrink-0 py-1.5 font-mono-code font-medium">
          <QuestInlineLink questId={questId} surface="chat-feed" />
        </span>
        <button
          type="button"
          onClick={(event) => topicFeed?.openQuest(questId, event.currentTarget.closest<HTMLElement>("[data-quest]"))}
          className="flex min-w-0 flex-1 items-baseline gap-1.5 self-stretch rounded-r-lg py-1.5 pr-3 text-left hover:bg-cc-hover"
          title="Zoom into this quest"
          data-testid="topic-feed-quest-zoom"
        >
          <span className="min-w-0 truncate font-medium text-cc-fg">{quest?.title ?? ""}</span>
          {status && <span className="shrink-0 text-cc-muted">· {status}</span>}
          <span aria-hidden="true" className="ml-auto shrink-0 pl-1 text-cc-muted">
            ›
          </span>
        </button>
      </div>
    </div>
  );
}

/**
 * Each quest's answer presentation in a topic conversation, from its own answer state, so a quest's
 * turns show answers (what they answer, collapsed answer sets) exactly as in the quest's own tab.
 * Null outside topic conversations.
 */
export function useTopicResponsePresentations(
  sections: readonly FeedSection[],
  state: LeaderThreadResponseProjection | null | undefined,
  proofMessages: readonly ChatMessage[],
): ReadonlyMap<string, ThreadResponsePresentation | null> | null {
  return useMemo(() => {
    if (!state?.members) return null;
    return new Map(
      Object.entries(state.members).map(([questId, member]) => [
        questId,
        resolveThreadResponses(sections, member, questId, true, proofMessages),
      ]),
    );
  }, [sections, state, proofMessages]);
}
