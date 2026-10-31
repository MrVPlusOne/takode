import type { TopicSummary } from "../../../shared/library-topics.js";
import { topicRowLine } from "./topic-search.js";

/**
 * A leader's topics, for browsing: most recent activity first, each with its newest update. Topics
 * are tags on threads, so nothing here asks for attention; what needs the user is in the leader's
 * status row.
 */
export function TopicActivityList({ topics, onOpen }: { topics: TopicSummary[]; onOpen: (id: string) => void }) {
  return (
    <div data-testid="topic-activity-list">
      {topics.map((topic) => (
        <LatestRow key={topic.id} topic={topic} onOpen={() => onOpen(topic.id)} />
      ))}
    </div>
  );
}

/** A topic with its newest update line, or its description before it has one. */
function LatestRow({ topic, onOpen }: { topic: TopicSummary; onOpen: () => void }) {
  const line = topicRowLine(topic);
  return (
    <div className="border-b border-cc-border" data-testid="library-topic-row">
      <button type="button" onClick={onOpen} className="block w-full px-4 py-2.5 text-left hover:bg-cc-hover">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-[15px] text-cc-fg">{topic.name}</span>
          <span className="shrink-0 text-[12px] text-cc-muted">{ago(topic.activityAt)}</span>
        </span>
        {line && <span className="mt-0.5 line-clamp-2 text-[13.5px] text-cc-fg/80">{line}</span>}
      </button>
    </div>
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
