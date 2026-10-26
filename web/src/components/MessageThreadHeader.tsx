import { topicThreadMembers } from "../../shared/topic-thread-key.js";
import { createContext } from "react";
import type { ChatMessage } from "../types.js";
import { leaderMessageThreadKey } from "../../shared/leader-thread-response-routing.js";
import { navigateToSessionMessageId } from "../utils/routing.js";
import { isAllThreadsKey, normalizeThreadKey } from "../utils/thread-projection.js";

/**
 * Set by a row that renders a message's header line itself (answer rows), so
 * the message bubble inside it does not repeat the thread link.
 */
export const MessageThreadHeaderOwnedContext = createContext(false);

/**
 * The one thread a message belongs to (see `leaderMessageThreadKey`). Messages
 * with no thread metadata at all (non-leader sessions) belong to no thread.
 */
export function getMessageThreadKey(message: ChatMessage): string | null {
  const metadata = message.metadata;
  if (!metadata) return null;
  const hasThreadMetadata =
    metadata.threadAnswer?.authoredThreadKey ||
    metadata.threadKey !== undefined ||
    metadata.questId !== undefined ||
    (metadata.threadRefs?.length ?? 0) > 0;
  return hasThreadMetadata ? leaderMessageThreadKey(metadata) : null;
}

/**
 * The thread a message's header should link to while `currentThreadKey` is
 * viewed: the message's own thread, unless that is the viewed thread. Without
 * a single selected thread (All Threads), always the message's own thread.
 */
export function getMessageThreadLinkKey(message: ChatMessage, currentThreadKey?: string): string | null {
  const threadKey = getMessageThreadKey(message);
  if (!threadKey || !currentThreadKey || isAllThreadsKey(currentThreadKey)) return threadKey;
  // In a topic conversation the quest strip in the feed already names each message's quest.
  if (topicThreadMembers(currentThreadKey)?.includes(threadKey)) return null;
  return threadKey === normalizeThreadKey(currentThreadKey) ? null : threadKey;
}

/**
 * Header line of a feed message: a clickable link to the message's thread. With the message's
 * session and ID, it opens that thread at the message, where the reader expects to land.
 */
export function MessageThreadHeader({
  threadKey,
  onSelectThread,
  message,
}: {
  threadKey: string | null;
  onSelectThread?: (threadKey: string) => void;
  message?: { sessionId?: string; id: string };
}) {
  if (!threadKey) return null;
  return (
    <div className="mb-1.5 flex min-w-0" data-testid="message-thread-header">
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (onSelectThread && message?.sessionId) {
            navigateToSessionMessageId(message.sessionId, message.id, { threadKey, preserveMainThreadRoute: true });
          } else onSelectThread?.(threadKey);
        }}
        disabled={!onSelectThread}
        className="cc-thread-link min-w-0 truncate font-mono-code text-[11px] leading-none transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cc-primary/35 disabled:cursor-default disabled:no-underline"
        title={`Open thread:${threadKey}`}
        data-testid="thread-source-badge"
      >
        thread:{threadKey}
      </button>
    </div>
  );
}
