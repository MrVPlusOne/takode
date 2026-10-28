import { createContext, useContext, useMemo } from "react";
import type { ChatMessage } from "../types.js";
import type { LeaderThreadResponseProjection } from "../../server/leader-thread-response-types.js";
import type { FeedSection } from "./message-feed-sections.js";
import { resolveThreadResponses, type ThreadResponsePresentation } from "./thread-response-presentation.js";
import type { Turn } from "../hooks/use-feed-model.js";
import { topicMemberOfMessage } from "../utils/thread-projection.js";
import { QuestInlineLink } from "./QuestInlineLink.js";
import { TopicIcon } from "./library/library-icons.js";
import { useQuestRecord } from "./QuestSummaryCard.js";

/**
 * A topic conversation: one feed stitching together the threads of a topic's quests, in time
 * order. Where the feed moves to another quest it shows that quest's strip, as part of the feed;
 * a strip scrolled to the top sticks there until the next quest's strip covers it, so the quest
 * being read is always named and several quests on screen each show their own strip.
 */
export interface TopicFeed {
  /** The topic's quests (their threads make the feed, with the topic's own thread). */
  questIds: string[];
  /** The topic's own thread (`topic:<handle>`): what was written in the conversation itself. */
  topicKey: string;
  /** The topic's name, for the strip of its own thread. */
  topicName: string;
  /**
   * Zooms into a quest: its own tab, showing it alone (also when it is this tab's quest). `part` is
   * the strip tapped, whose messages on screen stay in place.
   */
  openQuest: (questId: string, part?: HTMLElement | null) => void;
}

export const TopicFeedContext = createContext<TopicFeed | null>(null);

/** The threads a topic conversation is made of, each with its own strip: the topic's own thread first. */
export function topicFeedParts(topicFeed: Pick<TopicFeed, "topicKey" | "questIds">): string[] {
  return [topicFeed.topicKey, ...topicFeed.questIds];
}

/**
 * The part each turn belongs to: the first of the conversation's threads (the topic's own, or a
 * quest's) its messages are routed to. A turn routed to none of them (a tool result, a
 * turn-closing result) continues the previous part.
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
  const key = topicFeed ? topicFeedParts(topicFeed).join(",") : "";
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
  if (topicFeed && questId === topicFeed.topicKey) return <TopicFeedOwnStart name={topicFeed.topicName} />;
  return <QuestStart questId={questId} />;
}

/**
 * The pinned strip's wrapper. Sticky offsets are measured inside the feed's top padding (py-4,
 * sm:py-6), so they cancel it, and a pinned strip sits right under the topic header. The space
 * above it is a margin, not padding: a stuck sticky box ignores its margin, so the strip keeps its
 * distance from the message above while scrolling and no empty band shows above it once pinned.
 * z-30 keeps it above bubbles, cards and their own sticky bars as they scroll by.
 */
const STRIP_WRAPPER = "sticky -top-4 z-30 sm:-top-6 mt-2 bg-cc-bg pb-1";

/** The strip where the conversation moves to the topic's own thread: what was written in the topic itself. */
function TopicFeedOwnStart({ name }: { name: string }) {
  return (
    <div className={STRIP_WRAPPER} data-testid="topic-feed-quest-start" data-quest="">
      <div className="flex w-full min-w-0 items-center gap-1.5 rounded-lg border border-cc-border bg-cc-card/95 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm sm:text-[13px]">
        <TopicIcon className="h-3.5 w-3.5 shrink-0 text-cc-primary" />
        <span className="min-w-0 truncate font-medium text-cc-fg">{name}</span>
        <span className="shrink-0 text-cc-muted">· in the topic</span>
      </div>
    </div>
  );
}

function QuestStart({ questId }: { questId: string }) {
  const topicFeed = useContext(TopicFeedContext);
  const quest = useQuestRecord(questId);
  const status = quest ? (quest.status === "done" ? "Done" : quest.status.replace("_", " ")) : "";
  return (
    <div className={STRIP_WRAPPER} data-testid="topic-feed-quest-start" data-quest={questId}>
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
