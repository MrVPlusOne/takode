import { useMemo } from "react";
import { topicViewKey } from "../../shared/topic-thread-key.js";
import { topicApi } from "../api/topics.js";
import { useStore } from "../store.js";
import { reloadLeaderThreads, rememberThreads, useLeaderThreads } from "../utils/leader-topics.js";
import { resolveNotificationOwnerThreadKey } from "../utils/notification-thread.js";
import { navigateToSessionThread } from "../utils/routing.js";
import { normalizeThreadKey } from "../utils/thread-projection.js";
import { Composer } from "./Composer.js";
import { LeaderOverview, useLeaderOverview } from "./overview/LeaderOverview.js";
import { threadNameFromMessage } from "./side-column/thread-names.js";
import { ThreadsList } from "./ThreadsMenu.js";
import { useTopicTabTopics } from "./TopicTabList.js";
import { sideComposerDraftKey } from "../draft-sync-bridge.js";

/**
 * A leader's Home, where its Main conversation was: what needs the user, what runs and the topics
 * (the leader's overview, at full width), then its threads, over a message box that starts a new
 * thread, which then opens here. Main's own messages are in the leader log; anything the user should
 * read lives in a thread or a quest.
 */
export function LeaderHomePage({ leaderId }: { leaderId: string }) {
  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="leader-home">
        <div className="mx-auto w-full max-w-3xl px-3 py-4 sm:px-6">
          <HomeOverview leaderId={leaderId} />
          <HomeThreads leaderId={leaderId} />
        </div>
      </div>
      <NewThreadComposer leaderId={leaderId} />
    </>
  );
}

/**
 * The message box of a leader's Home and leader log: what you write starts a new thread with the
 * leader (named after its first words until the leader names it), which then opens in the main view.
 */
export function NewThreadComposer({ leaderId }: { leaderId: string }) {
  const newThread = useMemo(
    () => ({
      start: async (text: string) => {
        const { thread } = await topicApi.startThread(
          leaderId,
          threadNameFromMessage(text),
          undefined,
          text.slice(0, 400),
        );
        rememberThreads(leaderId, [thread], false);
        return thread.key;
      },
      started: (threadKey: string) => navigateToSessionThread(leaderId, threadKey),
    }),
    [leaderId],
  );
  return (
    <Composer
      sessionId={leaderId}
      threadKey="main"
      draftKey={sideComposerDraftKey(leaderId, "home")}
      newThread={newThread}
    />
  );
}

function HomeOverview({ leaderId }: { leaderId: string }) {
  const overview = useLeaderOverview(leaderId);
  const topics = useTopicTabTopics(leaderId, true, "");
  return (
    <section className="overflow-hidden rounded-xl border border-cc-border bg-cc-card">
      <LeaderOverview
        data={overview}
        topics={topics}
        onOpenQuest={(questId) => navigateToSessionThread(leaderId, questId)}
        onOpenTopic={(topic) => navigateToSessionThread(leaderId, topicViewKey(topic.id))}
      />
    </section>
  );
}

function HomeThreads({ leaderId }: { leaderId: string }) {
  const threads = useLeaderThreads(leaderId, true);
  const notifications = useStore((state) => state.sessionNotifications.get(leaderId));
  const count = (category: string, threadKey: string) =>
    (notifications ?? []).filter(
      (notification) =>
        notification.category === category &&
        !notification.done &&
        resolveNotificationOwnerThreadKey(notification) === normalizeThreadKey(threadKey),
    ).length;
  return (
    <section
      className="mt-4 overflow-hidden rounded-xl border border-cc-border bg-cc-card"
      data-testid="leader-home-threads"
    >
      <div className="px-4 pt-3 text-[13px] text-cc-fg">Threads</div>
      <ThreadsList
        menu={{
          threads,
          onOpen: (threadKey) => navigateToSessionThread(leaderId, threadKey),
          onRemove: (threadKey) => {
            const thread = threads.find((candidate) => candidate.key === threadKey);
            if (!thread) return;
            topicApi
              .removeThread(thread.id)
              .catch((error: Error) => console.warn("[leader-home] Could not remove the thread:", error.message))
              .finally(() => reloadLeaderThreads(leaderId));
          },
          unread: (threadKey) => count("review", threadKey),
          questions: (threadKey) => count("needs-input", threadKey),
        }}
        currentKey=""
        writingKey={null}
      />
    </section>
  );
}
