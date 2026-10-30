import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ChatMessage } from "../types.js";
import type { LeaderThreadResponseProjection } from "../../server/leader-thread-response-types.js";
import type { FeedSection } from "./message-feed-sections.js";
import { resolveThreadResponses, type ThreadResponsePresentation } from "./thread-response-presentation.js";
import type { Turn } from "../hooks/use-feed-model.js";
import { normalizeThreadKey, topicMemberOfMessage } from "../utils/thread-projection.js";
import { continuedQuestOf, StartedQuestsContext } from "./QuestForkLinks.js";
import { leaderResponseOwnerThreadKey } from "../../shared/leader-thread-response-routing.js";
import { QuestInlineLink } from "./QuestInlineLink.js";
import { NewThreadIcon, TopicIcon } from "./library/library-icons.js";
import type { TopicThreadRef } from "../../shared/library-topics.js";
import { topicViewKey } from "../../shared/topic-thread-key.js";
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
  /** Threads filed under the topic: parts of the conversation, each under its own name. */
  threads?: readonly TopicThreadRef[];
  /**
   * Zooms into a quest: opens it on its own. `part` is
   * the strip tapped, whose messages on screen stay in place.
   */
  openQuest: (questId: string, part?: HTMLElement | null) => void;
}

export const TopicFeedContext = createContext<TopicFeed | null>(null);

/** The threads a topic conversation is made of, each with its own strip: the topic's own thread first. */
export function topicFeedParts(topicFeed: Pick<TopicFeed, "topicKey" | "questIds" | "threads">): string[] {
  return [
    topicFeed.topicKey,
    ...(topicFeed.threads ?? []).map((thread) => topicViewKey(thread.handle)),
    ...topicFeed.questIds,
  ];
}

/**
 * The part each turn belongs to: the part of its first message that has one (`useTopicTurnPartOf`). A turn routed to none of them (a tool result, a
 * turn-closing result) continues the previous part.
 */
export function topicQuestsOfTurns(
  turns: readonly Turn[],
  partOf: (message: ChatMessage, request: ChatMessage | null) => string | null,
): Array<string | null> {
  let previous: string | null = null;
  return turns.map((turn) => {
    const request = turn.userEntry?.kind === "message" ? turn.userEntry.msg : null;
    for (const entry of [turn.userEntry, ...turn.allEntries]) {
      if (entry?.kind !== "message") continue;
      const quest = partOf(entry.msg, request);
      if (quest) {
        previous = quest;
        return quest;
      }
    }
    return previous;
  });
}

/** What a turn of a topic conversation shows above itself. */
export type TopicTurnMark = "strip" | "label" | null;

/**
 * Where a topic conversation shows quest strips: only above turns with a final message (something
 * the user reads: their own message, an answer, a report, a question), when the conversation moves
 * to another quest there. A turn of commentary, tools or worker events alone gets no strip (Jiayi:
 * strips piled up above collapsed "1 tool · 1 worker event" rows); when it belongs to another quest
 * than the strip pinned above it, it gets a small label instead, so it is never read as that quest's.
 * The pinned strip therefore always names the quest of the last final message the reader passed.
 */
export function topicTurnMarks(turns: readonly Turn[], turnQuests: ReadonlyArray<string | null>): TopicTurnMark[] {
  let pinned: string | null = null;
  return turns.map((turn, index) => {
    const quest = turnQuests[index] ?? null;
    if (!quest) return null;
    if (turnHasFinalMessage(turn)) {
      if (quest === pinned) return null;
      pinned = quest;
      return "strip";
    }
    // One label heads a quest's consecutive turns; repeating it on each says nothing new.
    return quest === pinned || quest === turnQuests[index - 1] ? null : "label";
  });
}

/** Whether a turn holds a message the user reads, rather than only the leader's working steps. */
export function turnHasFinalMessage(turn: Turn): boolean {
  return [turn.userEntry, ...turn.allEntries].some((entry) => entry?.kind === "message" && isFinalMessage(entry.msg));
}

function isFinalMessage(message: ChatMessage): boolean {
  if (message.parentToolUseId) return false;
  const metadata = message.metadata;
  if (metadata?.markdownReport) return true;
  if (message.role === "user") return metadata?.leaderResponseCoverageVersion === 1 && !message.agentSource;
  if (message.role !== "assistant") return false;
  return metadata?.leaderThreadRole === "answer" || !!metadata?.threadAnswer || !!message.notification;
}

/**
 * Above a turn of working steps that belongs to another quest than the strip pinned above it: the
 * quest, quietly, so the turn is not read as the pinned quest's. Not sticky, not a strip.
 */
export function TopicFeedQuestLabel({ questId }: { questId: string }) {
  const topicFeed = useContext(TopicFeedContext);
  const quest = useQuestRecord(topicFeed && questId === topicFeed.topicKey ? null : questId);
  const ownThread = !!topicFeed && questId === topicFeed.topicKey;
  return (
    <div
      className="flex min-w-0 items-baseline gap-1.5 pt-1 text-[11.5px] text-cc-muted"
      data-testid="topic-feed-quest-label"
      data-quest={ownThread ? "" : questId}
    >
      {ownThread ? (
        <span className="truncate">In the topic</span>
      ) : (
        <>
          <span className="shrink-0 font-mono-code">
            <QuestInlineLink questId={questId} surface="chat-feed" />
          </span>
          <span className="min-w-0 truncate">{quest?.title ?? ""}</span>
        </>
      )}
    </div>
  );
}

