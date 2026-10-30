import { useCallback, useMemo, useState, type ReactNode } from "react";
import type { Turn } from "../hooks/use-feed-model.js";
import { useStore } from "../store.js";
import { markdownToPlainText } from "../../shared/markdown-plain-text.js";
import { getAssistantVisibleMarkdown } from "../utils/assistant-message-renderability.js";
import { formatMessageTimestamp } from "./MessageTimestamp.js";
import { QuestInlineLink } from "./QuestInlineLink.js";
import { useQuestRecord } from "./QuestSummaryCard.js";
import { topicTurnMarks, turnHasFinalMessage, type TopicTurnMark } from "./topic-feed.js";

/**
 * Quests that run at the same time in one topic interleave their progress updates in its
 * conversation (Jiayi's Formal verification topic: two quests alternated 24 times in under an
 * hour, each update a label, a collapsed activity row and the text). Such a stretch becomes one
 * progress card with a row per quest, its latest updates rolling like the worker preview in quest
 * tabs. A row opens to show that quest's own turns in the conversation.
 */

/** One quest's turns within a progress run, in time order. */
export interface ProgressGroup {
  /** The quest, or the topic's own key for the leader's updates in the topic itself. */
  quest: string;
  turnIndexes: number[];
}

/** A stretch of progress turns that interleaves two or more quests, shown as one card. */
export interface ProgressRun {
  /** The run's first turn, which keeps which rows are open while turns load around it. */
  key: string;
  groups: ProgressGroup[];
}

export interface TopicProgressRuns {
  /** Each run, at the index of its first turn, where its card goes. */
  starts: Map<number, ProgressRun>;
  /** Every turn inside a run, with its run. */
  runOfTurn: Map<number, ProgressRun>;
}

/**
 * The progress runs of a topic conversation: consecutive turns of quests or the topic with no
 * final message (answer, report, question, the user's own message), spanning two or more of them.
 * Final messages end a run, so they stay in time order and nothing the user reads is folded.
 * A run also ends at a change of day, so day dividers stay. A stretch of a single quest stays as
 * it is.
 */
export function topicProgressRuns(turns: readonly Turn[], turnQuests: ReadonlyArray<string | null>): TopicProgressRuns {
  const starts = new Map<number, ProgressRun>();
  const runOfTurn = new Map<number, ProgressRun>();
  let run: number[] = [];
  const flush = () => {
    if (new Set(run.map((index) => turnQuests[index])).size >= 2) {
      const groups = new Map<string, ProgressGroup>();
      for (const index of run) {
        const quest = turnQuests[index]!;
        const group = groups.get(quest) ?? { quest, turnIndexes: [] };
        group.turnIndexes.push(index);
        groups.set(quest, group);
      }
      const progressRun = { key: turns[run[0]!]!.id, groups: [...groups.values()] };
      starts.set(run[0]!, progressRun);
      for (const index of run) runOfTurn.set(index, progressRun);
    }
    run = [];
  };
  turns.forEach((turn, index) => {
    const previous = run.at(-1);
    if (previous !== undefined && dayChanges(turnTimestamp(turns[previous]!), turnTimestamp(turn))) flush();
    if (turnQuests[index] && !turnHasFinalMessage(turn)) run.push(index);
    else flush();
  });
  flush();
  return { starts, runOfTurn };
}

/** What a topic conversation shows of its turns once progress runs fold into cards. */
export interface TopicProgress {
  /** The strip or label above each turn, worked out over the turns that show. */
  marks: TopicTurnMark[];
  /** Whether a turn is folded into its run's card. */
  hidden: (turnIndex: number) => boolean;
  /** The card that goes above a run's first turn, else null. */
  card: (turnIndex: number) => ReactNode;
}

/**
 * Fold a topic conversation's progress runs into cards. A row the user opens shows its quest's
 * turns in place again; so does a jump to a message inside a folded turn, which opens its row.
 */
export function useTopicProgress({
  sessionId,
  topicKey,
  turns,
  turnQuests,
}: {
  sessionId: string | undefined;
  topicKey: string;
  turns: readonly Turn[];
  turnQuests: ReadonlyArray<string | null>;
}): TopicProgress {
  const runs = useMemo(() => topicProgressRuns(turns, turnQuests), [turns, turnQuests]);
  // Open rows by run key and quest; keys are turn ids, so loading more turns keeps them.
  const [open, setOpen] = useState<ReadonlyMap<string, ReadonlySet<string>>>(new Map());
  const toggle = (run: ProgressRun, quest: string, value?: boolean) =>
    setOpen((previous) => {
      const quests = new Set(previous.get(run.key));
      if (value ?? !quests.has(quest)) quests.add(quest);
      else quests.delete(quest);
      return new Map(previous).set(run.key, quests);
    });
  const isHidden = useCallback(
    (index: number) => {
      const run = runs.runOfTurn.get(index);
      return !!run && !open.get(run.key)?.has(turnQuests[index]!);
    },
    [runs, open, turnQuests],
  );

  // A jump to a folded message opens its row before the feed looks for the message.
  const jumpTarget = useStore((state) => (sessionId ? state.scrollToMessageId.get(sessionId) : null));
  const jumpIndex =
    jumpTarget && runs.runOfTurn.size > 0 ? turns.findIndex((turn) => turnHoldsMessage(turn, jumpTarget)) : -1;
  if (jumpIndex >= 0 && isHidden(jumpIndex)) toggle(runs.runOfTurn.get(jumpIndex)!, turnQuests[jumpIndex]!, true);

  const marks = useMemo(() => {
    const shown = turns.map((_, index) => index).filter((index) => !isHidden(index));
    const shownMarks = topicTurnMarks(
      shown.map((index) => turns[index]!),
      shown.map((index) => turnQuests[index] ?? null),
    );
    const byTurn: TopicTurnMark[] = turns.map(() => null);
    shown.forEach((index, position) => (byTurn[index] = shownMarks[position] ?? null));
    return byTurn;
  }, [turns, turnQuests, isHidden]);

  return {
    marks,
    hidden: isHidden,
    card: (index) => {
      const run = runs.starts.get(index);
      if (!run) return null;
      return (
        <TopicProgressCard
          run={run}
          turns={turns}
          topicKey={topicKey}
          openQuests={open.get(run.key)}
          onToggle={(quest) => toggle(run, quest)}
        />
      );
    },
  };
}

