import { useEffect, useState } from "react";
import type { TopicListResponse } from "../../../shared/library-topics.js";
import { topicApi } from "../../api/topics.js";

/**
 * The parts of a leader's topic panel around the topic pages (`TopicView`): the offer to turn
 * topics on, the topic settings, recent changes to the topics (each with Undo) and rename
 * suggestions.
 */

/**
 * What a leader's panel shows while its topics are off: turned off for this leader (with Turn on),
 * or for every leader in Settings. Null while they are on, which is the default.
 */
export function TopicsOffHint({
  data,
  leaderId,
  act,
}: {
  data: TopicListResponse;
  leaderId: string;
  act: (action: Promise<unknown>) => void;
}) {
  const leader = data.leaders.find((candidate) => candidate.sessionId === leaderId);
  if (!leader || leader.enabled) return null;
  return (
    <div className="border-b border-cc-border px-4 py-3 text-[13px]" data-testid="topic-hint">
      <div className="text-cc-fg">
        {leader.offInSettings ? "Library topics are off for leaders in Settings." : "Topics are off for this leader."}
      </div>
      <div className="mt-0.5 text-cc-muted">
        A Scribe keeps a page per topic: where it stands, your decisions, what was made.
      </div>
      {!leader.offInSettings && (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={() => act(topicApi.setLeaderEnabled(leader.sessionId, true))}
            className="rounded-md bg-cc-primary px-2.5 py-1 text-white"
          >
            Turn on
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * A leader's topic settings, opened from the panel header's gear: the user's instructions for the
 * Scribe, the pause, and turning topics off.
 */
export function TopicSettings({
  data,
  leaderId,
  act,
  onClose,
}: {
  data: TopicListResponse;
  leaderId: string;
  act: (action: Promise<unknown>) => void;
  onClose: () => void;
}) {
  return (
    <div className="border-b border-cc-border bg-cc-card px-4 py-3 text-[13px]" data-testid="topic-settings">
      <div className="mb-2 flex items-center">
        <h3 className="flex-1 font-medium text-cc-fg">Topic settings</h3>
        <button type="button" onClick={onClose} className="text-cc-primary hover:underline">
          Done
        </button>
      </div>
      <div className="flex flex-col gap-2.5">
        <ScribeInstructionsBox leaderId={leaderId} saved={data.scribe?.instructions ?? ""} act={act} />
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={!data.scribe?.paused}
            onChange={(event) => act(topicApi.setScribePaused(leaderId, !event.target.checked))}
          />
          <span className="text-cc-fg">Keep pages up to date</span>
        </label>
        <button
          type="button"
          onClick={() => {
            onClose();
            act(topicApi.setLeaderEnabled(leaderId, false));
          }}
          className="self-start text-cc-muted hover:text-cc-fg"
        >
          Turn topics off for this leader
        </button>
      </div>
    </div>
  );
}

/** The user's lasting instructions for the Scribe (grouping, what pages show), in their own words. */
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
        Instructions for the Scribe
      </label>
      <textarea
        id={`grouping-${leaderId}`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={3}
        placeholder="For example: one topic per training run; keep links to the newest report at the top of its page."
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

/**
 * Recent changes to the topics (mostly a Scribe's tidying), folded into one line so they don't
 * crowd the list: Show lists them with Undo, Dismiss puts them away. The server drops undone ones
 * and those older than a day.
 */
export function ChangeList({ data, act }: { data: TopicListResponse; act: (action: Promise<unknown>) => void }) {
  const [open, setOpen] = useState(false);
  const changes = data.changes;
  if (changes.length === 0) return null;
  return (
    <div className="border-b border-cc-border px-4 py-1.5 text-[13px]" data-testid="topic-changes">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="min-w-0 flex-1 truncate text-left text-cc-muted hover:text-cc-fg"
        >
          {open ? "▾" : "›"} {changes.length === 1 ? "1 recent change" : `${changes.length} recent changes`} to topics
        </button>
        <button
          type="button"
          onClick={() => act(topicApi.dismissChanges(changes.map((change) => change.id)))}
          className="shrink-0 text-cc-muted hover:text-cc-fg"
          title="Keep these changes and stop showing them"
        >
          Dismiss
        </button>
      </div>
      {open &&
        changes.map((change) => (
          <div key={change.id} className="flex items-center gap-2 py-0.5 pl-3.5">
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
