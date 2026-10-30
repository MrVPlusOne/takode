import { useContext, useEffect } from "react";
import { leaderMessageThreadKey, leaderResponseOwnerThreadKey } from "../../shared/leader-thread-response-routing.js";
import { isKeyOfTopic, isTopicViewKey, topicViewKey } from "../../shared/topic-thread-key.js";
import type { ChatMessage } from "../types.js";
import {
  loadLeaderNamesOnce,
  loadLeaderTopics,
  useKnownQuestTopic,
  useKnownThreadOfKey,
  useKnownTopicOfKey,
} from "../utils/leader-topics.js";
import { navigateToSessionMessageId } from "../utils/routing.js";
import { normalizeThreadKey } from "../utils/thread-projection.js";
import { NewThreadIcon, TopicIcon } from "./library/library-icons.js";
import { StartedQuestsContext } from "./QuestForkLinks.js";

/**
 * At the top left of a user's message shown in a view it doesn't belong to: the topic it belongs
 * to. A message belongs to the quest it was moved into (handed off, or a quest filed from it that
 * continues it), else to the thread it was written in. It is shown elsewhere when written in Main
 * and moved, or attached to another quest's thread. (A message written in a topic's own thread is
 * named by its thread header instead, `TopicThreadLabel`.) The label is left out where the message
 * is at home: its own quest, a topic conversation holding that quest, or another quest of the same
 * topic. Tapping it opens that topic's conversation at this message; before the quest is filed
 * under a topic, the label names the quest and opens it.
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

/** The quest or topic thread a message belongs to, unless the view on screen is that thread. */
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
  return view === thread ? null : thread;
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
  const viewQuest = view.startsWith("q-") ? view : "";
  const viewTopic = useKnownQuestTopic(sessionId, viewQuest);
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
  // In a quest of this topic, the message is in its topic already.
  if (topic && viewTopic && isKeyOfTopic(topicKey, viewTopic.id)) return null;
  return (
    <TopicLabelButton
      name={topic?.name ?? "Topic"}
      title={topic ? `Written in the topic ${topic.name}: open it at this message` : "Written in a topic"}
      onClick={() => navigateToSessionMessageId(sessionId, messageId, { threadKey: topicKey })}
    />
  );
}

function TopicLabel({
  sessionId,
  messageId,
  questId,
  view,
}: {
  sessionId: string;
  messageId: string;
  questId: string;
  view: string;
}) {
  const topic = useKnownQuestTopic(sessionId, questId);
  const viewQuest = view.startsWith("q-") ? view : "";
  const viewTopic = useKnownQuestTopic(sessionId, viewQuest);
  const unknown = [
    ...(topic === undefined ? [questId] : []),
    ...(viewQuest && viewTopic === undefined ? [viewQuest] : []),
  ].join(",");
  useEffect(() => {
    if (!unknown) return;
    loadLeaderTopics(sessionId, unknown.split(",")).catch((error: Error) =>
      console.warn("[library] Could not look up a message's topic:", error.message),
    );
  }, [sessionId, unknown]);
  // The topic on screen, or another quest of it: the message is in its topic already.
  if (topic && (isKeyOfTopic(view, topic.id) || viewTopic?.id.toLowerCase() === topic.id.toLowerCase())) return null;
  return (
    <TopicLabelButton
      name={topic ? topic.name : questId}
      title={topic ? `In the topic ${topic.name}: open it at this message` : `In ${questId}: open it at this message`}
      onClick={() =>
        navigateToSessionMessageId(sessionId, messageId, { threadKey: topic ? topicViewKey(topic.id) : questId })
      }
    />
  );
}

/** The label itself: a small topic (or thread) link at the top left of a message bubble. */
export function TopicLabelButton({
  name,
  title,
  onClick,
  thread = false,
}: {
  name: string;
  title: string;
  onClick: () => void;
  thread?: boolean;
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
        {thread ? <NewThreadIcon className="h-3 w-3 shrink-0" /> : <TopicIcon className="h-3 w-3 shrink-0" />}
        <span className="min-w-0 truncate">{name}</span>
      </button>
    </div>
  );
}
