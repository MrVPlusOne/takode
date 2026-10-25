import type { TopicSummary } from "../../../shared/library-topics.js";

/**
 * The topic panel's list of a leader's topics on Main: most recent activity first, each with its
 * newest update and how much waits on the user, so Main shows what moved before choosing what to
 * dispatch. Quest tabs open their own topic's page instead.
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
  const line = topic.latestUpdate ?? topic.summary;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full border-b border-cc-border px-4 py-2.5 text-left hover:bg-cc-hover"
      data-testid="library-topic-row"
    >
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[15px] text-cc-fg">{topic.name}</span>
        <span className="shrink-0 text-[12px] text-cc-muted">{ago(topic.activityAt)}</span>
      </span>
      {line && <span className="mt-0.5 line-clamp-2 text-[13.5px] text-cc-fg/80">{stripDate(line)}</span>}
      {topic.waitingOnYou.length > 0 && (
        <span className="mt-1 flex items-center gap-1.5 text-[12.5px] text-[var(--color-cc-phase-accent-amber)]">
          <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--color-cc-phase-accent-amber)]" />
          {topic.waitingOnYou.length} waiting on you
        </span>
      )}
    </button>
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
