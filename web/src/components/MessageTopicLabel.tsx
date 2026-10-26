import { useContext, useEffect } from "react";
import { leaderMessageThreadKey, leaderResponseOwnerThreadKey } from "../../shared/leader-thread-response-routing.js";
import { topicThreadMembers } from "../../shared/topic-thread-key.js";
import type { ChatMessage } from "../types.js";
import { loadLeaderTopics, useKnownQuestTopic } from "../utils/leader-topics.js";
import { navigateToSessionMessageId } from "../utils/routing.js";
import { normalizeThreadKey } from "../utils/thread-projection.js";
import { TopicIcon } from "./library/library-icons.js";
import { StartedQuestsContext } from "./QuestForkLinks.js";

/**
 * At the top left of a user's message shown in a view it doesn't belong to: the topic it belongs
 * to. A message belongs to the quest it was moved into (handed off, or a quest filed from it that
 * continues it), else to the thread it was written in; it is shown elsewhere when written in Main
 * and moved, or attached to another quest's thread. The label is left out where the message is at
 * home: its own quest, a topic conversation holding that quest, or another quest of the same
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
  const questId = useHomeQuest(message, currentThreadKey);
  if (!sessionId || !questId || !currentThreadKey) return null;
  return <TopicLabel sessionId={sessionId} messageId={message.id} questId={questId} view={currentThreadKey} />;
}

/** The quest a message belongs to, unless the view on screen is that quest or a topic holding it. */
function useHomeQuest(message: Pick<ChatMessage, "id" | "metadata">, currentThreadKey?: string): string | null {
  const started = useContext(StartedQuestsContext)?.get(message.id);
  const metadata = message.metadata ?? {};
  const home = leaderResponseOwnerThreadKey(metadata) ?? leaderMessageThreadKey(metadata);
  const questId = home.startsWith("q-") ? home : (started?.find((quest) => !quest.sideQuest)?.questId ?? null);
  if (!questId) return null;
  const quest = normalizeThreadKey(questId);
  const view = normalizeThreadKey(currentThreadKey ?? "");
  return view === quest || topicThreadMembers(view)?.includes(quest) ? null : quest;
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
  // Another quest of the topic on screen: the message is in its topic already.
  if (topic && viewTopic && topic.id === viewTopic.id) return null;
  return (
    <TopicLabelButton
      name={topic ? topic.name : questId}
      title={topic ? `In the topic ${topic.name}: open it at this message` : `In ${questId}: open it at this message`}
      onClick={() => navigateToSessionMessageId(sessionId, messageId, { threadKey: questId, topicView: !!topic })}
    />
  );
}

/** The label itself: a small topic link at the top left of a message bubble. */
export function TopicLabelButton({ name, title, onClick }: { name: string; title: string; onClick: () => void }) {
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
        <TopicIcon className="h-3 w-3 shrink-0" />
        <span className="min-w-0 truncate">{name}</span>
      </button>
    </div>
  );
}
