import { createContext, type ReactNode } from "react";
import type { ChatMessage } from "../types.js";
import { isAllThreadsKey, normalizeThreadKey } from "../utils/thread-projection.js";

/**
 * Set by a row that renders a message's header line itself (answer rows), so
 * the message bubble inside it does not repeat the thread link.
 */
export const MessageThreadHeaderOwnedContext = createContext(false);

type ThreadLinkCandidate = {
  threadKey: string;
  source?: NonNullable<NonNullable<ChatMessage["metadata"]>["threadRefs"]>[number]["source"];
};

function threadLinkCandidates(message: ChatMessage): ThreadLinkCandidate[] {
  const metadata = message.metadata;
  if (!metadata) return [];
  const candidates: ThreadLinkCandidate[] = [];
  const add = (threadKey: string | undefined, source?: ThreadLinkCandidate["source"]) => {
    const normalized = threadKey?.trim();
    if (!normalized) return;
    candidates.push(source ? { threadKey: normalized, source } : { threadKey: normalized });
  };
  add(metadata.threadKey);
  add(metadata.questId);
  for (const ref of metadata.threadRefs ?? []) {
    add(ref.threadKey, ref.source);
  }
  return candidates;
}

/**
 * The thread a message's header should link to while `currentThreadKey` is
 * viewed: another thread the message belongs to, or its backfilled source.
 * Without a single selected thread (All Threads), the message's own thread.
 */
export function getMessageThreadLinkKey(message: ChatMessage, currentThreadKey?: string): string | null {
  const candidates = threadLinkCandidates(message);
  const fallback = candidates[0]?.threadKey ?? null;
  if (!currentThreadKey || isAllThreadsKey(currentThreadKey)) return fallback;

  const normalizedCurrentThread = normalizeThreadKey(currentThreadKey);
  const crossThreadCandidate = candidates.find(
    (candidate) => normalizeThreadKey(candidate.threadKey) !== normalizedCurrentThread,
  );
  if (crossThreadCandidate) return crossThreadCandidate.threadKey;

  const backfillCandidate = candidates.find((candidate) => candidate.source === "backfill");
  return backfillCandidate?.threadKey ?? null;
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
