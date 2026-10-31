import { createContext, useMemo, type ReactNode } from "react";
import type { OverviewOrder, TopicSummary } from "../../../shared/library-topics.js";
import { isRunningBoardRow } from "../../../shared/leader-thread-tab-priority.js";
import { getQuestJourneyPhase, getQuestJourneyPhaseForState } from "../../../shared/quest-journey.js";
import { isKeyOfTopic } from "../../../shared/topic-thread-key.js";
import { useNextAttention } from "../../hooks/useNextAttention.js";
import { useStore } from "../../store.js";
import { useLeaderTopics, useOverviewOrder } from "../../utils/leader-topics.js";
import { attentionSection, type NextAttentionItem } from "../../utils/next-attention.js";
import { getQuestPhaseAccentValue } from "../../utils/quest-phase-theme.js";
import { normalizeThreadKey } from "../../utils/thread-projection.js";
import { useAttentionThreadTitles } from "../../hooks/useAttentionThreadTitles.js";
import type { BoardRowData } from "../BoardTable.js";
import { questOf } from "../library/topic-questions.js";
import {
  ItemLine,
  OverviewEmpty,
  OverviewFold,
  OverviewHeading,
  RunningLine,
  TopicLine,
  UnreadLine,
} from "./OverviewRows.js";

/** A quest a leader's worker is on now, as its board row and the worker's state say. */
export interface RunningQuest {
  questId: string;
  title: string;
  phase: { label: string; accent: string } | null;
  updatedAt: number;
  topic: { id: string; name: string } | null;
  /** The session of its worker and that session's number, when it has one. */
  workerId?: string;
  workerNum?: number;
  /** The Scribe's note on it, when it wrote one and the quest needs nothing from the user. */
  note?: string;
}

/** What in a topic needs the user and what runs there. */
export interface TopicCounts {
  /** Open questions about its quests. */
  needYou: number;
  /** Unread answers, reports and finished quests. */
  fresh: number;
  /** Its quests in progress. */
  running: number;
}

export interface LeaderOverviewData {
  /** The leader whose overview this is. */
  leaderId: string;
  /** The leader's open questions and unread answers, reports and finished quests, in Next order. */
  forYou: NextAttentionItem[];
  running: RunningQuest[];
  /** How many questions wait on the user: the only items shown in the attention color. */
  needYou: number;
  /** How many rows hold something new (unread answers by thread, reminders, tracked results): blue. */
  fresh: number;
  /** The Scribe's note for an item of `forYou`: its thread's. */
  noteFor: (item: NextAttentionItem) => string | undefined;
  countsOf: (topic: Pick<TopicSummary, "id" | "questIds">) => TopicCounts;
  open: (item: NextAttentionItem) => void;
}

/** The overview of the leader whose side column this is, for the topic list's counts. */
export const LeaderOverviewContext = createContext<LeaderOverviewData | null>(null);

/**
 * Everything going on with a leader in one place: what needs the user (from the attention queue)
 * and what its workers are on (from its work board), with both counted per topic. It reads the same
 * sources as the attention list, the board and the topic list, so what it lists and the counts
 * always agree with them. The leader's Scribe adds an order (what to handle first) and short notes;
 * what it hasn't ranked yet comes first, so the overview is right even while the Scribe is behind.
 */
