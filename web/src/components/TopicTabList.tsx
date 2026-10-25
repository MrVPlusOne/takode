import { useEffect, useState } from "react";
import type { TopicSummary } from "../../shared/library-topics.js";
import { topicApi } from "../api/topics.js";
import { TopicIcon } from "./library/library-icons.js";

/**
 * The Topics tab group: the topics of a leader's work, most recent activity first,
 * each with its newest update. Tapping one reads the topic as one conversation, and the group stays
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
        .then((response) => !cancelled && setTopics(byActivity(response.topics)))
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
}: {
  topics: TopicSummary[];
  currentTopicId: string | null;
  onOpen: (topic: TopicSummary) => void;
}) {
  return (
    <div data-testid="topic-tab-list">
      {topics.map((topic) => {
        const current = topic.id === currentTopicId;
        const line = topic.latestUpdate ?? topic.summary;
        return (
          <button
            key={topic.id}
            type="button"
            role="menuitem"
            onClick={() => onOpen(topic)}
            aria-current={current ? "true" : undefined}
            className={`flex w-full items-start gap-3 px-4 py-2 text-left ${current ? "bg-cc-active" : "hover:bg-cc-hover/40"}`}
            data-testid="topic-tab-row"
            data-topic={topic.id}
          >
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-cc-primary/12 text-cc-primary">
              <TopicIcon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-[15px] text-cc-fg">{topic.name}</span>
                <span className="shrink-0 text-[12px] text-cc-muted">{ago(topic.activityAt)}</span>
              </span>
              {line && <span className="line-clamp-2 text-[13px] text-cc-fg/80">{stripDate(line)}</span>}
              {topic.waitingOnYou.length > 0 && (
                <span className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-[var(--color-cc-phase-accent-amber)]">
                  <span
                    aria-hidden="true"
                    className="h-1.5 w-1.5 rounded-full bg-[var(--color-cc-phase-accent-amber)]"
                  />
                  {topic.waitingOnYou.length} waiting on you
                </span>
              )}
            </span>
          </button>
        );
      })}
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
