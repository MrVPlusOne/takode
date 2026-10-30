import { createContext, useMemo, type ReactNode } from "react";
import type { OverviewOrder, TopicSummary } from "../../../shared/library-topics.js";
import { getQuestJourneyPhase, getQuestJourneyPhaseForState } from "../../../shared/quest-journey.js";
import { isKeyOfTopic } from "../../../shared/topic-thread-key.js";
import type { BoardParticipantStatus, BoardRowSessionStatus } from "../../../server/session-types.js";
import { useNextAttention } from "../../hooks/useNextAttention.js";
import { useStore } from "../../store.js";
import { useLeaderTopics, useOverviewOrder } from "../../utils/leader-topics.js";
import {
  ATTENTION_SECTIONS,
  attentionPlaceKey,
  countAttentionPlaces,
  type NextAttentionItem,
} from "../../utils/next-attention.js";
import { getQuestPhaseAccentValue } from "../../utils/quest-phase-theme.js";
import { normalizeThreadKey } from "../../utils/thread-projection.js";
import { AttentionItemSections } from "../AttentionItemRows.js";
import { formatRelativeTime } from "../AttentionKind.js";
import type { BoardRowData } from "../BoardTable.js";
import { questOf } from "../library/topic-questions.js";
import { topicRowLine } from "../library/topic-search.js";

/** A quest a leader's worker is on now, as its board row and the worker's state say. */
export interface RunningQuest {
  questId: string;
  title: string;
  phase: { label: string; accent: string } | null;
  worker: BoardParticipantStatus | null;
  /** When the quest entered its current phase. */
  phaseSince: number | null;
  updatedAt: number;
  topic: { id: string; name: string } | null;
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
  /** The leader's open questions and unread answers, reports and finished quests, in Next order. */
  forYou: NextAttentionItem[];
  running: RunningQuest[];
  /** The Scribe's note for an item of `forYou` (a place shows its first item's). */
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
  const statuses = useStore((state) => state.sessionBoardRowStatuses.get(leaderId) ?? EMPTY_STATUSES);
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
        .filter((row) => !isQueued(row))
        .map((row) => runningQuest(row, statuses[row.questId], topics?.map[normalizeThreadKey(row.questId)]))
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
    return { forYou, running, noteFor: (item) => ranked.notes.get(item.key), countsOf, open };
  }, [queue, leaderId, board, questIds, statuses, topics, order, open]);
}

/**
 * The overview's lists, most urgent first: what needs the user, what runs now, and (when given) the
 * leader's topics with their counts.
 */
