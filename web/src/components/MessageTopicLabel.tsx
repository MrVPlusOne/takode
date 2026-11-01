import { useContext, useEffect } from "react";
import { leaderMessageThreadKey, leaderResponseOwnerThreadKey } from "../../shared/leader-thread-response-routing.js";
import { isTopicViewKey } from "../../shared/topic-thread-key.js";
import type { ChatMessage } from "../types.js";
import { loadLeaderNamesOnce, useKnownThreadOfKey, useKnownTopicOfKey } from "../utils/leader-topics.js";
import { openInSide } from "../utils/side-column.js";
import { useQuestRecord } from "./QuestSummaryCard.js";
import { navigateToSessionMessageId } from "../utils/routing.js";
import { normalizeThreadKey } from "../utils/thread-projection.js";
import { NewThreadIcon, TopicIcon } from "./library/library-icons.js";
import { StartedQuestsContext } from "./QuestForkLinks.js";

/**
 * At the top left of a user's message shown in a view it doesn't belong to: the quest thread it
 * belongs to. A message belongs to the quest it was moved into (handed off, or a quest filed from it
 * that continues it), else to the thread it was written in. It is shown elsewhere when written in
 * Main and moved, or attached to another quest's thread. (A message written in another thread is
 * named by its thread header instead, `TopicThreadLabel`.) Tapping the label opens that quest's
 * thread at this message. When the message's "Continued in" row (`ContinuedInLinks`) already names
 * that quest, the label is left out, so the quest shows once (Jiayi, Nov 1).
 */
export function MessageTopicLabel({
  message,
  sessionId,
  currentThreadKey,
}: {
  message: Pick<ChatMessage, "id" | "metadata">;
  sessionId?: string;
  currentThreadKey?: string;
}) {
  const home = useHome(message, currentThreadKey);
  // A message written in a topic's thread is named by its thread header (`MessageThreadHeader`).
  if (!sessionId || !home || !currentThreadKey || isTopicViewKey(home)) return null;
  return <TopicLabel sessionId={sessionId} messageId={message.id} questId={home} view={currentThreadKey} />;
}

/**
 * The quest or topic thread a message belongs to, unless the view on screen is that thread or the
 * message's "Continued in" row names it.
 */
function useHome(message: Pick<ChatMessage, "id" | "metadata">, currentThreadKey?: string): string | null {
  const started = useContext(StartedQuestsContext)?.get(message.id);
  const metadata = message.metadata ?? {};
  const owner = normalizeThreadKey(leaderResponseOwnerThreadKey(metadata) ?? leaderMessageThreadKey(metadata));
  const home =
    owner.startsWith("q-") || isTopicViewKey(owner)
      ? owner
      : (started?.find((quest) => !quest.sideQuest)?.questId ?? null);
  if (!home) return null;
  const thread = normalizeThreadKey(home);
  const view = normalizeThreadKey(currentThreadKey ?? "");
  if (view === thread) return null;
  return started?.some((quest) => normalizeThreadKey(quest.questId) === thread) ? null : thread;
}

/** A message written in a topic's own thread, seen elsewhere (in All, or another view). */
export function TopicThreadLabel({
  sessionId,
  messageId,
  topicKey,
  view,
}: {
  sessionId: string;
  messageId: string;
  topicKey: string;
  view: string;
}) {
  const topic = useKnownTopicOfKey(sessionId, topicKey);
  // A thread the user started shares the key form; it reads by its own name and opens itself.
  const thread = useKnownThreadOfKey(sessionId, topicKey);
  useEffect(() => {
    if (!topic && !thread) loadLeaderNamesOnce(sessionId);
  }, [sessionId, topic, thread]);
  if (thread) {
    return (
      <TopicLabelButton
        thread
        name={thread.name}
        title={`Written in the thread ${thread.name}: open it at this message`}
        onClick={() => navigateToSessionMessageId(sessionId, messageId, { threadKey: thread.key })}
      />
    );
  }
  // Written in a topic's conversation, from before topics became tags: the topic's page opens beside.
  return (
    <TopicLabelButton
      name={topic?.name ?? "Topic"}
      title={topic ? `Written in the topic ${topic.name}: open its page` : "Written in a topic"}
      onClick={() => topic && openInSide({ kind: "topic", topicId: topic.id, leaderId: sessionId })}
    />
  );
}

function TopicLabel({
  sessionId,
  messageId,
  questId,
}: {
  sessionId: string;
  messageId: string;
  questId: string;
  view: string;
}) {
  const quest = useQuestRecord(questId);
  const name = quest?.title ? `${questId} ${quest.title}` : questId;
  return (
    <TopicLabelButton
      quest
      name={name}
      title={`In ${questId}: open it at this message`}
      onClick={() => navigateToSessionMessageId(sessionId, messageId, { threadKey: questId })}
    />
  );
}

/** The label itself: a small topic (or thread) link at the top left of a message bubble. */
export function TopicLabelButton({
  name,
  title,
  onClick,
  thread = false,
  quest = false,
}: {
  name: string;
  title: string;
  onClick: () => void;
  thread?: boolean;
  /** A quest's thread: named without an icon, by its number and title. */
  quest?: boolean;
}) {
  return (
    <div className="mb-1.5 flex min-w-0" data-testid="message-topic-label">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        className="inline-flex min-w-0 items-center gap-1 text-[11px] leading-none text-cc-primary hover:underline"
        title={title}
      >
        {quest ? null : thread ? (
          <NewThreadIcon className="h-3 w-3 shrink-0" />
        ) : (
          <TopicIcon className="h-3 w-3 shrink-0" />
        )}
        <span className="min-w-0 truncate">{name}</span>
      </button>
    </div>
  );
}