export function useLeaderOverview(leaderId: string): LeaderOverviewData {
  const { queue, open } = useNextAttention();
  const board = useStore((state) => state.sessionBoards.get(leaderId) ?? EMPTY_ROWS);
  const questIds = useMemo(() => board.map((row) => normalizeThreadKey(row.questId)), [board]);
  const topics = useLeaderTopics(leaderId, questIds);
  const order = useOverviewOrder(leaderId);

  return useMemo(() => {
    // Its own questions and results, and questions asked elsewhere (by a worker, say) about one of
    // its quests.
    const ownQuests = new Set([
      ...questIds,
      ...Object.keys(topics?.map ?? {}),
      ...Object.values(topics?.topics ?? {}).flatMap((topic) => topic.questIds),
    ]);
    const listed = queue.filter(
      (item) =>
        item.sessionId === leaderId || (item.kind === "needs-input" && ownQuests.has(questOf(item.entry) ?? "")),
    );
    const ranked = rankForYou(listed, order);
    const forYou = ranked.items;
    const noted = new Set(forYou.map(threadOf));
    const running = rankBy(
      board
        .filter((row) => isRunningBoardRow(row))
        .map((row) => runningQuest(row, topics?.map[normalizeThreadKey(row.questId)]))
        .sort((a, b) => b.updatedAt - a.updatedAt),
      (quest) => quest.questId,
      order,
      // A quest's note shows once: on its question or result when it has one.
    ).map((quest) => {
      const note = noted.has(quest.questId) ? undefined : noteOf(order, quest.questId);
      return note ? { ...quest, note } : quest;
    });
    const countsOf = (topic: Pick<TopicSummary, "id" | "questIds">): TopicCounts => {
      const inTopic = (threadKey: string) =>
        !!threadKey && (topic.questIds.includes(threadKey) || isKeyOfTopic(threadKey, topic.id));
      return {
        needYou: forYou.filter((item) => item.kind === "needs-input" && inTopic(threadOf(item))).length,
        fresh: forYou.filter((item) => item.kind !== "needs-input" && inTopic(threadOf(item))).length,
        running: running.filter((quest) => quest.topic?.id === topic.id).length,
      };
    };
    return {
      leaderId,
      forYou,
      running,
      needYou: forYouGroups(forYou).filter(isQuestion).length,
      fresh: forYouGroups(forYou).filter((group) => !isQuestion(group)).length,
      noteFor: (item) => ranked.notes.get(item.key),
      countsOf,
      open,
    };
  }, [queue, leaderId, board, questIds, topics, order, open]);
}

/**
 * The overview's lists: what needs the user first, one row each (the quest it is about, or the
 * topic or thread when it is about no quest, with the question's words or the Scribe's note under
 * it when there is one); then, folded until opened, what runs now and the topics with nothing above.
 */
export function LeaderOverview({
  data,
  topics,
  onOpenQuest,
  onOpenTopic,
  onLeave,
}: {
  data: LeaderOverviewData;
  topics?: readonly TopicSummary[];
  onOpenQuest: (questId: string) => void;
  onOpenTopic?: (topic: TopicSummary) => void;
  /** After a row's menu opened something elsewhere, so a dropdown or sheet holding this can close. */
  onLeave?: () => void;
}) {
  const titles = useAttentionThreadTitles(data.forYou);
  const quiet = (topics ?? []).filter((topic) => {
    const counts = data.countsOf(topic);
    return counts.needYou + counts.fresh + counts.running === 0;
  });
  // Questions alone take the attention color, as in the notification lists; the rest is new.
  const groups = forYouGroups(data.forYou);
  const row = (items: NextAttentionItem[]) =>
    items.length === 1 && attentionSection(items[0]!) !== "unread" ? (
      <ItemLine key={items[0]!.key} item={items[0]!} data={data} titles={titles} thread={threadOf(items[0]!)} />
    ) : (
      <UnreadLine key={items[0]!.key} items={items} data={data} titles={titles} thread={threadOf(items[0]!)} />
    );
  return (
    <div className="flex flex-col pb-1" data-testid="leader-overview">
      {data.forYou.length === 0 ? (
        <section data-testid="overview-for-you">
          <OverviewHeading title="Needs you" count={0} />
          <OverviewEmpty>Nothing waits for you.</OverviewEmpty>
        </section>
      ) : (
        <>
          <ForYouSection title="Needs you" groups={groups.filter(isQuestion)} testId="overview-for-you">
            {row}
          </ForYouSection>
          <ForYouSection title="New" groups={groups.filter((group) => !isQuestion(group))} testId="overview-new">
            {row}
          </ForYouSection>
        </>
      )}
      <OverviewFold name="running" title="Running now" count={data.running.length} testId="overview-running">
        {data.running.map((quest) => (
          <RunningLine
            key={quest.questId}
            leaderId={data.leaderId}
            quest={quest}
            onOpen={() => onOpenQuest(quest.questId)}
            onLeave={onLeave}
          />
        ))}
      </OverviewFold>
      {topics && onOpenTopic && (
        <OverviewFold name="topics" title="Other topics" count={quiet.length} testId="overview-topics">
          {quiet.map((topic) => (
            <TopicLine
              key={topic.id}
              leaderId={data.leaderId}
              topic={topic}
              onOpen={() => onOpenTopic(topic)}
              onLeave={onLeave}
            />
          ))}
        </OverviewFold>
      )}
    </div>
  );
}

