import type { TopicSummary } from "../../../shared/library-topics.js";
import type { GlobalNeedsInputEntry } from "../../utils/global-needs-input.js";
import { TopicQuestionsBadge, useTopicQuestions } from "./topic-questions.js";

/**
 * The topic panel's list of a leader's topics on Main: most recent activity first, each with its
 * newest update and its open questions to the user, so Main shows what moved before choosing what
 * to dispatch. Quest tabs open their own topic's page instead.
 */
export function TopicActivityList({ topics, onOpen }: { topics: TopicSummary[]; onOpen: (id: string) => void }) {
  const { questionsOf, openQuestion } = useTopicQuestions();
  return (
    <div data-testid="topic-activity-list">
      {topics.map((topic) => (
        <LatestRow
          key={topic.id}
          topic={topic}
          questions={questionsOf(topic.questIds)}
          onOpen={() => onOpen(topic.id)}
          onOpenQuestion={openQuestion}
        />
      ))}
    </div>
  );
}

/** A topic with its newest update line, or its description before it has one. */
function LatestRow({
  topic,
  questions,
  onOpen,
  onOpenQuestion,
}: {
  topic: TopicSummary;
  questions: GlobalNeedsInputEntry[];
  onOpen: () => void;
  onOpenQuestion: (entry: GlobalNeedsInputEntry) => void;
}) {
  const line = topic.latestUpdate ?? topic.summary;
  return (
    <div className="border-b border-cc-border" data-testid="library-topic-row">
      <button type="button" onClick={onOpen} className="block w-full px-4 py-2.5 text-left hover:bg-cc-hover">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[15px] text-cc-fg">{topic.name}</span>
          <span className="shrink-0 text-[12px] text-cc-muted">{ago(topic.activityAt)}</span>
        </span>
        {line && <span className="mt-0.5 line-clamp-2 text-[13.5px] text-cc-fg/80">{stripDate(line)}</span>}
      </button>
      <TopicQuestionsBadge questions={questions} onOpen={onOpenQuestion} className="-mt-1 px-4 pb-2.5" />
    </div>
  );
}

/** A History line starts with its date ("Oct 25 · …"); the row shows the time separately. */
function stripDate(line: string): string {
  return line.replace(/^[A-Z][a-z]{2} \d{1,2}(?:\s*(?:-|to)\s*\d{1,2})?\s*·\s*/, "");
}

function ago(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
