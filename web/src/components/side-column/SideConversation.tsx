import { sideComposerDraftKey } from "../../draft-sync-bridge.js";
import { useMemo } from "react";
import { api } from "../../api.js";
import { useStore } from "../../store.js";
import { useUnreadMessagesSeen } from "../../hooks/use-unread-messages-seen.js";
import { useKnownThreadOfKey } from "../../utils/leader-topics.js";
import { isTopicViewKey, topicViewKey } from "../../../shared/topic-thread-key.js";
import { useStandaloneTopicConversation } from "../library/TopicConversation.js";
import { ComposerFeedLayout } from "../ComposerFeedLayout.js";
import { Composer } from "../Composer.js";
import { MessageFeed } from "../MessageFeed.js";
import { SecondaryFeedContext } from "../secondary-feed.js";
import { ComposerTargetContext } from "../composer-target.js";
import { TopicFeedContext, type TopicFeed } from "../topic-feed.js";
import { navigateToSessionThread } from "../../utils/routing.js";

/**
 * One of the leader's conversations in the side column: a side chat (a thread the user started),
 * a quest, or a topic's whole conversation, with its own message box under it. It reads and sends
 * like the main view, and what is read there on screen counts as read.
 */
export function SideConversation({ leaderId, threadKey }: { leaderId: string; threadKey: string }) {
  const key = threadKey.toLowerCase();
  const thread = useKnownThreadOfKey(leaderId, isTopicViewKey(key) ? key : "");
  const topic = useStandaloneTopicConversation(leaderId, isTopicViewKey(key) && !thread ? key : "");
  const notifications = useStore((state) => state.sessionNotifications.get(leaderId));
  useUnreadMessagesSeen({
    sessionId: leaderId,
    feedKey: key,
    notifications,
    enabled: true,
    onSeen: (notificationId) => void api.markNotificationDone(leaderId, notificationId, true).catch(console.error),
  });
  // A topic's conversation stitches its quests' threads; opening a quest from it opens it in the main view.
  const topicFeed = useMemo<TopicFeed | null>(
    () =>
      topic
        ? {
            questIds: topic.questIds,
            topicKey: topicViewKey(topic.topicId),
            topicName: topic.name,
            ...(topic.threads ? { threads: topic.threads } : {}),
            openQuest: (questId: string) => navigateToSessionThread(leaderId, questId),
          }
        : null,
    [leaderId, topic],
  );
  const questId = /^q-\d+$/.test(key) ? key : undefined;
  const draftKey = sideComposerDraftKey(leaderId, key);
  return (
    <SecondaryFeedContext.Provider value={true}>
      {/* What the feed adds to a draft (comments, reply quotes) goes to this conversation's composer. */}
      <ComposerTargetContext.Provider value={draftKey}>
        <ComposerFeedLayout>
          <div className="flex min-h-0 flex-1 flex-col" data-testid="side-conversation" data-thread-key={key}>
            <TopicFeedContext.Provider value={topicFeed}>
              <MessageFeed
                sessionId={leaderId}
                threadKey={key}
                projectThreadRoutes
                onSelectThread={(next) => navigateToSessionThread(leaderId, next)}
              />
            </TopicFeedContext.Provider>
          </div>
          <Composer
            sessionId={leaderId}
            threadKey={key}
            questId={questId}
            topicName={thread?.name ?? topic?.name}
            draftKey={draftKey}
            secondary
          />
        </ComposerFeedLayout>
      </ComposerTargetContext.Provider>
    </SecondaryFeedContext.Provider>
  );
}
