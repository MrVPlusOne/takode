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
  const hasSessionStatus = useStore((s) => (sessionId ? s.sessionStatus.has(sessionId) : false));
  const liveStatus = useStore((s) => (sessionId ? (s.sessionStatus.get(sessionId) ?? null) : null));
  const hasCliConnected = useStore((s) => (sessionId ? s.cliConnected.has(sessionId) : false));
  const cliConnected = useStore((s) => (sessionId ? s.cliConnected.get(sessionId) : undefined));
  const disconnectReason = useStore((s) => (sessionId ? s.cliDisconnectReason.get(sessionId) : undefined));
  const permCount = useStore((s) => (sessionId ? (s.pendingPermissions.get(sessionId)?.size ?? 0) : 0));
  const hasUnread = useStore((s) => (sessionId ? !!s.sessionAttention.get(sessionId) : false));

  const hasLiveSession =
    !!sdkSession || hasSessionStatus || hasCliConnected || disconnectReason !== undefined || permCount > 0 || hasUnread;
  if (sessionId && hasLiveSession) {
    return {
      archived: sdkSession?.archived ?? false,
      permCount,
      isConnected: hasCliConnected ? cliConnected === true : (sdkSession?.cliConnected ?? false),
      sdkState: sdkSession?.state ?? null,
      status: hasSessionStatus ? liveStatus : null,
      hasUnread,
      idleKilled: disconnectReason === "idle_limit",
    };
  }

  return fallbackStatus ? participantStatusToDotProps(fallbackStatus) : null;
}
