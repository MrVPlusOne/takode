import { useStore } from "../store.js";
import type { BoardParticipantStatus, SdkSessionInfo, SessionState } from "../types.js";
import { resolveSessionNavigation, type ResolvedSessionNavigation } from "../utils/session-navigation-resolver.js";
import type { SessionStatusDotProps } from "./SessionStatusDot.js";

const EMPTY_SESSION_STATES = new Map<string, SessionState>();

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

export function resolveParticipantSessionStatusDotProps({
  navigation,
  sdkSession,
  hasSessionStatus,
  liveStatus,
  hasCliConnected,
  cliConnected,
  disconnectReason,
  rawPermissionCount,
  hasUnread,
  isCurrentSession,
  liveTimerCount,
  fallbackStatus,
}: {
  navigation: ResolvedSessionNavigation | null;
  sdkSession?: SdkSessionInfo;
  hasSessionStatus: boolean;
  liveStatus: "idle" | "running" | "compacting" | "reverting" | null;
  hasCliConnected: boolean;
  cliConnected?: boolean;
  disconnectReason?: "idle_limit" | "broken" | "recovery_suppressed" | null;
  rawPermissionCount: number;
  hasUnread: boolean;
  isCurrentSession: boolean;
  liveTimerCount: number;
  fallbackStatus?: BoardParticipantStatus["status"];
}): SessionStatusDotProps | null {
  const fallbackProps = fallbackStatus
    ? participantStatusToDotProps(fallbackStatus)
    : liveTimerCount > 0
      ? participantStatusToDotProps("idle")
      : null;
  const projectionOwned = navigation?.projectionState !== "legacy" && navigation !== null;
  const hasLiveSession =
    navigation !== null ||
    hasSessionStatus ||
    hasCliConnected ||
    disconnectReason !== undefined ||
    rawPermissionCount > 0 ||
    hasUnread ||
    liveTimerCount > 0;
  if (!hasLiveSession) return fallbackProps;

  if (projectionOwned) {
    const projected = navigation.sidebarItem;
    return {
      archived: sdkSession?.archived === true,
      permCount: projected.permCount,
      isConnected: projected.isConnected,
      sdkState: projected.sdkState,
      status: projected.status,
      hasUnread,
      idleKilled: projected.idleKilled,
      activeTimerCount: projected.pendingTimerCount,
    };
  }

  const activeTimerCount = isCurrentSession ? liveTimerCount : (sdkSession?.pendingTimerCount ?? 0);
  return {
    archived: sdkSession?.archived ?? fallbackProps?.archived ?? false,
    permCount: rawPermissionCount,
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

export function useParticipantSessionStatusDotProps(
  sessionId: string | null | undefined,
  fallbackStatus?: BoardParticipantStatus["status"],
): SessionStatusDotProps | null {
  const navigation = useStore((s) => {
    if (!sessionId) return null;
    const source = s.sessions ? s : { ...s, sessions: EMPTY_SESSION_STATES };
    return resolveSessionNavigation(source, sessionId);
  });
  const sdkSession = useStore((s) =>
    sessionId ? s.sdkSessions.find((session) => session.sessionId === sessionId) : undefined,
  );
  const hasSessionStatus = useStore((s) => (sessionId ? (s.sessionStatus?.has(sessionId) ?? false) : false));
  const liveStatus = useStore((s) => (sessionId ? (s.sessionStatus?.get(sessionId) ?? null) : null));
  const hasCliConnected = useStore((s) => (sessionId ? (s.cliConnected?.has(sessionId) ?? false) : false));
  const cliConnected = useStore((s) => (sessionId ? s.cliConnected?.get(sessionId) : undefined));
  const disconnectReason = useStore((s) => (sessionId ? s.cliDisconnectReason?.get(sessionId) : undefined));
  const rawPermissionCount = useStore((s) => (sessionId ? (s.pendingPermissions?.get(sessionId)?.size ?? 0) : 0));
  const hasUnread = useStore((s) => (sessionId ? !!s.sessionAttention?.get(sessionId) : false));
  const currentSessionId = useStore((s) => s.currentSessionId);
  const liveTimerCount = useStore((s) => (sessionId ? (s.sessionTimers?.get(sessionId)?.length ?? 0) : 0));

  return resolveParticipantSessionStatusDotProps({
    navigation,
    sdkSession,
    hasSessionStatus,
    liveStatus,
    hasCliConnected,
    cliConnected,
    disconnectReason,
    rawPermissionCount,
    hasUnread,
    isCurrentSession: sessionId === currentSessionId,
    liveTimerCount,
    fallbackStatus,
  });
}
