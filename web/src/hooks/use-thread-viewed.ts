import { useEffect } from "react";
import { recordViewedTab } from "../utils/view-history.js";
import { useThreadReadOnScreen } from "./use-thread-read-on-screen.js";
import { leaderResultsThreadKey } from "./use-thread-results-read.js";

/**
 * Tells the server that the user viewed one of a leader's threads: the chat showing it stayed
 * focused, with the page visible, for a moment (`THREAD_READ_DWELL_MS`; Jiayi, Nov 10: "focusing on
 * a chat for more than 2 seconds counts as viewing"). The server counts the view as dealing with the
 * thread, so it moves up in the Threads view and on Home on every device. Each time the chat takes
 * focus again counts again. A side-column view also goes into this browser's Recently viewed list,
 * which records the main view's tabs as soon as they open.
 */
export function useThreadViewed({
  leaderId,
  viewKey,
  focused,
  side = false,
}: {
  /** The leader whose thread the chat shows; null when it shows no leader's thread. */
  leaderId: string | null;
  /** What the chat shows: a thread, the leader log (`all`, Main's thread) or Home (`main`, none). */
  viewKey: string;
  focused: boolean;
  side?: boolean;
}): void {
  const threadKey = leaderResultsThreadKey(viewKey);
  const viewed = useThreadReadOnScreen(`${leaderId}:${threadKey}`, focused && !!leaderId && !!threadKey);
  useEffect(() => {
    if (!viewed || !leaderId || !threadKey) return;
    postThreadViewed(leaderId, threadKey).catch((error: unknown) =>
      console.warn("[thread-viewed] could not record the view:", error),
    );
    if (side) recordViewedTab(leaderId, viewKey, Date.now(), { side: true });
  }, [leaderId, side, threadKey, viewKey, viewed]);
}

async function postThreadViewed(leaderId: string, threadKey: string): Promise<void> {
  const response = await fetch(`/api/sessions/${encodeURIComponent(leaderId)}/thread-viewed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ threadKey }),
  });
  if (!response.ok) throw new Error(`thread-viewed returned ${response.status}`);
}
