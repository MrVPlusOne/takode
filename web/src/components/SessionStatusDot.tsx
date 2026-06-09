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
 *   7. scheduled_timer    -> green timer icon, no glow (idle but waiting on timers)
 *   8. idle               -> gray dot, no glow
 */

import { PowerPlugDot } from "./CatIcons.js";
import {
  deriveSessionStatus,
  type SessionVisualStatus,
  type SessionVisualStatusInput,
} from "../utils/session-visual-status.js";

export { deriveSessionStatus, type SessionVisualStatus };

export interface SessionStatusDotProps extends SessionVisualStatusInput {
  className?: string;
}

/** Maps visual status to the rounded dot background color. */
const DOT_CLASS: Record<SessionVisualStatus, string> = {
  archived: "bg-cc-muted/45",
  permission: "bg-amber-400",
  disconnected: "bg-cc-muted/60",
  running: "bg-emerald-500",
  compacting: "bg-emerald-500",
  completed_unread: "bg-blue-500",
  scheduled_timer: "bg-emerald-500",
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
  scheduled_timer: false,
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
  scheduled_timer: "",
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
  scheduled_timer: "Scheduled timer",
  idle: "Idle",
};

export function scheduledTimerStatusLabel(timerCount: number): string {
  return `${timerCount} timer${timerCount === 1 ? "" : "s"}`;
}

export function ScheduledTimerStatusIcon({ timerCount, className }: { timerCount: number; className?: string }) {
  return (
    <span
      data-testid="session-status-timer-icon"
      data-status="scheduled_timer"
      data-count={String(timerCount)}
      title={`${timerCount} scheduled timer${timerCount === 1 ? "" : "s"}`}
      aria-label={`${timerCount} scheduled timer${timerCount === 1 ? "" : "s"}`}
      className={`inline-flex h-3 w-3 shrink-0 self-center items-center justify-center leading-none text-emerald-500 ${
        className ?? ""
      }`}
    >
      <svg viewBox="0 0 16 16" fill="currentColor" className="block h-3 w-3 shrink-0 -translate-y-px">
        <path d="M8 1.75a.75.75 0 01.75.75v.88a4.75 4.75 0 11-1.5 0V2.5A.75.75 0 018 1.75zm0 3A3.25 3.25 0 108 11.25 3.25 3.25 0 008 4.75zm.75 1.5v1.44l1.02.61a.75.75 0 11-.77 1.28L7.62 8.8A.75.75 0 017.25 8V6.25a.75.75 0 011.5 0z" />
      </svg>
    </span>
  );
}

export function SessionStatusDot(props: SessionStatusDotProps) {
  const { className, ...rest } = props;
  const visualStatus = deriveSessionStatus(rest);
  if (visualStatus === "scheduled_timer") {
    return <ScheduledTimerStatusIcon timerCount={rest.activeTimerCount ?? 0} className={className} />;
  }
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
