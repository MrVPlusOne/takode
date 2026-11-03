import { createContext, useContext } from "react";
import { sideComposerDraftKey } from "../draft-sync-bridge.js";

/**
 * A feed shown beside the main one (in the side column) rather than as the conversation on screen,
 * named by its feed key; null for the main feed. A side feed loads its own thread's windows without
 * making them the view the server refreshes for this browser. Jumps and scroll targets name the feed
 * they are for (`requestScrollToMessage`): a jump without a feed key goes to the main feed.
 */
export const SecondaryFeedContext = createContext<string | null>(null);

/** Whether this feed is one beside the main feed. */
export function useSecondaryFeed(): boolean {
  return useContext(SecondaryFeedContext) !== null;
}

/** This feed's key for jumps: null for the main feed. */
export function useFeedKey(): string | null {
  return useContext(SecondaryFeedContext);
}

/** The feed key of a leader's conversation in the side column. */
export function sideConversationFeedKey(leaderId: string, threadKey: string): string {
  return sideComposerDraftKey(leaderId, threadKey);
}

/** The feed key of another session's conversation in the side column. */
export function sideSessionFeedKey(sessionId: string): string {
  return `side-session:${sessionId}`;
}
