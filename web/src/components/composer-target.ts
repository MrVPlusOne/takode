import { createContext, useContext } from "react";

/**
 * The composer a conversation on screen writes into, by its draft key: the session's main composer
 * (the session ID) unless a provider says otherwise, as a side chat in the side column does. Feeds
 * use it so what they add to a draft (a comment, a reply quote) lands in the composer of the
 * conversation it was made in, not in whichever composer of the session renders first.
 */
export const ComposerTargetContext = createContext<string | undefined>(undefined);

/** The draft key of the composer this part of the screen writes into. */
export function useComposerTarget(sessionId: string): string {
  return useContext(ComposerTargetContext) ?? sessionId;
}
