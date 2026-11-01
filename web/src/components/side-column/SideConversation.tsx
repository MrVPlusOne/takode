import { sideComposerDraftKey } from "../../draft-sync-bridge.js";
import { api } from "../../api.js";
import { useEffect } from "react";
import { useStore } from "../../store.js";
import { sendToSession } from "../../ws.js";
import { latestThreadWindowRequest } from "../../utils/latest-thread-window-request.js";
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
import { useChatFocused, useChatFocusId } from "../../utils/chat-focus.js";

/**
 * A leader's conversation in the side column: a thread or a quest's thread, with its own message box
 * under it. It reads and sends like the main view, over its leader's connection (which the column
 * holds open, whichever session the main view shows), and what is read there on screen counts as read.
 */
export function SideConversation({ leaderId, threadKey }: { leaderId: string; threadKey: string }) {
  const key = threadKey.toLowerCase();
  const thread = useKnownThreadOfKey(leaderId, isTopicViewKey(key) ? key : "");
  const notifications = useStore((state) => state.sessionNotifications.get(leaderId));
  // A pane that isn't the focused chat reads only what the user scrolls to (chat-focus.ts).
  const focused = useChatFocused(useChatFocusId());
  useUnreadMessagesSeen({
    sessionId: leaderId,
    feedKey: key,
    notifications,
    enabled: true,
    focused,
    onSeen: (notificationId) => void api.markNotificationDone(leaderId, notificationId, true).catch(console.error),
  });
  // A thread opened from this pane opens in it, in place of this conversation; the open-in-side
  // click opens it in the main view.
  const openThread = (next: string) =>
    wantsSideClick()
      ? openInSide({ kind: "conversation", threadKey: next, leaderId })
      : navigateToSessionThread(leaderId, next);
  // A folded conversation got no live messages (the column's open limit unmounts it): opening it
  // again catches its held newest window up, in a delta the server sends against its hash.
  useEffect(() => {
    const held = useStore.getState().threadWindows.get(leaderId)?.get(key);
    if (held && !held.has_newer_items) sendToSession(leaderId, latestThreadWindowRequest(leaderId, key, false));
  }, [key, leaderId]);
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
