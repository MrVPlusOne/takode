import { useState } from "react";
import { topicApi } from "../api/topics.js";
import { reloadLeaderThreads } from "../utils/leader-topics.js";
import { useThreadPlace } from "./side-column/thread-names.js";

/**
 * The marker in a leader's thread `threadKey` where the messages of `joinedFrom`, a thread the
 * Scribe joined onto it, begin. Undo makes `joinedFrom` a thread of its own again. `movedFrom`: the
 * Scribe had joined it onto that conversation by mistake and moved it here.
 */
export function JoinedThreadMarker({
  sessionId,
  threadKey,
  joinedFrom,
  movedFrom,
}: {
  sessionId: string;
  threadKey: string;
  joinedFrom: string;
  movedFrom?: string;
}) {
  const earlier = useThreadPlace(sessionId, threadKey);
  const previous = useThreadPlace(sessionId, movedFrom ?? threadKey);
  const [undoing, setUndoing] = useState(false);
  const undo = () => {
    setUndoing(true);
    topicApi
      .unjoinThread(sessionId, joinedFrom)
      .then(() => reloadLeaderThreads(sessionId))
      .catch((error: Error) => {
        console.error("[threads] Could not undo the join:", error.message);
        setUndoing(false);
      });
  };
  return (
    <ThreadJoinMarker
      earlierName={earlier.name}
      {...(movedFrom ? { movedFromName: previous.name } : {})}
      onUndo={undoing ? undefined : undo}
    />
  );
}

/**
 * Where a thread the Scribe joined onto the conversation it continues begins: the earlier
 * conversation's messages sit above, this thread's below. The line names the earlier one and who
 * joined them, with Undo for a wrong join.
 */
export function ThreadJoinMarker({
  earlierName,
  joinedBy = "the Scribe",
  movedFromName,
  onUndo,
}: {
  earlierName: string;
  joinedBy?: string;
  /** The conversation the Scribe had joined it onto by mistake, before moving it here. */
  movedFromName?: string;
  onUndo?: () => void;
}) {
  return (
    <div className="my-3 flex items-center gap-3 px-2 text-[12px] text-cc-muted" data-testid="thread-join-marker">
      <span className="h-px flex-1 bg-cc-border" />
      <span className="flex min-w-0 items-center gap-1.5">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4 3v5a3 3 0 0 0 3 3h6M10 8l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="min-w-0 truncate">
          Continues <span className="text-cc-fg">“{earlierName}”</span> · joined by {joinedBy}
          {movedFromName && <span data-testid="thread-join-moved-from"> · moved from “{movedFromName}”</span>}
        </span>
        {onUndo && (
          <button type="button" onClick={onUndo} className="shrink-0 text-cc-primary hover:underline">
            Undo
          </button>
        )}
      </span>
      <span className="h-px flex-1 bg-cc-border" />
    </div>
  );
}
