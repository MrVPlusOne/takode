import { useEffect, useState } from "react";
import { useStore } from "../store.js";
import { sendToSession } from "../ws.js";
import { latestThreadWindowRequest } from "./latest-thread-window-request.js";

/** How long a view waits for a merged conversation's messages before switching anyway. */
const DESTINATION_WAIT_MS = 4_000;

/**
 * The conversation a thread became (`destination`: the quest it was handed off to, or the thread
 * it was joined onto), once the browser holds that conversation's messages, else null. A view
 * showing the thread switches to the destination when this returns it, so the switch shows the
 * merged conversation at once instead of a loading page: the thread's own messages stay on screen
 * meanwhile. It asks the server for the destination's newest window when needed, and gives up
 * waiting after a few seconds so a lost answer can't keep the view on the old thread.
 */
export function useReadyThreadDestination(leaderId: string, destination: string | null | undefined): string | null {
  const key = destination?.toLowerCase() ?? "";
  const loaded = useStore((state) => !!key && !!state.threadWindows.get(leaderId)?.get(key));
  const [waitedFor, setWaitedFor] = useState<string | null>(null);
  useEffect(() => {
    if (!key || loaded) return;
    sendToSession(leaderId, latestThreadWindowRequest(leaderId, key, false));
    const timer = setTimeout(() => setWaitedFor(key), DESTINATION_WAIT_MS);
    return () => clearTimeout(timer);
  }, [key, leaderId, loaded]);
  return key && (loaded || waitedFor === key) ? key : null;
}