/**
 * In a topic conversation: which of the topic's quests a message belongs to, so the feed starts a
 * new turn (and shows the quest's strip) wherever the conversation moves to another quest, also
 * in the middle of what would otherwise be one turn. Null outside topic conversations.
 *
 * The user's request belongs to the quest it continued in (handed off to, or filed from it), as in
 * Main: that quest's strip then sits above the request, which reads as the quest's start (Jiayi:
 * the request sat under the topic's strip, with the quest's strip only after the filing note). The
 * leader's replies in the request's own thread during that turn (the filing note) join the quest
 * too, so the request and what the leader did with it read as one part, as under a strip in Main.
 */
export function useTopicTurnPartOf(): ((message: ChatMessage, request: ChatMessage | null) => string | null) | null {
  const topicFeed = useContext(TopicFeedContext);
  const started = useContext(StartedQuestsContext);
  const key = topicFeed ? topicFeedParts(topicFeed).join(",") : "";
  return useMemo(() => {
    if (!key) return null;
    const parts = key.split(",");
    const requestPart = (request: ChatMessage): string | null => {
      // The thread it was moved into is on the message itself; a quest filed from it is in the started list.
      const owner = leaderResponseOwnerThreadKey(request.metadata ?? {});
      const filed = continuedQuestOf(request, started?.get(request.id) ?? null);
      for (const quest of [owner, filed && normalizeThreadKey(filed.questId)]) {
        if (quest && parts.includes(quest)) return quest;
      }
      return null;
    };
    return (message: ChatMessage, request: ChatMessage | null) => {
      if (isUserRequest(message)) return requestPart(message) ?? topicMemberOfMessage(message, parts);
      const part = topicMemberOfMessage(message, parts);
      if (!request || !isUserRequest(request) || part !== topicMemberOfMessage(request, parts)) return part;
      return requestPart(request) ?? part;
    };
  }, [key, started]);
}

/** The user's own request, as opposed to herd events, timers and other agents' messages. */
function isUserRequest(message: ChatMessage): boolean {
  return message.role === "user" && message.metadata?.leaderResponseCoverageVersion === 1 && !message.agentSource;
}

/**
 * The strip naming `questId` where the conversation moves to it: the ID is a quest link like any in
 * the feed, and tapping the rest of the strip zooms into the quest.
 */
export function TopicFeedQuestStart({ questId }: { questId: string }) {
  const topicFeed = useContext(TopicFeedContext);
  if (topicFeed && questId === topicFeed.topicKey) return <TopicFeedOwnStart name={topicFeed.topicName} />;
  // A thread filed under the topic: its own strip, under its name.
  const thread = topicFeed?.threads?.find((filed) => topicViewKey(filed.handle) === questId);
  if (thread) {
    return (
      <TopicFeedOwnStart
        name={thread.name}
        note="thread"
        icon={<NewThreadIcon className="h-3.5 w-3.5 shrink-0 text-cc-primary" />}
        onOpen={() => topicFeed?.openQuest(questId)}
      />
    );
  }
  return <QuestStart questId={questId} />;
}

/**
 * The pinned strip's wrapper. Sticky offsets are measured inside the feed's top padding (py-4,
 * sm:py-6), so they cancel it, and a pinned strip sits right under the topic header. The space
 * above it is a margin, not padding: a stuck sticky box ignores its margin, so the strip keeps its
 * distance from the message above while scrolling and no empty band shows above it once pinned.
 * z-30 keeps it above bubbles, cards and their own sticky bars as they scroll by.
 */
export const STRIP_WRAPPER = "sticky -top-4 z-30 sm:-top-6 mt-2 bg-cc-bg pb-1";

/** The strip where the conversation moves to the topic's own thread: what was written in the topic itself. */
function TopicFeedOwnStart({
  name,
  note = "in the topic",
  icon,
  onOpen,
}: {
  name: string;
  note?: string;
  icon?: ReactNode;
  /** A thread filed under the topic opens on its own when its strip is tapped. */
  onOpen?: () => void;
}) {
  const content = (
    <>
      {icon ?? <TopicIcon className="h-3.5 w-3.5 shrink-0 text-cc-primary" />}
      <span className="min-w-0 truncate font-medium text-cc-fg">{name}</span>
      <span className="shrink-0 text-cc-muted">· {note}</span>
    </>
  );
  const box =
    "flex w-full min-w-0 items-center gap-1.5 rounded-lg border border-cc-border bg-cc-card/95 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm sm:text-[13px]";
  return (
    <div className={STRIP_WRAPPER} data-testid="topic-feed-quest-start" data-feed-quest-strip="true" data-quest="">
      {onOpen ? (
        <button type="button" onClick={onOpen} className={`${box} text-left hover:bg-cc-hover`}>
          {content}
        </button>
      ) : (
        <div className={box}>{content}</div>
      )}
    </div>
  );
}

function QuestStart({ questId }: { questId: string }) {
  const topicFeed = useContext(TopicFeedContext);
  const quest = useQuestRecord(questId);
  const status = quest ? (quest.status === "done" ? "Done" : quest.status.replace("_", " ")) : "";
  return (
    <div
      className={STRIP_WRAPPER}
      data-testid="topic-feed-quest-start"
      data-feed-quest-strip="true"
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
