import { useEffect, useState } from "react";
import type { TopicListResponse, TopicSummary } from "../../../shared/library-topics.js";
import { topicApi } from "../../api/topics.js";

/**
 * The parts of a leader's topic panel around the topic pages (`TopicView`): the per-leader switch
 * and its Scribe's settings, the latest tidying a Scribe did (each with Undo), rename suggestions and
 * a topic's row in the list.
 */

/**
 * A leader's topics switch and settings. Off: an offer to turn topics on (with the quest count once
 * there are about 20). On: Settings opens the pause, the user's grouping instructions for the Scribe,
 * and turning topics off.
 */
export function LeaderSwitches({
  data,
  leaderId,
  act,
}: {
  data: TopicListResponse;
  leaderId: string;
  act: (action: Promise<unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const leader = data.leaders.find((candidate) => candidate.sessionId === leaderId);
  if (!leader) return null;
  if (!leader.enabled) {
    return (
      <div className="border-b border-cc-border px-4 py-3 text-[13px]" data-testid="topic-hint">
        <div className="text-cc-fg">
          {leader.suggest
            ? `#${leader.sessionNum} ${leader.name} has ${leader.questCount} quests. Group them by topic?`
            : "Topics are off for this leader."}
        </div>
        <div className="mt-0.5 text-cc-muted">
          A Scribe keeps a page per topic: where it stands, your decisions, what was made.
        </div>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => act(topicApi.setLeaderEnabled(leader.sessionId, true))}
            className="rounded-md bg-cc-primary px-2.5 py-1 text-white"
          >
            Turn on
          </button>
          {leader.suggest && (
            <button
              type="button"
              onClick={() => act(topicApi.dismissHint(leader.sessionId))}
              className="rounded-md px-2.5 py-1 text-cc-muted hover:bg-cc-hover"
            >
              Not now
            </button>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="border-b border-cc-border px-4 py-2 text-[13px]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="text-cc-primary hover:underline"
      >
        {open ? "Hide settings" : "Settings and grouping"}
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-2.5" data-testid="topic-settings">
          <ScribeInstructionsBox leaderId={leader.sessionId} saved={data.scribe?.instructions ?? ""} act={act} />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!data.scribe?.paused}
              onChange={(event) => act(topicApi.setScribePaused(leader.sessionId, !event.target.checked))}
            />
            <span className="text-cc-fg">Keep pages up to date</span>
            <span className="ml-auto text-cc-muted">
              {data.scribe && data.scribe.budget.limit > 0
                ? `${Math.round((10 * data.scribe.budget.used) / data.scribe.budget.limit)}% of this leader's use today`
                : ""}
            </span>
          </label>
          <button
            type="button"
            onClick={() => act(topicApi.setLeaderEnabled(leader.sessionId, false))}
            className="self-start text-cc-muted hover:text-cc-fg"
          >
            Turn topics off for this leader
          </button>
        </div>
      )}
    </div>
  );
}

/** "How to group my topics": the user's instructions for the Scribe, in their own words. */
function ScribeInstructionsBox({
  leaderId,
  saved,
  act,
}: {
  leaderId: string;
  saved: string;
  act: (action: Promise<unknown>) => void;
}) {
  const [text, setText] = useState(saved);
  useEffect(() => setText(saved), [saved]);
  return (
    <div data-testid="scribe-instructions">
      <label htmlFor={`grouping-${leaderId}`} className="mb-1 block text-[12px] text-cc-muted">
        How to group my topics
      </label>
      <textarea
        id={`grouping-${leaderId}`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={3}
        placeholder="For example: one topic per training run; keep interviews out of topics."
        className="w-full resize-y rounded-lg border border-cc-border bg-cc-card px-2.5 py-1.5 text-base text-cc-fg outline-none placeholder:text-cc-muted focus:border-cc-primary/60 md:text-[13px]"
      />
      {text.trim() !== saved.trim() && (
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" onClick={() => setText(saved)} className="px-2 py-1 text-cc-muted hover:text-cc-fg">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => act(topicApi.setScribeInstructions(leaderId, text))}
            className="rounded-md bg-cc-primary px-2.5 py-1 text-white"
          >
            Save
          </button>
        </div>
      )}
    </div>
  );
}

/** Renames the Scribe suggests for topics the user named: nothing changes until accepted. */
export function RenameSuggestions({ data, act }: { data: TopicListResponse; act: (action: Promise<unknown>) => void }) {
  if (data.suggestions.length === 0) return null;
  return (
    <div className="border-b border-cc-border px-4 py-2 text-[13px]" data-testid="topic-suggestions">
      {data.suggestions.map((suggestion) => (
        <div key={suggestion.id} className="py-1">
          <div className="text-cc-fg">
            Rename “{suggestion.topicName}” to “{suggestion.name}”?
          </div>
          {suggestion.reason && <div className="text-cc-muted">{suggestion.reason}</div>}
          <div className="mt-1 flex gap-2">
            <button
              type="button"
              onClick={() => act(topicApi.answerSuggestion(suggestion.id, true))}
              className="rounded-md bg-cc-primary px-2.5 py-1 text-white"
            >
              Accept
            </button>
            <button
              type="button"
              onClick={() => act(topicApi.answerSuggestion(suggestion.id, false))}
              className="rounded-md px-2.5 py-1 text-cc-muted hover:bg-cc-hover"
            >
              Dismiss
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ChangeList({ data, act }: { data: TopicListResponse; act: (action: Promise<unknown>) => void }) {
  return (
    <div className="border-b border-cc-border px-4 py-2" data-testid="topic-changes">
      {/* Undone changes have nothing left to act on. */}
      {data.changes
        .filter((change) => !change.undone)
        .slice(0, 3)
        .map((change) => (
          <div key={change.id} className="flex items-center gap-2 py-0.5 text-[13px]">
            <span className="min-w-0 flex-1 truncate text-cc-fg">{change.text}</span>
            <button
              type="button"
              onClick={() => act(topicApi.undo(change.id))}
              className="shrink-0 text-cc-primary hover:underline"
            >
              Undo
            </button>
          </div>
        ))}
    </div>
  );
}

export function TopicRow({ topic, selected, onOpen }: { topic: TopicSummary; selected: boolean; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full gap-3 border-b border-cc-border px-4 py-2.5 text-left ${selected ? "bg-cc-active" : "hover:bg-cc-hover"}`}
      data-testid="library-topic-row"
    >
      <span
        className={`w-[3px] shrink-0 self-stretch rounded ${topic.tentative ? "bg-cc-border" : "bg-cc-status-done"}`}
      />
      <span className="min-w-0 flex-1">
        <span className={`flex items-center gap-2 text-[15px] ${topic.tentative ? "text-cc-muted" : "text-cc-fg"}`}>
          <span className="min-w-0 truncate">{topic.name}</span>
          {topic.tentative && (
            <span className="shrink-0 rounded border border-cc-border px-1 text-[11px] text-cc-muted">new</span>
          )}
        </span>
        {topic.summary && <span className="mt-0.5 line-clamp-2 text-[13.5px] text-cc-fg/90">{topic.summary}</span>}
        <span className="mt-0.5 block text-[12.5px] text-cc-muted">
          {topic.questIds.length} quest{topic.questIds.length === 1 ? "" : "s"}
          {topic.pendingEvents ? ` · ${topic.pendingEvents} new` : ""} · {ago(topic.updatedAt)}
        </span>
      </span>
    </button>
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
