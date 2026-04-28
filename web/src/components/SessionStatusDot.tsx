/**
 * SessionStatusDot — a small indicator showing the current state of a session.
 *
 * Status priority (highest to lowest):
 *   1. archived          -> gray dot, no glow
 *   2. permission         -> amber dot, breathing glow (needs user action)
 *   3. disconnected       -> gray power plug, no glow
 *   4. running            -> green dot, breathing glow (agent actively working)
 *   5. compacting         -> green dot, breathing glow (context compaction)
 *   6. completed_unread   -> blue dot, no glow (agent finished, user hasn't checked)
 *   7. idle               -> gray dot, no glow
 */

import { PowerPlugDot } from "./CatIcons.js";

export type SessionVisualStatus =
  | "archived"
  | "permission"
  | "disconnected"
  | "running"
  | "compacting"
  | "completed_unread"
  | "idle";

export interface SessionStatusDotProps {
  className?: string;
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
}

/**
 * Derives the visual status from session state fields.
 * Exported for testability.
 */
export function deriveSessionStatus(props: SessionStatusDotProps): SessionVisualStatus {
  const { archived, permCount, isConnected, sdkState, status, hasUnread, idleKilled } = props;

  if (archived) return "archived";
  if (permCount > 0) return "permission";
  // Disconnected: CLI not connected and not still starting up.
  // isConnected is accurate for all sessions (active via WebSocket, non-active via REST fallback).
  // Sessions killed by idle manager show as "idle" (gray) instead of "disconnected" (red)
  // since they don't need user attention — they'll relaunch on demand.
  if (!isConnected && sdkState !== "starting") {
    return idleKilled ? "idle" : "disconnected";
  }
  if (status === "running") return "running";
  if (status === "compacting" || status === "reverting") return "compacting";
  if (hasUnread) return "completed_unread";
  return "idle";
}

/** Maps visual status to the rounded dot background color. */
const DOT_CLASS: Record<SessionVisualStatus, string> = {
  archived: "bg-cc-muted/45",
  permission: "bg-amber-400",
  disconnected: "bg-cc-muted/60",
  running: "bg-emerald-500",
  compacting: "bg-emerald-500",
  completed_unread: "bg-blue-500",
  idle: "bg-cc-muted/50",
};

/** Maps visual status to whether the dot should have a breathing glow */
const SHOULD_GLOW: Record<SessionVisualStatus, boolean> = {
  archived: false,
  permission: true,
  disconnected: false,
  running: true,
  compacting: true,
  completed_unread: false,
  idle: false,
};

/**
 * Maps visual status to the CSS color for drop-shadow glow.
 * Only entries where SHOULD_GLOW is true need a value.
 */
const GLOW_COLOR: Record<SessionVisualStatus, string> = {
  archived: "",
  permission: "rgba(245, 158, 11, 0.6)", // amber
  disconnected: "",
  running: "rgba(34, 197, 94, 0.6)", // green
  compacting: "rgba(34, 197, 94, 0.6)", // green
  completed_unread: "",
  idle: "",
};

/** Maps visual status to an accessible label */
const STATUS_LABEL: Record<SessionVisualStatus, string> = {
  archived: "Archived",
  permission: "Waiting for permission",
  disconnected: "Disconnected",
  running: "Running",
  compacting: "Compacting context",
  completed_unread: "Completed — needs review",
  idle: "Idle",
};

export function SessionStatusDot(props: SessionStatusDotProps) {
  const { className, ...rest } = props;
  const visualStatus = deriveSessionStatus(rest);
  const showGlow = SHOULD_GLOW[visualStatus];
  const glowColor = GLOW_COLOR[visualStatus];
  const label = STATUS_LABEL[visualStatus];

  // Use CSS filter drop-shadow for glow so the compact dot stays crisp.
  const glowStyle: React.CSSProperties | undefined = showGlow
    ? {
        ["--glow-color" as string]: glowColor,
        animation: "yarn-glow-breathe 2s ease-in-out infinite",
      }
    : undefined;

  const isDisconnected = visualStatus === "disconnected";

  return (
    <div
      className={`relative inline-flex h-2.5 w-2.5 shrink-0 items-center justify-center ${className ?? "mt-[7px]"}`}
      title={label}
      aria-label={label}
      data-testid="session-status-dot"
      data-status={visualStatus}
      style={glowStyle}
    >
      {isDisconnected ? (
        <PowerPlugDot className="block h-2.5 w-2.5 text-cc-muted/60" />
      ) : (
        <span className={`block h-2 w-2 rounded-full ${DOT_CLASS[visualStatus]}`} />
      )}
    </div>
  );
}
