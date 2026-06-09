import { useStore } from "../store.js";
import type { BoardParticipantStatus } from "../types.js";
import type { SessionStatusDotProps } from "./SessionStatusDot.js";

export function participantStatusToDotProps(status: BoardParticipantStatus["status"]): SessionStatusDotProps {
  if (status === "archived") {
    return { archived: true, permCount: 0, isConnected: false, sdkState: "exited", status: null };
  }
  if (status === "disconnected") {
    return { permCount: 0, isConnected: false, sdkState: "exited", status: null };
  }
  if (status === "running") {
    return { permCount: 0, isConnected: true, sdkState: "running", status: "running" };
  }
  return { permCount: 0, isConnected: true, sdkState: "connected", status: "idle" };
}

export function useParticipantSessionStatusDotProps(
  sessionId: string | null | undefined,
  fallbackStatus?: BoardParticipantStatus["status"],
): SessionStatusDotProps | null {
  const sdkSession = useStore((s) =>
    sessionId ? s.sdkSessions.find((session) => session.sessionId === sessionId) : null,
  );
  const hasSessionStatus = useStore((s) => (sessionId ? (s.sessionStatus?.has(sessionId) ?? false) : false));
  const liveStatus = useStore((s) => (sessionId ? (s.sessionStatus?.get(sessionId) ?? null) : null));
  const hasCliConnected = useStore((s) => (sessionId ? (s.cliConnected?.has(sessionId) ?? false) : false));
  const cliConnected = useStore((s) => (sessionId ? s.cliConnected?.get(sessionId) : undefined));
  const disconnectReason = useStore((s) => (sessionId ? s.cliDisconnectReason?.get(sessionId) : undefined));
  const permCount = useStore((s) => (sessionId ? (s.pendingPermissions?.get(sessionId)?.size ?? 0) : 0));
  const hasUnread = useStore((s) => (sessionId ? !!s.sessionAttention?.get(sessionId) : false));
  const currentSessionId = useStore((s) => s.currentSessionId);
  const liveTimerCount = useStore((s) => (sessionId ? (s.sessionTimers?.get(sessionId)?.length ?? 0) : 0));

  const hasLiveSession =
    !!sdkSession ||
    hasSessionStatus ||
    hasCliConnected ||
    disconnectReason !== undefined ||
    permCount > 0 ||
    hasUnread ||
    liveTimerCount > 0;
  if (sessionId && hasLiveSession) {
    const activeTimerCount = sessionId === currentSessionId ? liveTimerCount : (sdkSession?.pendingTimerCount ?? 0);
    const fallbackProps = fallbackStatus
      ? participantStatusToDotProps(fallbackStatus)
      : liveTimerCount > 0
        ? participantStatusToDotProps("idle")
        : null;
    return {
      archived: sdkSession?.archived ?? fallbackProps?.archived ?? false,
      permCount,
      isConnected: hasCliConnected
        ? cliConnected === true
        : (sdkSession?.cliConnected ?? fallbackProps?.isConnected ?? false),
      sdkState: sdkSession?.state ?? fallbackProps?.sdkState ?? null,
      status: hasSessionStatus ? liveStatus : (fallbackProps?.status ?? null),
      hasUnread,
      idleKilled: disconnectReason === "idle_limit",
      activeTimerCount: activeTimerCount || liveTimerCount,
    };
  }

  return fallbackStatus ? participantStatusToDotProps(fallbackStatus) : null;
}
