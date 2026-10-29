import type { ReactNode } from "react";
import { useStore } from "../store.js";
import type { BoardParticipantStatus } from "../types.js";
import { SessionInlineLink } from "./SessionInlineLink.js";
import { SessionRoleIcon } from "./SessionRoleLabel.js";
import { SessionStatusDot } from "./SessionStatusDot.js";
import { useParticipantSessionStatusDotProps } from "./session-participant-status.js";
import { NotifyMeControl } from "./NotifyMe.js";
import { openConversationInSide, openInSideClickLabel } from "../utils/side-column.js";

const BUTTON_CLASS =
  "inline-flex min-w-0 shrink-0 items-center gap-1.5 rounded-md border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cc-primary/50";
const SIZE_CLASS = { compact: "h-8 px-2 text-xs", touch: "h-10 px-3 text-sm" } as const;
const WORKER_COLOR_CLASS = "border-cc-border bg-cc-hover/30 text-cc-fg hover:border-cc-primary/45 hover:bg-cc-hover/60";
// Open Thread is the jump users want most often, so it carries the accent.
const THREAD_COLOR_CLASS = "border-cc-primary/50 bg-cc-primary/15 text-cc-primary hover:bg-cc-primary/25";
const DISABLED_COLOR_CLASS = "cursor-not-allowed border-dashed border-cc-border/60 text-cc-muted/60";

/**
 * The quest views' top jump buttons: Open Worker opens the worker session and Open Thread opens
 * the quest's thread tab in its leader session. Each button names its session number, so the
 * buttons double as the visible session links, and Open Worker carries the worker's live status
 * dot. A missing session leaves its button disabled so both always sit in the same place; with
 * neither session there is nothing to show.
 */
export function QuestSessionActions({
  questId,
  workerSessionId,
  workerStatus,
  leaderSessionId,
  onNavigate,
  size = "compact",
  className = "",
}: {
  questId: string;
  workerSessionId: string | null;
  /** The board's worker status, used for the dot when the session is not in the session list. */
  workerStatus?: BoardParticipantStatus["status"];
  leaderSessionId: string | null;
  /** Called after either button navigates, so a preview or dialog can close itself. */
  onNavigate?: () => void;
  /** `touch` makes taller buttons for a phone's thumb, as in the quest view's bottom bar. */
  size?: keyof typeof SIZE_CLASS;
  className?: string;
}) {
  if (!workerSessionId && !leaderSessionId) return null;
  const buttonClass = `${BUTTON_CLASS} ${SIZE_CLASS[size]}`;
  return (
    <div
      data-testid="quest-session-actions"
      className={`flex min-w-0 flex-wrap items-center gap-1.5 ${className}`}
      aria-label="Quest sessions"
    >
      <QuestSessionButton
        role="Worker"
        label="Open Worker"
        sessionId={workerSessionId}
        status={workerStatus}
        className={`${buttonClass} ${WORKER_COLOR_CLASS}`}
        disabledClassName={`${buttonClass} ${DISABLED_COLOR_CLASS}`}
        missingTitle="No worker session for this quest"
        testId="quest-open-worker"
        onNavigate={onNavigate}
      />
      <QuestSessionButton
        role="Leader"
        label="Open Thread"
        sessionId={leaderSessionId}
        threadKey={questId}
        className={`${buttonClass} ${THREAD_COLOR_CLASS}`}
        disabledClassName={`${buttonClass} ${DISABLED_COLOR_CLASS}`}
        missingTitle="No leader session for this quest"
        testId="quest-open-thread"
        onNavigate={onNavigate}
      />
      {/* Beside the leader's conversation on screen, the quest's thread can go in its side column. */}
      {leaderSessionId && size === "compact" && (
        <OpenInSideButton
          leaderSessionId={leaderSessionId}
          questId={questId}
          className={`${buttonClass} ${WORKER_COLOR_CLASS}`}
          onNavigate={onNavigate}
        />
      )}
      {/* Notify Me watches the thread Open Thread opens, so it sits beside it. */}
      {leaderSessionId && (
        <NotifyMeControl
          sessionId={leaderSessionId}
          threadKey={questId}
          className={`${buttonClass} border-cc-border bg-cc-hover/30`}
        />
      )}
    </div>
  );
}

function OpenInSideButton({
  leaderSessionId,
  questId,
  className,
  onNavigate,
}: {
  leaderSessionId: string;
  questId: string;
  className: string;
  onNavigate?: () => void;
}) {
  // Only while that leader's conversation is on screen: the side column is beside it.
  const shown = useStore((state) => state.currentSessionId === leaderSessionId);
  if (!shown) return null;
  return (
    <button
      type="button"
      className={className}
      title={`Open the quest's thread in the side column (${openInSideClickLabel()} on a quest link does the same)`}
      data-testid="quest-open-in-side"
      onClick={(event) => {
        event.stopPropagation();
        if (openConversationInSide(leaderSessionId, questId)) onNavigate?.();
      }}
    >
      <SideColumnIcon />
      <span className="whitespace-nowrap">Open in side</span>
    </button>
  );
}

function SideColumnIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5" aria-hidden="true">
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M10 2.5v11" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function QuestSessionButton({
  role,
  label,
  sessionId,
  status,
  threadKey,
  className,
  disabledClassName,
  missingTitle,
  testId,
  onNavigate,
}: {
  role: "Worker" | "Leader";
  label: string;
  sessionId: string | null;
  status?: BoardParticipantStatus["status"];
  threadKey?: string;
  className: string;
  disabledClassName: string;
  missingTitle: string;
  testId: string;
  onNavigate?: () => void;
}) {
  const session = useStore((state) =>
    sessionId ? state.sdkSessions.find((candidate) => candidate.sessionId === sessionId) : undefined,
  );
  const sessionNum = session?.sessionNum ?? null;
  const dotProps = useParticipantSessionStatusDotProps(role === "Worker" ? sessionId : null, status);
  const content: ReactNode = (
    <>
      <SessionRoleIcon role={role} />
      <span className="whitespace-nowrap">{label}</span>
    </>
  );

  if (!sessionId) {
    return (
      <button type="button" disabled data-testid={testId} className={disabledClassName} title={missingTitle}>
        {content}
      </button>
    );
  }

  // An unlisted session has no number yet; the button still opens it by ID.
  const sessionLabel = sessionNum != null ? `#${sessionNum}` : null;
  const sessionName = `${role === "Leader" ? "leader" : "worker"} session${sessionLabel ? ` ${sessionLabel}` : ""}${
    session?.name ? ` (${session.name})` : ""
  }`;
  return (
    <SessionInlineLink
      sessionId={sessionId}
      sessionNum={sessionNum}
      threadKey={threadKey}
      stopPropagation
      className={className}
      dataTestId={testId}
      ariaLabel={sessionLabel ? `${label} ${sessionLabel}` : label}
      title={threadKey ? `Open the ${threadKey} thread in ${sessionName}` : `Open ${sessionName}`}
      onNavigate={onNavigate}
    >
      {content}
      {sessionLabel && <span className="font-mono-code text-[11px] opacity-75">{sessionLabel}</span>}
      {dotProps && <SessionStatusDot className="mt-0" {...dotProps} />}
    </SessionInlineLink>
  );
}
