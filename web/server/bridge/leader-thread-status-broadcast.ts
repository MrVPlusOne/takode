import type { BrowserIncomingMessage } from "../session-types.js";
import { browserThreadStatus } from "../../shared/thread-status-marker.js";
import { setLeaderThreadStatusChangeListener } from "./thread-routing-reminder.js";

interface LeaderThreadStatusBroadcastBridge<Session> {
  getSession(sessionId: string): Session | undefined;
  broadcastToBrowsers(session: Session, message: BrowserIncomingMessage): void;
  getSyncedProjectionController(): { invalidateLeaderThreadTabsForSession(sessionId: string): boolean };
}

/**
 * Sends every change of a leader's thread statuses to its browsers as it happens: a feed shows
 * its thread's status, which its window brings when the feed opens. The status row's tabs take
 * theirs from the thread-tabs projection, refreshed here too.
 */
export function installLeaderThreadStatusBroadcast<Session>(bridge: LeaderThreadStatusBroadcastBridge<Session>): void {
  setLeaderThreadStatusChangeListener((sessionId, changes) => {
    const session = bridge.getSession(sessionId);
    if (!session) return;
    for (const { threadKey, status } of changes) {
      bridge.broadcastToBrowsers(session, {
        type: "leader_thread_status",
        thread_key: threadKey,
        status: status ? browserThreadStatus(status) : null,
      });
    }
    bridge.getSyncedProjectionController().invalidateLeaderThreadTabsForSession(sessionId);
  });
}
