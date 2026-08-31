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

function allowsMutedNeedsInput(session: SdkSessionInfo): boolean {
  if (!hasFreshNotificationSummary(session)) return true;
  if (session.mutedNeedsInputNotificationCount !== undefined) {
    return session.mutedNeedsInputNotificationCount > 0;
  }
  return true;
}

function getSessionLabel(
  sessionId: string,
  sdkSession: SdkSessionInfo,
): {
  sessionName: string;
  sessionNum: number | null;
} {
  return {
    sessionName: sdkSession.name || `Session ${sessionId.slice(0, 8)}`,
    sessionNum: sdkSession.sessionNum ?? null,
  };
}

export function getGlobalNeedsInputEntries(state: GlobalNeedsInputState): GlobalNeedsInputEntry[] {
  return getNeedsInputEntries(state, "active");
}

export function getGlobalMutedNeedsInputEntries(state: GlobalNeedsInputState): GlobalNeedsInputEntry[] {
  return getNeedsInputEntries(state, "muted");
}

function getNeedsInputEntries(state: GlobalNeedsInputState, mode: "active" | "muted"): GlobalNeedsInputEntry[] {
  const sdkById = new Map(state.sdkSessions.map((session) => [session.sessionId, session]));
  const entries: GlobalNeedsInputEntry[] = [];

  for (const [sessionId, notifications] of state.sessionNotifications) {
    const sdkSession = sdkById.get(sessionId);
    const allowed =
      mode === "active"
        ? sdkSession && allowsActiveNeedsInput(sdkSession)
        : sdkSession && allowsMutedNeedsInput(sdkSession);
    if (!sdkSession || sdkSession.archived || !allowed) continue;
    const label = getSessionLabel(sessionId, sdkSession);

    for (const notification of notifications) {
      if (notification.done || notification.category !== "needs-input") continue;
      if (mode === "active" && notification.muted) continue;
      if (mode === "muted" && !notification.muted) continue;
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

export function countGlobalNeedsInputNotifications(state: GlobalNeedsInputState): number {
  return getGlobalNeedsInputEntries(state).length;
}
