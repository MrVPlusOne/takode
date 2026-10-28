import { useEffect, useState } from "react";
import type { TopicSummary } from "../../shared/library-topics.js";
import { topicRowLine } from "./library/topic-search.js";
import { topicApi } from "../api/topics.js";
import { rememberTopicList } from "../utils/leader-topics.js";
import type { GlobalNeedsInputEntry } from "../utils/global-needs-input.js";
import { TopicIcon } from "./library/library-icons.js";
import { TopicQuestionsBadge, useTopicQuestions } from "./library/topic-questions.js";
import { NotifyMeIcon } from "./NotifyMe.js";
import { PhaseDots, type TopicTabStatus } from "./ThreadTabGroups.js";

/**
 * The Topics tab group: the topics of a leader's work, most recent activity first,
 * each with its newest update and its open questions to the user. Tapping one reads the topic as one conversation, and the group stays
 * selected, with that topic marked, while it is on screen.
 */

const REFRESH_MS = 60_000;

/** A leader's topics for its Topics tab group, most recent activity first; empty while topics are off. */
export function useTopicTabTopics(leaderId: string, enabled: boolean, refreshKey: string): TopicSummary[] {
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  useEffect(() => {
    if (!enabled) {
      setTopics([]);
      return;
    }
    let cancelled = false;
    const load = () =>
      topicApi
        .list("", leaderId)
        .then((response) => {
          if (cancelled) return;
          rememberTopicList(leaderId, response.topics);
          setTopics(byActivity(response.topics));
        })
        .catch((error: Error) => console.warn("[library] Could not load the recent topics:", error.message));
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [leaderId, enabled, refreshKey]);
  return topics;
}

function byActivity(topics: TopicSummary[]): TopicSummary[] {
  return [...topics].sort((a, b) => b.activityAt - a.activityAt);
}

/** The group's list: one row per topic, the one on screen marked. */
export function TopicTabList({
  topics,
  currentTopicId,
  onOpen,
  onLeave,
  statusOf,
}: {
  topics: TopicSummary[];
  currentTopicId: string | null;
  onOpen: (topic: TopicSummary) => void;
  /** Called before the list opens a topic or a question, so its host can close. */
  onLeave: () => void;
  /** The topic-first bar: what each topic's quest tabs say (work in progress, unread, watched). */
  statusOf?: (topic: TopicSummary) => TopicTabStatus;
}) {
  const { questionsOf, openQuestion } = useTopicQuestions();
  return (
    <div data-testid="topic-tab-list">
      {topics.map((topic) => (
        <TopicTabRow
          key={topic.id}
          topic={topic}
          current={topic.id === currentTopicId}
          questions={questionsOf(topic.questIds)}
          status={statusOf?.(topic)}
          onOpen={() => {
            onLeave();
            onOpen(topic);
          }}
          onOpenQuestion={(entry) => {
            onLeave();
            openQuestion(entry);
          }}
        />
      ))}
    </div>
  );
}

function TopicTabRow({
  topic,
  current,
  questions,
  status,
  onOpen,
  onOpenQuestion,
}: {
  topic: TopicSummary;
  current: boolean;
  questions: GlobalNeedsInputEntry[];
  status?: TopicTabStatus;
  onOpen: () => void;
  onOpenQuestion: (entry: GlobalNeedsInputEntry) => void;
}) {
  const line = topicRowLine(topic);
  return (
    <div className={current ? "bg-cc-active" : ""} data-testid="topic-tab-row" data-topic={topic.id}>
      <button
        type="button"
        role="menuitem"
        onClick={onOpen}
        aria-current={current ? "true" : undefined}
        className={`flex w-full items-start gap-3 px-4 py-2 text-left ${current ? "" : "hover:bg-cc-hover/40"}`}
      >
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-cc-primary/12 text-cc-primary">
          <TopicIcon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="min-w-0 flex-1 truncate text-[15px] text-cc-fg">{topic.name}</span>
            <span className="shrink-0 text-[12px] text-cc-muted">{ago(topic.activityAt)}</span>
          </span>
          {line && <span className="line-clamp-2 text-[13px] text-cc-fg/80">{line}</span>}
          {status && <TopicStatusLine status={status} />}
        </span>
      </button>
      {/* Beside the row's button, not inside it: it opens the question, not the topic. */}
      <TopicQuestionsBadge questions={questions} onOpen={onOpenQuestion} className="-mt-1 pb-2 pl-14 pr-4" />
    </div>
  );
}

/**
 * What a topic's quests are doing, in one quiet line under its update: work in progress (with the
 * phase colors, a spinner while the leader writes there), unread answers, and Notify Me.
 */
function TopicStatusLine({ status }: { status: TopicTabStatus }) {
  const { inProgress, unread, active, watching } = status;
  if (!inProgress.length && !unread && !active && !watching) return null;
  return (
    <span className="mt-1 flex items-center gap-2.5 text-[12px] text-cc-muted" data-testid="topic-tab-status">
      {(inProgress.length > 0 || active) && (
        <span className="inline-flex items-center gap-1.5">
          {active ? (
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border-[1.5px] border-cc-info/30 border-t-cc-info motion-safe:animate-spin"
            />
          ) : (
            <PhaseDots tabs={inProgress} />
          )}
          {inProgress.length > 0 ? `${inProgress.length} in progress` : "working"}
        </span>
      )}
      {unread > 0 && (
        <span className="inline-flex items-center gap-1 text-cc-info">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-cc-info" />
          {unread} new
        </span>
      )}
      {watching && <NotifyMeIcon pending={false} className="h-3.5 w-3.5" />}
    </span>
  );
}

function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