function turnHoldsMessage(turn: Turn, messageId: string): boolean {
  return [turn.userEntry, ...turn.allEntries].some(
    (entry) =>
      (entry?.kind === "message" && entry.msg.id === messageId) ||
      (entry?.kind === "tool_msg_group" && entry.firstId === messageId),
  );
}

/** Updates a row shows; older ones roll out as new ones arrive. */
const ROLLING_UPDATES = 4;

/** The card: one row per quest, in the order they first appear in the run. */
export function TopicProgressCard({
  run,
  turns,
  topicKey,
  openQuests,
  onToggle,
}: {
  run: ProgressRun;
  turns: readonly Turn[];
  /** The topic's own key, whose row is the leader's updates in the topic itself. */
  topicKey: string;
  openQuests: ReadonlySet<string> | undefined;
  onToggle: (quest: string) => void;
}) {
  return (
    <section
      className="my-2 overflow-hidden rounded-lg border border-cc-border/70 bg-cc-card/40 font-sans-ui"
      aria-label="Progress of quests running together"
      data-testid="topic-progress-card"
    >
      <div className="px-3 pt-2 text-[11px] uppercase tracking-wide text-cc-muted">Progress</div>
      {run.groups.map((group) => (
        <ProgressRow
          key={group.quest}
          group={group}
          turns={turns}
          ownTopic={group.quest === topicKey}
          open={!!openQuests?.has(group.quest)}
          onToggle={() => onToggle(group.quest)}
        />
      ))}
    </section>
  );
}

function ProgressRow({
  group,
  turns,
  ownTopic,
  open,
  onToggle,
}: {
  group: ProgressGroup;
  turns: readonly Turn[];
  ownTopic: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const quest = useQuestRecord(ownTopic ? null : group.quest);
  const updates = group.turnIndexes.flatMap((index) => turnUpdate(turns[index]!) ?? []);
  const shown = updates.slice(-ROLLING_UPDATES);
  const earlier = updates.length - shown.length;
  const count = group.turnIndexes.length;
  return (
    <div className="border-t border-cc-border/50 px-3 py-2 first-of-type:border-t-0" data-testid="topic-progress-row">
      <div className="flex min-w-0 items-baseline gap-1.5 text-[12.5px]">
        {ownTopic ? (
          <span className="min-w-0 truncate text-cc-fg">In the topic</span>
        ) : (
          <>
            <span className="shrink-0 font-mono-code">
              <QuestInlineLink questId={group.quest} surface="chat-feed" />
            </span>
            <span className="min-w-0 truncate text-cc-fg">{quest?.title ?? ""}</span>
          </>
        )}
      </div>
      {/* The rolling window: the latest few updates, newest last; earlier ones roll out at the top.
          Hidden while the row is open, since its turns then show in the conversation below. */}
      {!open && (
        <ol className="mt-1 flex flex-col gap-1" data-testid="topic-progress-updates">
          {earlier > 0 && <li className="text-[11.5px] leading-5 text-cc-muted/70">+{earlier} earlier</li>}
          {shown.length === 0 && <li className="text-[12.5px] leading-5 text-cc-muted/70">No update yet</li>}
          {shown.map((update) => (
            <li key={update.id} className="flex min-w-0 items-baseline gap-2">
              <span className="min-w-0 flex-1 line-clamp-2 text-[13px] leading-5 text-cc-fg/85">{update.text}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-cc-muted">{update.time}</span>
            </li>
          ))}
        </ol>
      )}
      {count > 1 && (
        <button
          type="button"
          onClick={onToggle}
          className="mt-1 text-[12px] text-cc-primary hover:underline cursor-pointer"
          aria-expanded={open}
          data-testid="topic-progress-toggle"
        >
          {open ? "Hide updates" : `Show all ${count} updates`}
        </button>
      )}
    </div>
  );
}

/** A turn's update: the last text the leader wrote in it, as plain text. */
function turnUpdate(turn: Turn): { id: string; text: string; time: string } | null {
  for (let index = turn.allEntries.length - 1; index >= 0; index--) {
    const entry = turn.allEntries[index]!;
    if (entry.kind !== "message" || entry.msg.role !== "assistant" || entry.msg.parentToolUseId) continue;
    const text = markdownToPlainText(getAssistantVisibleMarkdown(entry.msg)).replace(/\s+/g, " ").trim();
    if (text) return { id: entry.msg.id, text, time: formatMessageTimestamp(entry.msg.timestamp) };
  }
  return null;
}

function turnTimestamp(turn: Turn): number | null {
  for (const entry of [turn.userEntry, ...turn.allEntries]) {
    if (entry?.kind === "message") return entry.msg.timestamp;
  }
  return null;
}

function dayChanges(before: number | null, after: number | null): boolean {
  return before !== null && after !== null && new Date(before).toDateString() !== new Date(after).toDateString();
}
