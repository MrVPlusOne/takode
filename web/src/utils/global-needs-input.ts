import type { SdkSessionInfo, SessionNotification } from "../types.js";

export interface GlobalNeedsInputEntry {
  sessionId: string;
  sessionName: string;
  sessionNum: number | null;
  notification: SessionNotification;
}

export interface GlobalNeedsInputState {
  sessionNotifications: Map<string, SessionNotification[]>;
  sdkSessions: SdkSessionInfo[];
  sessionNames: Map<string, string>;
}

function hasFreshNotificationSummary(session: SdkSessionInfo): boolean {
  return session.notificationStatusVersion !== undefined || session.notificationStatusUpdatedAt !== undefined;
}

function allowsActiveNeedsInput(session: SdkSessionInfo): boolean {
  if (!hasFreshNotificationSummary(session)) return true;
  if (session.activeNeedsInputNotificationCount !== undefined) {
    return session.activeNeedsInputNotificationCount > 0;
  }
  if (session.notificationUrgency !== undefined) {
    return session.notificationUrgency === "needs-input";
  }
  if (session.activeNotificationCount !== undefined) {
    return session.activeNotificationCount > 0;
  }
  return true;
}

function getSessionLabel({
  sessionId,
  sdkSession,
  sessionName,
}: {
  sessionId: string;
  sdkSession: SdkSessionInfo | undefined;
  sessionName: string | undefined;
}): { sessionName: string; sessionNum: number | null } {
  return {
    sessionName: sessionName || sdkSession?.name || `Session ${sessionId.slice(0, 8)}`,
    sessionNum: sdkSession?.sessionNum ?? null,
  };
}

export function getGlobalNeedsInputEntries(state: GlobalNeedsInputState): GlobalNeedsInputEntry[] {
  const sdkById = new Map(state.sdkSessions.map((session) => [session.sessionId, session]));
  const entries: GlobalNeedsInputEntry[] = [];

  for (const [sessionId, notifications] of state.sessionNotifications) {
    const sdkSession = sdkById.get(sessionId);
    if (!sdkSession || sdkSession.archived || !allowsActiveNeedsInput(sdkSession)) continue;
    const label = getSessionLabel({
      sessionId,
      sdkSession,
      sessionName: state.sessionNames.get(sessionId),
    });

    for (const notification of notifications) {
      if (notification.done || notification.category !== "needs-input") continue;
      entries.push({
        sessionId,
        sessionName: label.sessionName,
        sessionNum: label.sessionNum,
        notification,
      });
    }
  }

  entries.sort((a, b) => b.notification.timestamp - a.notification.timestamp);
  return entries;
}

export function countGlobalNeedsInputNotifications(
  state: Pick<GlobalNeedsInputState, "sessionNotifications" | "sdkSessions">,
): number {
  return getGlobalNeedsInputEntries({ ...state, sessionNames: new Map() }).length;
}
