import { Fragment, useMemo } from "react";
import type { FeedEntry, Turn } from "../hooks/use-feed-model.js";
import { useStore } from "../store.js";
import { FeedEntries } from "./MessageFeedEntries.js";
import { MinuteBoundaryTimestamp } from "./MinuteBoundaryTimestamp.js";
import { isFinalMessage, TopicFeedQuestStart } from "./topic-feed.js";
import type { QuestLinkSurface } from "./quest-link-surface.js";
import type { ThreadResponsePresentation } from "./thread-response-presentation.js";

/**
 * A topic conversation shows what the user reads, one quest at a time (Jiayi, after browsing
 * topics where parallel quests interleaved their working steps).
 *
 * What shows: the user's own messages and the leader's answers, new results and questions. The
 * leader's commentary, progress updates, tool and worker activity and status lines stay in each
 * quest's own thread, a click on the quest's strip away.
 *
 * In what order: each quest's messages of a day form one track that starts where its first one is
 * (usually the request that started the work), so a request is followed by its answers and results,
 * and a follow-up and its answer stay in that track rather than interleaving with other quests.
 * Tracks, and the topic's own messages, follow one another in the order they started, so the
 * requests that start them keep their order. A new day starts new tracks, so day labels stay true.
 */

/** The entries a turn shows: its final messages, plus `reveal` when the feed is asked to jump there. */
export function topicFeedShownEntries(turn: Turn, reveal: string | null = null): FeedEntry[] {
  const entries = [turn.userEntry, ...turn.allEntries].filter(
    (entry): entry is Extract<FeedEntry, { kind: "message" }> =>
      entry?.kind === "message" && (isFinalMessage(entry.msg) || entry.msg.id === reveal),
  );
  // A message can sit in both the user entry and the turn's entries; show it once.
  return entries.filter((entry, index) => entries.findIndex((other) => other.msg.id === entry.msg.id) === index);
}

/**
 * The order of the turns that show: each quest's turns of a day together, where the first of them
 * is; the topic's own turns, and turns of no quest, where they are.
 */
export function topicFeedOrder(
  turns: readonly Turn[],
  turnQuests: ReadonlyArray<string | null>,
  shows: (index: number) => boolean,
  topicKey: string,
): number[] {
  const visible = turns.map((_, index) => index).filter(shows);
  const trackOf = (index: number) => {
    const quest = turnQuests[index];
    return quest && quest !== topicKey ? `${quest}|${dayOf(turns[index]!)}` : `#${index}`;
  };
  const tracks = new Map<string, number[]>();
  for (const index of visible) tracks.set(trackOf(index), [...(tracks.get(trackOf(index)) ?? []), index]);
  return visible.flatMap((index) => {
    const track = tracks.get(trackOf(index))!;
    return track[0] === index ? track : [];
  });
}

/**
 * The topic conversation's turns: in the order above, a strip where the quest changes, a day label
 * where the day does, and only the entries that show. Answers keep their reply quote or "New
 * result" line from their quest's answer presentation.
 */
export function TopicFeedTurns({
  turns,
  turnQuests,
  topicKey,
  sectionStartTurnIds,
  sessionId,
  currentThreadKey,
  isCodexSession,
  activeCodexTerminalIds,
  onOpenCodexTerminal,
  onSelectThread,
  questLinkSurface,
  presentationOf,
}: {
  turns: readonly Turn[];
  turnQuests: ReadonlyArray<string | null>;
  topicKey: string;
  sectionStartTurnIds: ReadonlySet<string>;
  sessionId: string;
  currentThreadKey: string;
  isCodexSession: boolean;
  activeCodexTerminalIds: Set<string>;
  onOpenCodexTerminal: (toolUseId: string) => void;
  onSelectThread?: (threadKey: string) => void;
  questLinkSurface: QuestLinkSurface;
  presentationOf: (quest: string | null) => ThreadResponsePresentation | null | undefined;
}) {
  // A jump to a message that wouldn't show (a search hit, a link to a working step) shows it.
  const jumpTarget = useStore((state) => state.scrollToMessageId.get(sessionId) ?? null);
  const model = useMemo(() => {
    const entries = turns.map((turn) => topicFeedShownEntries(turn, jumpTarget));
    const order = topicFeedOrder(turns, turnQuests, (index) => entries[index]!.length > 0, topicKey);
    const shown = new Set(order);
    return { entries, order, hidden: turns.filter((_, index) => !shown.has(index)) };
  }, [turns, turnQuests, topicKey, jumpTarget]);
  let previousDay = "";
  let previousQuest: string | null = null;
  return (
    <>
      {/* Turns that show nothing still mark where the feed's sections start, for its section navigation. */}
      {model.hidden.map((turn) =>
        sectionStartTurnIds.has(turn.id) ? <div key={turn.id} data-feed-section-id={turn.id} /> : null,
      )}
      {model.order.map((turnIndex) => {
        const turn = turns[turnIndex]!;
        const quest = turnQuests[turnIndex] ?? null;
        const at = firstTime(turn);
        const day = dayOf(turn);
        const newDay = day !== previousDay;
        // A new day restates the quest, so a strip never sits above a day label of its own track.
        const strip = !!quest && (quest !== previousQuest || newDay);
        previousDay = day;
        previousQuest = quest;
        return (
          <Fragment key={turn.id}>
            {newDay && at > 0 && <MinuteBoundaryTimestamp timestamp={at} label={dayLabel(at)} />}
            {strip && <TopicFeedQuestStart questId={quest!} sessionId={sessionId} />}
            <div
              data-turn-id={turn.id}
              data-feed-section-id={sectionStartTurnIds.has(turn.id) ? turn.id : undefined}
              className="turn-container space-y-2 sm:space-y-3"
            >
              <FeedEntries
                entries={model.entries[turnIndex]!}
                sessionId={sessionId}
                currentThreadKey={currentThreadKey}
                isCodexSession={isCodexSession}
                activeCodexTerminalIds={activeCodexTerminalIds}
                onOpenCodexTerminal={onOpenCodexTerminal}
                onSelectThread={onSelectThread}
                suppressThreadSystemMarkers
                questLinkSurface={questLinkSurface}
                threadResponsePresentation={presentationOf(quest)}
              />
            </div>
          </Fragment>
        );
      })}
    </>
  );
}

function dayLabel(at: number): string {
  return new Date(at).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function firstTime(turn: Turn): number {
  for (const entry of [turn.userEntry, ...turn.allEntries]) {
    if (entry?.kind === "message" && entry.msg.timestamp) return entry.msg.timestamp;
  }
  return 0;
}

function dayOf(turn: Turn): string {
  const at = firstTime(turn);
  return at ? new Date(at).toDateString() : "";
}
