import { createContext, type ReactNode } from "react";
import type { ChatMessage } from "../types.js";
import { leaderResponseOriginalThreadKey } from "../../shared/leader-thread-response-routing.js";
import { isAllThreadsKey, normalizeThreadKey } from "../utils/thread-projection.js";

/**
 * Set by a row that renders a message's header line itself (answer rows), so
 * the message bubble inside it does not repeat the thread link.
 */
export const MessageThreadHeaderOwnedContext = createContext(false);

/**
 * The one thread a message belongs to: the thread it was written in.
 * - An answer belongs to the thread it was authored in. Its stored route may be
 *   normalized to Main so the answer can also show in other tabs.
 * - Any other message belongs to its stored route; a message routed only
 *   through thread references belongs to the earliest non-backfill one.
 *   Later references (handoffs) transfer responsibility, and backfill
 *   references only add visibility; neither moves the message.
 * Leader-thread messages without a valid route default to Main. Messages with
 * no thread metadata at all (non-leader sessions) belong to no thread.
 */
export function getMessageThreadKey(message: ChatMessage): string | null {
  const metadata = message.metadata;
  if (!metadata) return null;
  const authored = metadata.threadAnswer?.authoredThreadKey;
  if (authored) return normalizeThreadKey(authored);
  const original = leaderResponseOriginalThreadKey(metadata);
  if (original) return original;
  const firstRoutedRef = metadata.threadRefs?.find((ref) => ref.source !== "backfill");
  const routed = firstRoutedRef ? leaderResponseOriginalThreadKey(firstRoutedRef) : null;
  if (routed) return routed;
  const hasThreadMetadata =
    metadata.threadKey !== undefined || metadata.questId !== undefined || (metadata.threadRefs?.length ?? 0) > 0;
  return hasThreadMetadata ? "main" : null;
}

/**
 * The thread a message's header should link to while `currentThreadKey` is
 * viewed: the message's own thread, unless that is the viewed thread. Without
 * a single selected thread (All Threads), always the message's own thread.
 */
export function getMessageThreadLinkKey(message: ChatMessage, currentThreadKey?: string): string | null {
  const threadKey = getMessageThreadKey(message);
  if (!threadKey || !currentThreadKey || isAllThreadsKey(currentThreadKey)) return threadKey;
  return threadKey === normalizeThreadKey(currentThreadKey) ? null : threadKey;
}

/**
 * Header line of a feed message: a clickable link to the message's thread and,
 * for answers, the answered-message chip. With a chip, both join into one tag.
 */
export function MessageThreadHeader({
  threadKey,
  onSelectThread,
  answerChip,
}: {
  threadKey: string | null;
  onSelectThread?: (threadKey: string) => void;
  answerChip?: ReactNode;
}) {
  if (!threadKey && !answerChip) return null;

  const link = threadKey ? (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onSelectThread?.(threadKey);
      }}
      disabled={!onSelectThread}
      className={`cc-thread-link min-w-0 truncate font-mono-code text-[11px] leading-none transition-colors hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-cc-primary/35 disabled:cursor-default disabled:no-underline ${
        answerChip ? "border-r border-cc-border/60 px-2 py-1" : ""
      }`}
      title={`Open thread:${threadKey}`}
      data-testid="thread-source-badge"
    >
      thread:{threadKey}
    </button>
  ) : null;

  return (
    <div className="mb-1.5 flex min-w-0" data-testid="message-thread-header">
      {answerChip ? (
        <div className="inline-flex min-w-0 max-w-full items-stretch overflow-hidden rounded-md border border-cc-border/60 bg-cc-hover/30">
          {link}
          {answerChip}
        </div>
      ) : (
        link
      )}
    </div>
  );
}
