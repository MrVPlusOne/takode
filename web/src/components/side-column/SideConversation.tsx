import { sideComposerDraftKey } from "../../draft-sync-bridge.js";
import { api } from "../../api.js";
import { useStore } from "../../store.js";
import { useUnreadMessagesSeen } from "../../hooks/use-unread-messages-seen.js";
import { useKnownThreadOfKey } from "../../utils/leader-topics.js";
import { isTopicViewKey } from "../../../shared/topic-thread-key.js";
import { ComposerFeedLayout } from "../ComposerFeedLayout.js";
import { Composer } from "../Composer.js";
import { MessageFeed } from "../MessageFeed.js";
import { SecondaryFeedContext } from "../secondary-feed.js";
import { ComposerTargetContext } from "../composer-target.js";
import { StartedQuestsProvider } from "../QuestForkLinks.js";
import { navigateToSessionThread } from "../../utils/routing.js";
import { openInSide, wantsSideClick } from "../../utils/side-column.js";

/**
 * One of the leader's conversations in the side column: a thread or a quest's thread, with its own
 * message box under it. It reads and sends
 * like the main view, and what is read there on screen counts as read.
 *
 * It may be another leader's (a side chat the user started with that leader from this column,
 * `columnId`): it then reads and sends over that leader's connection, which the column holds open.
 */
export function SideConversation({
  leaderId,
  threadKey,
  columnId = leaderId,
}: {
  leaderId: string;
  threadKey: string;
  columnId?: string;
}) {
  const key = threadKey.toLowerCase();
  const thread = useKnownThreadOfKey(leaderId, isTopicViewKey(key) ? key : "");
  const notifications = useStore((state) => state.sessionNotifications.get(leaderId));
  useUnreadMessagesSeen({
    sessionId: leaderId,
    feedKey: key,
    notifications,
    enabled: true,
    onSeen: (notificationId) => void api.markNotificationDone(leaderId, notificationId, true).catch(console.error),
  });
  // A thread opened from this pane opens in it, in place of this conversation; the open-in-side
  // click opens it in the main view.
  const openThread = (next: string) =>
    wantsSideClick()
      ? openInSide(columnId, { kind: "conversation", threadKey: next, leaderId })
      : navigateToSessionThread(leaderId, next);
  const questId = /^q-\d+$/.test(key) ? key : undefined;
  const draftKey = sideComposerDraftKey(leaderId, key);
  return (
    <SecondaryFeedContext.Provider value={true}>
      {/* What the feed adds to a draft (comments, reply quotes) goes to this conversation's composer. */}
      <ComposerTargetContext.Provider value={draftKey}>
        <ComposerFeedLayout>
          <div className="flex min-h-0 flex-1 flex-col" data-testid="side-conversation" data-thread-key={key}>
            {/* A request here that moved into a quest says where it continues, as in the main view. */}
            <StartedQuestsProvider sessionId={leaderId} enabled refreshKey={key}>
              <MessageFeed sessionId={leaderId} threadKey={key} projectThreadRoutes onSelectThread={openThread} />
            </StartedQuestsProvider>
          </div>
          <Composer
            sessionId={leaderId}
            threadKey={key}
            questId={questId}
            topicName={thread?.name}
            draftKey={draftKey}
            secondary
          />
        </ComposerFeedLayout>
      </ComposerTargetContext.Provider>
    </SecondaryFeedContext.Provider>
  );
}
