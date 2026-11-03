import { useEffect } from "react";
import { holdSessionConnection } from "../../ws.js";
import { ComposerFeedLayout } from "../ComposerFeedLayout.js";
import { Composer } from "../Composer.js";
import { MessageFeed } from "../MessageFeed.js";
import { SecondaryFeedContext, sideSessionFeedKey } from "../secondary-feed.js";

/**
 * Another session's conversation in the side column (a worker's, opened from its session link),
 * with its message box. It stays connected while shown here, whatever the main view shows.
 */
export function SideSession({ sessionId }: { sessionId: string }) {
  useEffect(() => holdSessionConnection(sessionId), [sessionId]);
  return (
    <SecondaryFeedContext.Provider value={sideSessionFeedKey(sessionId)}>
      <ComposerFeedLayout>
        <div className="flex min-h-0 flex-1 flex-col" data-testid="side-session" data-session-id={sessionId}>
          <MessageFeed sessionId={sessionId} />
        </div>
        <Composer sessionId={sessionId} secondary />
      </ComposerFeedLayout>
    </SecondaryFeedContext.Provider>
  );
}
