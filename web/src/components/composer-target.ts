import { createContext, useContext, useMemo } from "react";
import type { ConversationAnnotation } from "../../shared/conversation-annotations.js";
import { useStore } from "../store.js";
import { MAIN_THREAD_KEY } from "../utils/thread-projection.js";

/**
 * The composer a conversation on screen writes into, by its draft key: the session's main composer
 * (the session ID) unless a provider says otherwise, as a side chat in the side column does. Feeds
 * use it so what they add to a draft (a comment, a reply quote) lands in the composer of the
 * conversation it was made in, not in whichever composer of the session renders first.
 */
export const ComposerTargetContext = createContext<string | undefined>(undefined);

/**
 * The thread the session's main composer is on, for the feed beside it (a leader's main view; other
 * views show one thread and keep the default).
 */
export const ComposerThreadContext = createContext<string>(MAIN_THREAD_KEY);

const NO_COMMENTS: ConversationAnnotation[] = [];

/** The draft key of the composer this part of the screen writes into. */
export function useComposerTarget(sessionId: string): string {
  return useContext(ComposerTargetContext) ?? sessionId;
}

/**
 * The unsent comments of the composer this part of the screen writes into, as that composer shows
 * them (see `commentsShownIn`).
 */
export function useComposerComments(sessionId: string | undefined): ConversationAnnotation[] {
  const draftKey = useComposerTarget(sessionId ?? "");
  const threadKey = useContext(ComposerThreadContext);
  const annotations = useStore((s) => (sessionId ? s.composerDrafts.get(draftKey)?.annotations : undefined));
  return useMemo(
    () => (sessionId ? commentsShownIn(annotations, draftKey === sessionId, threadKey) : NO_COMMENTS),
    [annotations, draftKey, sessionId, threadKey],
  );
}

/**
 * The comments of a draft its composer shows, and sends, in `threadKey`. A session's main draft is one
 * box for every thread of a leader's main view, so its comments carry the thread they were made in
 * and show only there (ones saved before comments named a thread show everywhere). Every other draft
 * belongs to a single conversation and shows all of its comments.
 */
export function commentsShownIn(
  annotations: readonly ConversationAnnotation[] | undefined,
  mainDraft: boolean,
  threadKey: string,
): ConversationAnnotation[] {
  if (!annotations?.length) return NO_COMMENTS;
  if (!mainDraft) return annotations as ConversationAnnotation[];
  const shown = annotations.filter((annotation) => !annotation.threadKey || annotation.threadKey === threadKey);
  return shown.length === annotations.length ? (annotations as ConversationAnnotation[]) : shown;
}
