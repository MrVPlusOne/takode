import { createContext, useContext } from "react";

/**
 * A feed shown beside the main one (in the side column) rather than as the conversation on screen.
 * It loads its own thread's windows without making them the view the server refreshes for this
 * browser, and leaves jumps and scroll targets, which name the main feed's messages, to the main feed.
 */
export const SecondaryFeedContext = createContext(false);

export function useSecondaryFeed(): boolean {
  return useContext(SecondaryFeedContext);
}
