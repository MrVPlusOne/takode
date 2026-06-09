export type SessionVisualStatus =
  | "archived"
  | "permission"
  | "disconnected"
  | "running"
  | "compacting"
  | "completed_unread"
  | "scheduled_timer"
  | "idle";

export interface SessionVisualStatusInput {
  /** Whether the session is archived */
  archived?: boolean;
  /** Number of pending permission requests */
  permCount: number;
  /** Whether the CLI process is connected */
  isConnected: boolean;
  /** SDK process state */
  sdkState: "starting" | "connected" | "running" | "exited" | null;
  /** Session activity status */
  status: "idle" | "running" | "compacting" | "reverting" | null;
  /** Whether the session has unread results the user hasn't seen */
  hasUnread?: boolean;
  /** Whether the session was killed by the idle manager (shows as idle instead of disconnected) */
  idleKilled?: boolean;
  /** Number of active timers waiting on an otherwise idle session */
  activeTimerCount?: number;
}

/**
 * Derives the visual status from session state fields.
 * Exported for testability.
 */
export function deriveSessionStatus(props: SessionVisualStatusInput): SessionVisualStatus {
  const { archived, permCount, isConnected, sdkState, status, hasUnread, idleKilled, activeTimerCount = 0 } = props;

  if (archived) return "archived";
  if (permCount > 0) return "permission";
  // Disconnected: CLI not connected and not still starting up.
  // isConnected is accurate for all sessions (active via WebSocket, non-active via REST fallback).
  // Sessions killed by idle manager show as "idle" (gray) instead of "disconnected" (red)
  // since they don't need user attention -- they'll relaunch on demand.
  if (!isConnected && sdkState !== "starting") {
    return idleKilled ? "idle" : "disconnected";
  }
  if (status === "running") return "running";
  if (status === "compacting" || status === "reverting") return "compacting";
  if (hasUnread) return "completed_unread";
  if (activeTimerCount > 0) return "scheduled_timer";
  return "idle";
}