export function LeaderOverview({
  data,
  topics,
  onOpenQuest,
  onOpenTopic,
}: {
  data: LeaderOverviewData;
  topics?: readonly TopicSummary[];
  onOpenQuest: (questId: string) => void;
  onOpenTopic?: (topic: TopicSummary) => void;
}) {
  return (
    <div className="flex flex-col" data-testid="leader-overview">
      <Section title="Needs you" count={countAttentionPlaces(data.forYou)} testId="overview-for-you">
        {data.forYou.length === 0 ? (
          <Empty>Nothing waits for you.</Empty>
        ) : (
          <AttentionItemSections
            items={data.forYou}
            kinds={ATTENTION_SECTIONS}
            onOpen={data.open}
            noteFor={data.noteFor}
          />
        )}
      </Section>
      <Section title="Running now" count={data.running.length} testId="overview-running">
        {data.running.length === 0 ? (
          <Empty>No quest is in progress.</Empty>
        ) : (
          data.running.map((quest) => (
            <RunningRow key={quest.questId} quest={quest} onOpen={() => onOpenQuest(quest.questId)} />
          ))
        )}
      </Section>
      {topics && onOpenTopic && (
        <Section title="Topics" count={topics.length} testId="overview-topics">
          {topics.map((topic) => (
            <TopicRow key={topic.id} topic={topic} counts={data.countsOf(topic)} onOpen={() => onOpenTopic(topic)} />
          ))}
        </Section>
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

function Section({
  title,
  count,
  testId,
  children,
}: {
  title: string;
  count: number;
  testId: string;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-cc-border/60 pb-1 last:border-b-0" data-testid={testId}>
      <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
        <h3 className="text-[11px] uppercase tracking-wide text-cc-muted">{title}</h3>
        <span className="text-[11px] tabular-nums text-cc-muted">{count}</span>
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="px-3 py-1.5 text-[12.5px] text-cc-muted">{children}</div>;
}

function RunningRow({ quest, onOpen }: { quest: RunningQuest; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full flex-col gap-0.5 px-3 py-1.5 text-left hover:bg-cc-hover"
      data-testid="overview-running-row"
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] text-cc-fg">{quest.title}</span>
        <PhaseLabel phase={quest.phase} />
      </span>
      {quest.note && (
        <span className="truncate text-[11.5px] text-cc-fg/75" title={quest.note} data-testid="overview-note">
          {quest.note}
        </span>
      )}
      <span className="flex min-w-0 items-center gap-2 text-[11.5px] text-cc-muted">
        <span className="min-w-0 flex-1 truncate">
          {quest.questId}
          {quest.topic && ` · ${quest.topic.name}`}
        </span>
        <WorkerState worker={quest.worker} />
        <span className="shrink-0 tabular-nums" title={quest.phaseSince ? "Time in this phase" : "Last change"}>
          {quest.phaseSince ? since(quest.phaseSince) : formatRelativeTime(quest.updatedAt)}
        </span>
      </span>
    </button>
  );
}

function PhaseLabel({ phase }: { phase: RunningQuest["phase"] }) {
  if (!phase) return null;
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 text-[12px]" style={{ color: phase.accent }}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: phase.accent }} aria-hidden="true" />
      {phase.label}
    </span>
  );
}

/** The worker's number, with a filled green dot while it works and a hollow one while it waits. */
function WorkerState({ worker }: { worker: BoardParticipantStatus | null }) {
  if (!worker) return null;
  const running = worker.status === "running";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 ${running ? "text-cc-success" : ""}`}
      title={running ? "Working now" : "Waiting"}
      data-testid="overview-worker"
      data-status={worker.status}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${running ? "bg-cc-success" : "border border-cc-muted"}`}
        aria-hidden="true"
      />
      {worker.sessionNum ? `#${worker.sessionNum}` : "worker"}
    </span>
  );
}

function TopicRow({ topic, counts, onOpen }: { topic: TopicSummary; counts: TopicCounts; onOpen: () => void }) {
  const line = topicRowLine(topic);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full px-3 py-1.5 text-left hover:bg-cc-hover"
      data-testid="overview-topic-row"
    >
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] text-cc-fg">{topic.name}</span>
        <span className="shrink-0 text-[11.5px] text-cc-muted">{formatRelativeTime(topic.activityAt)}</span>
      </span>
      <TopicCountsLine counts={counts} className="mt-0.5" />
      {line && <span className="mt-0.5 line-clamp-1 text-[12px] text-cc-fg/70">{line}</span>}
    </button>
  );
}

function runningQuest(
  row: BoardRowData,
  status: BoardRowSessionStatus | undefined,
  topic: { id: string; name: string } | undefined,
): RunningQuest {
  const journey = row.journey;
  const phase = getQuestJourneyPhase(journey?.currentPhaseId) ?? getQuestJourneyPhaseForState(row.status);
  const index = journey?.activePhaseIndex;
  return {
    questId: normalizeThreadKey(row.questId),
    title: row.title || row.questId,
    phase: phase ? { label: phase.label, accent: getQuestPhaseAccentValue(phase.color) } : null,
    worker: status?.worker ?? null,
    phaseSince: index !== undefined ? (journey?.phaseTimings?.[String(index)]?.startedAt ?? null) : null,
    updatedAt: row.updatedAt,
    topic: topic ?? null,
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
 * The user's items in the Scribe's order, and each one's note. Unread results show by place (a
 * topic's new answers together), so a place ranks as its best-ranked thread and keeps together;
 * its note is that thread's.
 */
function rankForYou(
  items: readonly NextAttentionItem[],
  order: OverviewOrder | null,
): { items: NextAttentionItem[]; notes: Map<string, string> } {
  const notes = new Map<string, string>();
  if (!order) return { items: [...items], notes };
  const rank = new Map(order.entries.map((entry, index) => [entry.key, index]));
  const best = new Map<string, string>();
  for (const item of items) {
    const place = attentionPlaceKey(item);
    const key = threadOf(item);
    const current = best.get(place);
    if (rank.has(key) && (current === undefined || rank.get(key)! < rank.get(current)!)) best.set(place, key);
  }
  const placeRank = (item: NextAttentionItem) => rank.get(best.get(attentionPlaceKey(item)) ?? "") ?? -1;
  for (const item of items) {
    const note = noteOf(order, best.get(attentionPlaceKey(item)) ?? "");
    if (note) notes.set(item.key, note);
  }
  return { items: [...items].sort((a, b) => placeRank(a) - placeRank(b)), notes };
}

function isQueued(row: BoardRowData): boolean {
  return (row.status ?? "").trim().toUpperCase() === "QUEUED";
}

/** How long since, without "ago": "12m", "3h", "2d". */
function since(at: number): string {
  return formatRelativeTime(at).replace(/ ago$/, "").replace("just now", "<1m");
}

const EMPTY_ROWS: BoardRowData[] = [];
const EMPTY_STATUSES: Record<string, BoardRowSessionStatus> = {};