/** "1 needs you · 2 new · 1 running", leaving out the zeros; nothing when all are zero. */
export function TopicCountsLine({ counts, className = "" }: { counts: TopicCounts; className?: string }) {
  if (counts.needYou + counts.fresh + counts.running === 0) return null;
  return (
    <span className={`flex flex-wrap gap-x-3 text-[12px] ${className}`} data-testid="topic-counts">
      {counts.needYou > 0 && (
        <span className="text-[var(--color-cc-phase-accent-amber)]">
          {counts.needYou} {counts.needYou === 1 ? "needs" : "need"} you
        </span>
      )}
      {counts.fresh > 0 && <span className="text-cc-info">{counts.fresh} new</span>}
      {counts.running > 0 && <span className="text-cc-success">{counts.running} running</span>}
    </span>
  );
}

function ForYouSection({
  title,
  groups,
  testId,
  children,
}: {
  title: string;
  groups: NextAttentionItem[][];
  testId: string;
  children: (items: NextAttentionItem[]) => ReactNode;
}) {
  if (groups.length === 0) return null;
  return (
    <section className="border-t border-cc-border/60 first:border-t-0" data-testid={testId}>
      <OverviewHeading title={title} count={groups.length} />
      {groups.map(children)}
    </section>
  );
}

function isQuestion(group: readonly NextAttentionItem[]): boolean {
  return group[0]?.kind === "needs-input";
}

/**
 * The rows of what needs the user, in order: each question, reminder or tracked result alone, and a
 * thread's unread answers together. Questions count under "Needs you", the rest under "New".
 */
function forYouGroups(items: readonly NextAttentionItem[]): NextAttentionItem[][] {
  const groups: NextAttentionItem[][] = [];
  const unread = new Map<string, NextAttentionItem[]>();
  for (const item of items) {
    if (attentionSection(item) !== "unread") {
      groups.push([item]);
      continue;
    }
    const thread = threadOf(item) || item.key;
    const group = unread.get(thread);
    if (group) {
      group.push(item);
      continue;
    }
    const created = [item];
    unread.set(thread, created);
    groups.push(created);
  }
  return groups;
}

function runningQuest(row: BoardRowData, topic: { id: string; name: string } | undefined): RunningQuest {
  const journey = row.journey;
  const phase = getQuestJourneyPhase(journey?.currentPhaseId) ?? getQuestJourneyPhaseForState(row.status);
  return {
    questId: normalizeThreadKey(row.questId),
    title: row.title || row.questId,
    phase: phase ? { label: phase.label, accent: getQuestPhaseAccentValue(phase.color) } : null,
    updatedAt: row.updatedAt,
    topic: topic ?? null,
    ...(row.worker ? { workerId: row.worker, workerNum: row.workerNum } : {}),
  };
}

/** The thread an item is about: a question's quest, else the thread it was posted in. */
function threadOf(item: NextAttentionItem): string {
  return normalizeThreadKey((item.kind === "needs-input" ? questOf(item.entry) : null) ?? item.threadKey ?? "");
}

function noteOf(order: OverviewOrder | null, key: string): string | undefined {
  return order?.entries.find((entry) => entry.key === key)?.note;
}

/**
 * Items in the Scribe's order: what it hasn't ranked first (new since it last looked, in their own
 * order), then the rest as it ranked them. Sorting is stable, so equal ranks keep their order.
 */
function rankBy<T>(items: readonly T[], keyOf: (item: T) => string, order: OverviewOrder | null): T[] {
  if (!order) return [...items];
  const rank = new Map(order.entries.map((entry, index) => [entry.key, index]));
  return [...items].sort((a, b) => (rank.get(keyOf(a)) ?? -1) - (rank.get(keyOf(b)) ?? -1));
}

/**
 * The user's items in the Scribe's order, and each one's note: the Scribe ranks threads, so an item
 * ranks as its thread (a question's quest, else where it was posted) and takes that thread's note.
 */
function rankForYou(
  items: readonly NextAttentionItem[],
  order: OverviewOrder | null,
): { items: NextAttentionItem[]; notes: Map<string, string> } {
  const notes = new Map<string, string>();
  for (const item of items) {
    const note = noteOf(order, threadOf(item));
    if (note) notes.set(item.key, note);
  }
  return { items: rankBy(items, threadOf, order), notes };
}

const EMPTY_ROWS: BoardRowData[] = [];
